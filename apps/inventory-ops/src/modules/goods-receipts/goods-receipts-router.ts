import { Decimal } from "@prisma/client/runtime/library";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { PrismaClient } from "@/lib/prisma";
import { createSaleorClient } from "@/lib/saleor-client";
import { computeWacForNewEvent } from "@/modules/cost-layers";
import { executeAllocations, getLandedCostPerUnit } from "@/modules/landed-costs";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

// Validation schemas
const grCreateSchema = z.object({
  purchaseOrderId: z.string().uuid("Invalid purchase order ID"),
  receivedAt: z.string().datetime().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

const grLineSchema = z.object({
  purchaseOrderLineId: z.string().uuid().optional().nullable(),
  saleorVariantId: z.string().min(1, "Variant ID is required"),
  saleorVariantSku: z.string().optional().nullable(),
  saleorVariantName: z.string().optional().nullable(),
  qtyReceived: z.number().int().positive("Quantity must be positive"),
  unitCost: z.number().nonnegative("Cost cannot be negative"),
  currency: z.string().length(3, "Currency must be 3 characters"),
  notes: z.string().max(500).optional().nullable(),
});

const grSearchSchema = z.object({
  status: z.enum(["DRAFT", "POSTED", "REVERSED"]).optional(),
  purchaseOrderId: z.string().uuid().optional(),
  query: z.string().optional(),
  limit: z.number().min(1).max(100).optional().default(50),
  offset: z.number().min(0).optional().default(0),
});

/**
 * Generate a unique GR number in format: GR-YYYYMMDD-NNNN
 */
async function generateGRNumber(prisma: PrismaClient, _purchaseOrderId: string): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `GR-${dateStr}-`;

  // Find the highest number for today across all GRs
  const lastGR = await prisma.goodsReceipt.findFirst({
    where: {
      receiptNumber: { startsWith: prefix },
    },
    orderBy: { receiptNumber: "desc" },
    select: { receiptNumber: true },
  });

  let nextNum = 1;

  if (lastGR) {
    const lastNum = parseInt(lastGR.receiptNumber.slice(-4), 10);

    nextNum = lastNum + 1;
  }

  return `${prefix}${nextNum.toString().padStart(4, "0")}`;
}

/**
 * Update PO status based on received quantities
 */
async function updatePOStatus(prisma: PrismaClient, purchaseOrderId: string): Promise<void> {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { lines: true },
  });

  if (!po) return;

  // Calculate total ordered and received
  const totalOrdered = po.lines.reduce((sum, line) => sum + line.qtyOrdered, 0);
  const totalReceived = po.lines.reduce((sum, line) => sum + line.qtyReceived, 0);

  let newStatus = po.status;

  if (totalReceived === 0) {
    // No receipts - keep as APPROVED if it was
    newStatus = po.status === "PARTIALLY_RECEIVED" ? "APPROVED" : po.status;
  } else if (totalReceived >= totalOrdered) {
    newStatus = "FULLY_RECEIVED";
  } else if (totalReceived > 0) {
    newStatus = "PARTIALLY_RECEIVED";
  }

  if (newStatus !== po.status) {
    await prisma.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: { status: newStatus },
    });
  }
}

/**
 * Goods Receipts Router - Full CRUD with posting logic
 */
export const goodsReceiptsRouter = router({
  /**
   * List goods receipts with optional filtering
   */
  list: protectedClientProcedure.input(grSearchSchema.optional()).query(async ({ ctx, input }) => {
    const where = {
      purchaseOrder: {
        installationId: ctx.installationId,
        ...(input?.purchaseOrderId && { id: input.purchaseOrderId }),
      },
      ...(input?.status && { status: input.status }),
      ...(input?.query && {
        OR: [
          { receiptNumber: { contains: input.query, mode: "insensitive" as const } },
          { notes: { contains: input.query, mode: "insensitive" as const } },
          { purchaseOrder: { orderNumber: { contains: input.query, mode: "insensitive" as const } } },
        ],
      }),
    };

    const [goodsReceipts, total] = await Promise.all([
      ctx.prisma.goodsReceipt.findMany({
        where,
        include: {
          purchaseOrder: {
            select: {
              id: true,
              orderNumber: true,
              supplier: { select: { id: true, code: true, name: true } },
              saleorWarehouseId: true,
            },
          },
          _count: { select: { lines: true } },
          reversalOfGr: { select: { id: true, receiptNumber: true } },
          reversedByGr: { select: { id: true, receiptNumber: true } },
        },
        orderBy: { createdAt: "desc" },
        take: input?.limit ?? 50,
        skip: input?.offset ?? 0,
      }),
      ctx.prisma.goodsReceipt.count({ where }),
    ]);

    return {
      goodsReceipts,
      total,
      hasMore: (input?.offset ?? 0) + goodsReceipts.length < total,
    };
  }),

  /**
   * Get a single goods receipt with all lines
   */
  getById: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const gr = await ctx.prisma.goodsReceipt.findFirst({
        where: {
          id: input.id,
          purchaseOrder: {
            installationId: ctx.installationId,
          },
        },
        include: {
          purchaseOrder: {
            include: {
              supplier: true,
              lines: {
                orderBy: { lineNumber: "asc" },
              },
            },
          },
          lines: {
            orderBy: { lineNumber: "asc" },
            include: {
              purchaseOrderLine: true,
            },
          },
          landedCosts: true,
          reversalOfGr: { select: { id: true, receiptNumber: true } },
          reversedByGr: { select: { id: true, receiptNumber: true } },
        },
      });

      if (!gr) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Goods receipt not found",
        });
      }

      return gr;
    }),

  /**
   * Create a new goods receipt from a purchase order
   */
  create: protectedClientProcedure.input(grCreateSchema).mutation(async ({ ctx, input }) => {
    // Verify PO exists and is in a receivable status
    const po = await ctx.prisma.purchaseOrder.findFirst({
      where: {
        id: input.purchaseOrderId,
        installationId: ctx.installationId,
      },
      include: {
        lines: {
          orderBy: { lineNumber: "asc" },
        },
      },
    });

    if (!po) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Purchase order not found",
      });
    }

    // Only allow receiving from APPROVED or PARTIALLY_RECEIVED POs
    if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Cannot receive against purchase order in ${po.status} status. PO must be APPROVED or PARTIALLY_RECEIVED.`,
      });
    }

    // Generate unique receipt number
    const receiptNumber = await generateGRNumber(ctx.prisma, input.purchaseOrderId);

    // Create GR with pre-populated lines from PO
    const gr = await ctx.prisma.goodsReceipt.create({
      data: {
        purchaseOrderId: input.purchaseOrderId,
        receiptNumber,
        saleorWarehouseId: po.saleorWarehouseId,
        status: "DRAFT",
        receivedAt: input.receivedAt ? new Date(input.receivedAt) : null,
        notes: input.notes || null,
        // Pre-populate lines with remaining quantities from PO
        lines: {
          create: po.lines
            .filter((line) => line.qtyRemaining > 0)
            .map((line, index) => ({
              purchaseOrderLineId: line.id,
              saleorVariantId: line.saleorVariantId,
              saleorVariantSku: line.saleorVariantSku,
              saleorVariantName: line.saleorVariantName,
              qtyReceived: line.qtyRemaining, // Default to remaining qty
              unitCost: line.expectedUnitCost,
              currency: line.currency,
              lineNumber: index + 1,
            })),
        },
      },
      include: {
        purchaseOrder: {
          select: {
            orderNumber: true,
            supplier: { select: { id: true, code: true, name: true } },
          },
        },
        lines: {
          orderBy: { lineNumber: "asc" },
        },
      },
    });

    // Audit event
    await ctx.prisma.auditEvent.create({
      data: {
        installationId: ctx.installationId,
        entityType: "GoodsReceipt",
        entityId: gr.id,
        action: "CREATED",
        userId: ctx.token ?? null,
        newState: JSON.parse(JSON.stringify(gr)),
      },
    });

    return gr;
  }),

  /**
   * Update a draft goods receipt
   */
  update: protectedClientProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: z.object({
          receivedAt: z.string().datetime().optional().nullable(),
          notes: z.string().max(1000).optional().nullable(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.goodsReceipt.findFirst({
        where: {
          id: input.id,
          purchaseOrder: {
            installationId: ctx.installationId,
          },
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Goods receipt not found",
        });
      }

      if (existing.status !== "DRAFT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot edit goods receipt in ${existing.status} status. Only DRAFT receipts can be edited.`,
        });
      }

      const gr = await ctx.prisma.goodsReceipt.update({
        where: { id: input.id },
        data: {
          receivedAt: input.data.receivedAt ? new Date(input.data.receivedAt) : input.data.receivedAt,
          notes: input.data.notes,
        },
        include: {
          purchaseOrder: {
            select: {
              orderNumber: true,
              supplier: { select: { id: true, code: true, name: true } },
            },
          },
        },
      });

      return gr;
    }),

  /**
   * Add a line item to a draft GR
   */
  addLine: protectedClientProcedure
    .input(
      z.object({
        goodsReceiptId: z.string().uuid(),
        line: grLineSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const gr = await ctx.prisma.goodsReceipt.findFirst({
        where: {
          id: input.goodsReceiptId,
          purchaseOrder: {
            installationId: ctx.installationId,
          },
        },
        include: { lines: { select: { lineNumber: true } } },
      });

      if (!gr) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Goods receipt not found",
        });
      }

      if (gr.status !== "DRAFT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot add lines to goods receipt in ${gr.status} status`,
        });
      }

      // Calculate next line number
      const maxLineNumber = Math.max(0, ...gr.lines.map((l) => l.lineNumber));
      const nextLineNumber = maxLineNumber + 1;

      const line = await ctx.prisma.goodsReceiptLine.create({
        data: {
          goodsReceiptId: input.goodsReceiptId,
          purchaseOrderLineId: input.line.purchaseOrderLineId || null,
          saleorVariantId: input.line.saleorVariantId,
          saleorVariantSku: input.line.saleorVariantSku || null,
          saleorVariantName: input.line.saleorVariantName || null,
          qtyReceived: input.line.qtyReceived,
          unitCost: input.line.unitCost,
          currency: input.line.currency,
          lineNumber: nextLineNumber,
          notes: input.line.notes || null,
        },
      });

      return line;
    }),

  /**
   * Update a line item on a draft GR
   */
  updateLine: protectedClientProcedure
    .input(
      z.object({
        lineId: z.string().uuid(),
        data: grLineSchema.partial(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const line = await ctx.prisma.goodsReceiptLine.findFirst({
        where: { id: input.lineId },
        include: {
          goodsReceipt: {
            include: {
              purchaseOrder: {
                select: { installationId: true },
              },
            },
          },
        },
      });

      if (!line || line.goodsReceipt.purchaseOrder.installationId !== ctx.installationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Line not found",
        });
      }

      if (line.goodsReceipt.status !== "DRAFT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot edit lines on goods receipt in ${line.goodsReceipt.status} status`,
        });
      }

      const updated = await ctx.prisma.goodsReceiptLine.update({
        where: { id: input.lineId },
        data: input.data,
      });

      return updated;
    }),

  /**
   * Remove a line from a draft GR
   */
  removeLine: protectedClientProcedure
    .input(z.object({ lineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const line = await ctx.prisma.goodsReceiptLine.findFirst({
        where: { id: input.lineId },
        include: {
          goodsReceipt: {
            include: {
              purchaseOrder: {
                select: { installationId: true },
              },
            },
          },
        },
      });

      if (!line || line.goodsReceipt.purchaseOrder.installationId !== ctx.installationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Line not found",
        });
      }

      if (line.goodsReceipt.status !== "DRAFT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot remove lines from goods receipt in ${line.goodsReceipt.status} status`,
        });
      }

      await ctx.prisma.goodsReceiptLine.delete({
        where: { id: input.lineId },
      });

      return { success: true };
    }),

  /**
   * Post goods receipt - updates Saleor stock and creates cost layer events
   */
  post: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const gr = await ctx.prisma.goodsReceipt.findFirst({
        where: {
          id: input.id,
          purchaseOrder: {
            installationId: ctx.installationId,
          },
        },
        include: {
          lines: {
            include: {
              purchaseOrderLine: true,
            },
          },
          purchaseOrder: {
            include: {
              lines: true,
            },
          },
        },
      });

      if (!gr) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Goods receipt not found",
        });
      }

      if (gr.status !== "DRAFT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot post goods receipt in ${gr.status} status. Only DRAFT receipts can be posted.`,
        });
      }

      if (gr.lines.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot post goods receipt with no lines",
        });
      }

      // Verify all lines have unit cost
      const linesWithoutCost = gr.lines.filter((line) => !line.unitCost || Number(line.unitCost) === 0);

      if (linesWithoutCost.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${linesWithoutCost.length} line(s) are missing unit cost. All lines must have a unit cost before posting.`,
        });
      }

      // Auto-allocate any unallocated landed costs before posting
      const allocationResult = await executeAllocations(ctx.prisma, input.id);
      if (allocationResult.allocatedCount > 0) {
        // Log that we auto-allocated
        await ctx.prisma.auditEvent.create({
          data: {
            installationId: ctx.installationId,
            entityType: "GoodsReceipt",
            entityId: input.id,
            action: "LANDED_COSTS_AUTO_ALLOCATED",
            userId: ctx.token ?? null,
            metadata: JSON.parse(JSON.stringify({ allocatedCount: allocationResult.allocatedCount })),
          },
        });
      }

      const saleorClient = createSaleorClient(ctx.apiClient);

      // Process each line
      const stockUpdates: Array<{ variantId: string; warehouseId: string; delta: number }> = [];

      for (const line of gr.lines) {
        // Get current stock
        const currentStock = await saleorClient.getStock(line.saleorVariantId, gr.saleorWarehouseId);
        const newStock = currentStock + line.qtyReceived;

        stockUpdates.push({
          variantId: line.saleorVariantId,
          warehouseId: gr.saleorWarehouseId,
          delta: line.qtyReceived,
        });

        // Check for existing posting record (idempotency)
        const idempotencyKey = `GR-${gr.id}-LINE-${line.id}`;
        const existingPosting = await ctx.prisma.saleorPostingRecord.findUnique({
          where: { idempotencyKey },
        });

        if (existingPosting && existingPosting.status === "SUCCESS") {
          // Already posted - skip
          continue;
        }

        // Create posting record
        const postingRecord = await ctx.prisma.saleorPostingRecord.upsert({
          where: { idempotencyKey },
          create: {
            idempotencyKey,
            grLineId: line.id,
            mutationType: "stockBulkUpdate",
            status: "PENDING",
            requestPayload: { variantId: line.saleorVariantId, warehouseId: gr.saleorWarehouseId, quantity: newStock },
          },
          update: {
            status: "PENDING",
            errorMessage: null,
          },
        });

        try {
          // Update Saleor stock
          const stockResult = await saleorClient.updateStock(line.saleorVariantId, gr.saleorWarehouseId, newStock);

          if (!stockResult.success) {
            // Update posting record with failure
            await ctx.prisma.saleorPostingRecord.update({
              where: { id: postingRecord.id },
              data: {
                status: "FAILED",
                errorMessage: stockResult.error,
                completedAt: new Date(),
              },
            });

            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to update stock for variant ${line.saleorVariantSku || line.saleorVariantId}: ${stockResult.error}`,
            });
          }

          // Update posting record with success
          await ctx.prisma.saleorPostingRecord.update({
            where: { id: postingRecord.id },
            data: {
              status: "SUCCESS",
              saleorResponse: { newQuantity: stockResult.newQuantity },
              completedAt: new Date(),
            },
          });

          // Get landed cost per unit for this line (if any)
          const landedCostPerUnit = await getLandedCostPerUnit(ctx.prisma, line.id);

          // Compute WAC for this event (including landed cost)
          const { wacAtEvent, qtyOnHandAtEvent } = await computeWacForNewEvent({
            prisma: ctx.prisma,
            installationId: ctx.installationId,
            variantId: line.saleorVariantId,
            warehouseId: gr.saleorWarehouseId,
            newQtyDelta: line.qtyReceived,
            newUnitCost: new Decimal(line.unitCost.toString()),
            newLandedCostDelta: landedCostPerUnit,
          });

          // Create cost layer event with computed WAC and landed cost delta
          await ctx.prisma.costLayerEvent.create({
            data: {
              installationId: ctx.installationId,
              eventType: "GOODS_RECEIPT",
              saleorVariantId: line.saleorVariantId,
              saleorWarehouseId: gr.saleorWarehouseId,
              qtyDelta: line.qtyReceived,
              unitCost: line.unitCost,
              currency: line.currency,
              landedCostDelta: landedCostPerUnit,
              sourceGrLineId: line.id,
              wacAtEvent: wacAtEvent,
              qtyOnHandAtEvent: qtyOnHandAtEvent,
              createdBy: ctx.token ?? null,
            },
          });

          // Update PO line received quantity
          if (line.purchaseOrderLineId) {
            await ctx.prisma.purchaseOrderLine.update({
              where: { id: line.purchaseOrderLineId },
              data: {
                qtyReceived: { increment: line.qtyReceived },
                qtyRemaining: { decrement: line.qtyReceived },
              },
            });
          }
        } catch (error) {
          // If it's already a TRPCError, rethrow
          if (error instanceof TRPCError) {
            throw error;
          }

          // Update posting record with failure
          await ctx.prisma.saleorPostingRecord.update({
            where: { id: postingRecord.id },
            data: {
              status: "FAILED",
              errorMessage: error instanceof Error ? error.message : "Unknown error",
              completedAt: new Date(),
            },
          });

          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to post line: ${error instanceof Error ? error.message : "Unknown error"}`,
          });
        }
      }

      // Update GR status to POSTED
      const updatedGr = await ctx.prisma.goodsReceipt.update({
        where: { id: input.id },
        data: {
          status: "POSTED",
          postedAt: new Date(),
          postedBy: ctx.token ?? null,
        },
        include: {
          purchaseOrder: {
            select: {
              orderNumber: true,
              supplier: { select: { id: true, code: true, name: true } },
            },
          },
          lines: true,
        },
      });

      // Update PO status based on received quantities
      await updatePOStatus(ctx.prisma, gr.purchaseOrderId);

      // Audit event
      await ctx.prisma.auditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "GoodsReceipt",
          entityId: gr.id,
          action: "POSTED",
          userId: ctx.token ?? null,
          previousState: JSON.parse(JSON.stringify({ status: "DRAFT" })),
          newState: JSON.parse(JSON.stringify({ status: "POSTED" })),
          metadata: JSON.parse(JSON.stringify({ stockUpdates })),
        },
      });

      return updatedGr;
    }),

  /**
   * Reverse a posted goods receipt
   */
  reverse: protectedClientProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.string().min(1, "Reversal reason is required").max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const gr = await ctx.prisma.goodsReceipt.findFirst({
        where: {
          id: input.id,
          purchaseOrder: {
            installationId: ctx.installationId,
          },
        },
        include: {
          lines: {
            include: {
              purchaseOrderLine: true,
            },
          },
          purchaseOrder: true,
          reversedByGr: true,
        },
      });

      if (!gr) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Goods receipt not found",
        });
      }

      if (gr.status !== "POSTED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot reverse goods receipt in ${gr.status} status. Only POSTED receipts can be reversed.`,
        });
      }

      if (gr.reversedByGr) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This goods receipt has already been reversed",
        });
      }

      const saleorClient = createSaleorClient(ctx.apiClient);

      // Generate reversal GR number
      const reversalReceiptNumber = await generateGRNumber(ctx.prisma, gr.purchaseOrderId);

      // Create reversal GR
      const reversalGr = await ctx.prisma.goodsReceipt.create({
        data: {
          purchaseOrderId: gr.purchaseOrderId,
          receiptNumber: reversalReceiptNumber,
          saleorWarehouseId: gr.saleorWarehouseId,
          status: "DRAFT",
          reversalOfGrId: gr.id,
          notes: `Reversal of ${gr.receiptNumber}: ${input.reason}`,
          lines: {
            create: gr.lines.map((line, index) => ({
              purchaseOrderLineId: line.purchaseOrderLineId,
              saleorVariantId: line.saleorVariantId,
              saleorVariantSku: line.saleorVariantSku,
              saleorVariantName: line.saleorVariantName,
              qtyReceived: -line.qtyReceived, // Negative quantity for reversal
              unitCost: line.unitCost,
              currency: line.currency,
              lineNumber: index + 1,
              notes: `Reversal of line from ${gr.receiptNumber}`,
            })),
          },
        },
      });

      // Process reversal - update stock and create cost events
      for (const line of gr.lines) {
        const currentStock = await saleorClient.getStock(line.saleorVariantId, gr.saleorWarehouseId);
        const newStock = currentStock - line.qtyReceived;

        /*
         * Check if reversal would result in negative stock
         * For now, we'll allow it and let Saleor handle the validation
         * In future, this could be configurable via settings
         */
        if (newStock < 0) {
          // Allow negative stock for reversal
        }

        const idempotencyKey = `GR-REVERSAL-${reversalGr.id}-LINE-${line.id}`;

        const postingRecord = await ctx.prisma.saleorPostingRecord.create({
          data: {
            idempotencyKey,
            grLineId: line.id,
            mutationType: "stockBulkUpdate",
            status: "PENDING",
            requestPayload: { variantId: line.saleorVariantId, warehouseId: gr.saleorWarehouseId, quantity: newStock },
          },
        });

        try {
          const stockResult = await saleorClient.updateStock(line.saleorVariantId, gr.saleorWarehouseId, newStock);

          if (!stockResult.success) {
            await ctx.prisma.saleorPostingRecord.update({
              where: { id: postingRecord.id },
              data: {
                status: "FAILED",
                errorMessage: stockResult.error,
                completedAt: new Date(),
              },
            });

            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to reverse stock for variant ${line.saleorVariantSku || line.saleorVariantId}: ${stockResult.error}`,
            });
          }

          await ctx.prisma.saleorPostingRecord.update({
            where: { id: postingRecord.id },
            data: {
              status: "SUCCESS",
              saleorResponse: { newQuantity: stockResult.newQuantity },
              completedAt: new Date(),
            },
          });

          // Compute WAC for this reversal event
          const { wacAtEvent, qtyOnHandAtEvent } = await computeWacForNewEvent({
            prisma: ctx.prisma,
            installationId: ctx.installationId,
            variantId: line.saleorVariantId,
            warehouseId: gr.saleorWarehouseId,
            newQtyDelta: -line.qtyReceived, // Negative for reversal
            newUnitCost: new Decimal(line.unitCost.toString()),
          });

          // Create reversal cost layer event with computed WAC
          await ctx.prisma.costLayerEvent.create({
            data: {
              installationId: ctx.installationId,
              eventType: "GOODS_RECEIPT_REVERSAL",
              saleorVariantId: line.saleorVariantId,
              saleorWarehouseId: gr.saleorWarehouseId,
              qtyDelta: -line.qtyReceived, // Negative for reversal
              unitCost: line.unitCost,
              currency: line.currency,
              sourceGrLineId: line.id,
              wacAtEvent: wacAtEvent,
              qtyOnHandAtEvent: qtyOnHandAtEvent,
              createdBy: ctx.token ?? null,
            },
          });

          // Update PO line received quantity (reduce it)
          if (line.purchaseOrderLineId) {
            await ctx.prisma.purchaseOrderLine.update({
              where: { id: line.purchaseOrderLineId },
              data: {
                qtyReceived: { decrement: line.qtyReceived },
                qtyRemaining: { increment: line.qtyReceived },
              },
            });
          }
        } catch (error) {
          if (error instanceof TRPCError) {
            throw error;
          }

          await ctx.prisma.saleorPostingRecord.update({
            where: { id: postingRecord.id },
            data: {
              status: "FAILED",
              errorMessage: error instanceof Error ? error.message : "Unknown error",
              completedAt: new Date(),
            },
          });

          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to reverse line: ${error instanceof Error ? error.message : "Unknown error"}`,
          });
        }
      }

      // Update original GR status to REVERSED
      await ctx.prisma.goodsReceipt.update({
        where: { id: input.id },
        data: { status: "REVERSED" },
      });

      // Update reversal GR status to POSTED
      const updatedReversalGr = await ctx.prisma.goodsReceipt.update({
        where: { id: reversalGr.id },
        data: {
          status: "POSTED",
          postedAt: new Date(),
          postedBy: ctx.token ?? null,
        },
        include: {
          purchaseOrder: {
            select: {
              orderNumber: true,
              supplier: { select: { id: true, code: true, name: true } },
            },
          },
          lines: true,
          reversalOfGr: { select: { id: true, receiptNumber: true } },
        },
      });

      // Update PO status
      await updatePOStatus(ctx.prisma, gr.purchaseOrderId);

      // Audit events
      await ctx.prisma.auditEvent.createMany({
        data: [
          {
            installationId: ctx.installationId,
            entityType: "GoodsReceipt",
            entityId: gr.id,
            action: "REVERSED",
            userId: ctx.token ?? null,
            metadata: JSON.parse(JSON.stringify({ reason: input.reason, reversalGrId: reversalGr.id })),
          },
          {
            installationId: ctx.installationId,
            entityType: "GoodsReceipt",
            entityId: reversalGr.id,
            action: "CREATED",
            userId: ctx.token ?? null,
            metadata: JSON.parse(JSON.stringify({ isReversal: true, originalGrId: gr.id })),
          },
        ],
      });

      return updatedReversalGr;
    }),

  /**
   * Delete a draft goods receipt
   */
  delete: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const gr = await ctx.prisma.goodsReceipt.findFirst({
        where: {
          id: input.id,
          purchaseOrder: {
            installationId: ctx.installationId,
          },
        },
      });

      if (!gr) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Goods receipt not found",
        });
      }

      if (gr.status !== "DRAFT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot delete goods receipt in ${gr.status} status. Only DRAFT receipts can be deleted.`,
        });
      }

      await ctx.prisma.goodsReceipt.delete({
        where: { id: input.id },
      });

      // Audit event
      await ctx.prisma.auditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "GoodsReceipt",
          entityId: input.id,
          action: "DELETED",
          userId: ctx.token ?? null,
        },
      });

      return { success: true };
    }),

  /**
   * Get approved POs available for receiving
   */
  getReceivablePOs: protectedClientProcedure.query(async ({ ctx }) => {
    const pos = await ctx.prisma.purchaseOrder.findMany({
      where: {
        installationId: ctx.installationId,
        status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] },
      },
      include: {
        supplier: { select: { id: true, code: true, name: true } },
        lines: {
          select: {
            id: true,
            saleorVariantSku: true,
            saleorVariantName: true,
            qtyOrdered: true,
            qtyReceived: true,
            qtyRemaining: true,
          },
        },
        _count: { select: { goodsReceipts: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return pos;
  }),
});
