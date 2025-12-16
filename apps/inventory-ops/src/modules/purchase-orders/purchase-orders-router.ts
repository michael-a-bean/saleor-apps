import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { PrismaClient } from "@/lib/prisma";
import { createSaleorClient } from "@/lib/saleor-client";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

// Validation schemas
const poCreateSchema = z.object({
  supplierId: z.string().uuid("Invalid supplier ID"),
  saleorWarehouseId: z.string().min(1, "Warehouse is required"),
  expectedDeliveryAt: z.string().datetime().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  externalReference: z.string().max(255).optional().nullable(),
});

const poUpdateSchema = z.object({
  supplierId: z.string().uuid().optional(),
  saleorWarehouseId: z.string().min(1).optional(),
  expectedDeliveryAt: z.string().datetime().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  externalReference: z.string().max(255).optional().nullable(),
});

const poLineSchema = z.object({
  saleorVariantId: z.string().min(1, "Variant ID is required"),
  saleorVariantSku: z.string().optional().nullable(),
  saleorVariantName: z.string().optional().nullable(),
  qtyOrdered: z.number().int().positive("Quantity must be positive"),
  expectedUnitCost: z.number().nonnegative("Cost cannot be negative"),
  currency: z.string().length(3, "Currency must be 3 characters"),
  notes: z.string().max(500).optional().nullable(),
});

const poSearchSchema = z.object({
  status: z
    .enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "PARTIALLY_RECEIVED", "FULLY_RECEIVED", "CANCELLED"])
    .optional(),
  supplierId: z.string().uuid().optional(),
  query: z.string().optional(),
  limit: z.number().min(1).max(100).optional().default(50),
  offset: z.number().min(0).optional().default(0),
});

/**
 * Generate a unique PO number in format: PO-YYYYMMDD-NNNN
 */
async function generatePONumber(prisma: PrismaClient, installationId: string): Promise<string> {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `PO-${dateStr}-`;

  // Find the highest number for today
  const lastPO = await prisma.purchaseOrder.findFirst({
    where: {
      installationId,
      orderNumber: { startsWith: prefix },
    },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });

  let nextNum = 1;

  if (lastPO) {
    const lastNum = parseInt(lastPO.orderNumber.slice(-4), 10);

    nextNum = lastNum + 1;
  }

  return `${prefix}${nextNum.toString().padStart(4, "0")}`;
}

/**
 * Purchase Orders Router - Full CRUD with state machine
 */
export const purchaseOrdersRouter = router({
  /**
   * List purchase orders with optional filtering
   */
  list: protectedClientProcedure.input(poSearchSchema.optional()).query(async ({ ctx, input }) => {
    const where = {
      installationId: ctx.installationId,
      ...(input?.status && { status: input.status }),
      ...(input?.supplierId && { supplierId: input.supplierId }),
      ...(input?.query && {
        OR: [
          { orderNumber: { contains: input.query, mode: "insensitive" as const } },
          { externalReference: { contains: input.query, mode: "insensitive" as const } },
          { supplier: { name: { contains: input.query, mode: "insensitive" as const } } },
        ],
      }),
    };

    const [purchaseOrders, total] = await Promise.all([
      ctx.prisma.purchaseOrder.findMany({
        where,
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          _count: { select: { lines: true, goodsReceipts: true } },
        },
        orderBy: { createdAt: "desc" },
        take: input?.limit ?? 50,
        skip: input?.offset ?? 0,
      }),
      ctx.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      purchaseOrders,
      total,
      hasMore: (input?.offset ?? 0) + purchaseOrders.length < total,
    };
  }),

  /**
   * Get a single purchase order with all lines
   */
  getById: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const po = await ctx.prisma.purchaseOrder.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
        include: {
          supplier: true,
          lines: {
            orderBy: { lineNumber: "asc" },
          },
          goodsReceipts: {
            select: {
              id: true,
              receiptNumber: true,
              status: true,
              createdAt: true,
              _count: { select: { lines: true } },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!po) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Purchase order not found",
        });
      }

      return po;
    }),

  /**
   * Create a new purchase order (always starts as DRAFT)
   */
  create: protectedClientProcedure.input(poCreateSchema).mutation(async ({ ctx, input }) => {
    // Verify supplier exists and is active
    const supplier = await ctx.prisma.supplier.findFirst({
      where: {
        id: input.supplierId,
        installationId: ctx.installationId,
        isActive: true,
      },
    });

    if (!supplier) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Supplier not found or inactive",
      });
    }

    // Generate unique order number
    const orderNumber = await generatePONumber(ctx.prisma, ctx.installationId);

    const po = await ctx.prisma.purchaseOrder.create({
      data: {
        installationId: ctx.installationId,
        orderNumber,
        supplierId: input.supplierId,
        saleorWarehouseId: input.saleorWarehouseId,
        status: "DRAFT",
        expectedDeliveryAt: input.expectedDeliveryAt ? new Date(input.expectedDeliveryAt) : null,
        notes: input.notes || null,
        externalReference: input.externalReference || null,
      },
      include: {
        supplier: { select: { id: true, code: true, name: true } },
      },
    });

    // Audit event
    await ctx.prisma.auditEvent.create({
      data: {
        installationId: ctx.installationId,
        entityType: "PurchaseOrder",
        entityId: po.id,
        action: "CREATED",
        userId: ctx.token ?? null,
        newState: JSON.parse(JSON.stringify(po)),
      },
    });

    return po;
  }),

  /**
   * Update a draft purchase order
   */
  update: protectedClientProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: poUpdateSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.purchaseOrder.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Purchase order not found",
        });
      }

      // Only allow updates to DRAFT status
      if (existing.status !== "DRAFT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot edit purchase order in ${existing.status} status. Only DRAFT orders can be edited.`,
        });
      }

      // If changing supplier, verify it exists
      if (input.data.supplierId) {
        const supplier = await ctx.prisma.supplier.findFirst({
          where: {
            id: input.data.supplierId,
            installationId: ctx.installationId,
            isActive: true,
          },
        });

        if (!supplier) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Supplier not found or inactive",
          });
        }
      }

      const po = await ctx.prisma.purchaseOrder.update({
        where: { id: input.id },
        data: {
          ...input.data,
          expectedDeliveryAt: input.data.expectedDeliveryAt
            ? new Date(input.data.expectedDeliveryAt)
            : input.data.expectedDeliveryAt === null
              ? null
              : undefined,
        },
        include: {
          supplier: { select: { id: true, code: true, name: true } },
        },
      });

      // Audit event
      await ctx.prisma.auditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "PurchaseOrder",
          entityId: po.id,
          action: "UPDATED",
          userId: ctx.token ?? null,
          previousState: JSON.parse(JSON.stringify(existing)),
          newState: JSON.parse(JSON.stringify(po)),
        },
      });

      return po;
    }),

  /**
   * Add a line item to a draft PO
   */
  addLine: protectedClientProcedure
    .input(
      z.object({
        purchaseOrderId: z.string().uuid(),
        line: poLineSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const po = await ctx.prisma.purchaseOrder.findFirst({
        where: {
          id: input.purchaseOrderId,
          installationId: ctx.installationId,
        },
        include: { lines: { select: { lineNumber: true } } },
      });

      if (!po) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Purchase order not found",
        });
      }

      if (po.status !== "DRAFT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot add lines to purchase order in ${po.status} status`,
        });
      }

      // Calculate next line number
      const maxLineNumber = Math.max(0, ...po.lines.map((l) => l.lineNumber));
      const nextLineNumber = maxLineNumber + 1;

      const line = await ctx.prisma.purchaseOrderLine.create({
        data: {
          purchaseOrderId: input.purchaseOrderId,
          saleorVariantId: input.line.saleorVariantId,
          saleorVariantSku: input.line.saleorVariantSku || null,
          saleorVariantName: input.line.saleorVariantName || null,
          qtyOrdered: input.line.qtyOrdered,
          qtyRemaining: input.line.qtyOrdered,
          expectedUnitCost: input.line.expectedUnitCost,
          currency: input.line.currency,
          lineNumber: nextLineNumber,
          notes: input.line.notes || null,
        },
      });

      return line;
    }),

  /**
   * Update a line item on a draft PO
   */
  updateLine: protectedClientProcedure
    .input(
      z.object({
        lineId: z.string().uuid(),
        data: poLineSchema.partial(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const line = await ctx.prisma.purchaseOrderLine.findFirst({
        where: { id: input.lineId },
        include: {
          purchaseOrder: {
            select: { installationId: true, status: true },
          },
        },
      });

      if (!line || line.purchaseOrder.installationId !== ctx.installationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Line not found",
        });
      }

      if (line.purchaseOrder.status !== "DRAFT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot edit lines on purchase order in ${line.purchaseOrder.status} status`,
        });
      }

      // If qtyOrdered is being updated, also update qtyRemaining
      const updateData: Record<string, unknown> = { ...input.data };

      if (input.data.qtyOrdered !== undefined) {
        updateData.qtyRemaining = input.data.qtyOrdered - line.qtyReceived;
      }

      const updated = await ctx.prisma.purchaseOrderLine.update({
        where: { id: input.lineId },
        data: updateData,
      });

      return updated;
    }),

  /**
   * Remove a line from a draft PO
   */
  removeLine: protectedClientProcedure
    .input(z.object({ lineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const line = await ctx.prisma.purchaseOrderLine.findFirst({
        where: { id: input.lineId },
        include: {
          purchaseOrder: {
            select: { installationId: true, status: true },
          },
        },
      });

      if (!line || line.purchaseOrder.installationId !== ctx.installationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Line not found",
        });
      }

      if (line.purchaseOrder.status !== "DRAFT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot remove lines from purchase order in ${line.purchaseOrder.status} status`,
        });
      }

      await ctx.prisma.purchaseOrderLine.delete({
        where: { id: input.lineId },
      });

      return { success: true };
    }),

  /**
   * Submit PO for approval (DRAFT -> PENDING_APPROVAL)
   */
  submit: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const po = await ctx.prisma.purchaseOrder.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
        include: { lines: { select: { id: true } } },
      });

      if (!po) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Purchase order not found",
        });
      }

      if (po.status !== "DRAFT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot submit purchase order in ${po.status} status. Only DRAFT orders can be submitted.`,
        });
      }

      if (po.lines.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot submit purchase order with no lines",
        });
      }

      const updated = await ctx.prisma.purchaseOrder.update({
        where: { id: input.id },
        data: {
          status: "PENDING_APPROVAL",
          submittedAt: new Date(),
          submittedBy: ctx.token ?? null,
        },
        include: {
          supplier: { select: { id: true, code: true, name: true } },
        },
      });

      // Audit event
      await ctx.prisma.auditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "PurchaseOrder",
          entityId: po.id,
          action: "SUBMITTED",
          userId: ctx.token ?? null,
          previousState: JSON.parse(JSON.stringify({ status: po.status })),
          newState: JSON.parse(JSON.stringify({ status: updated.status })),
        },
      });

      return updated;
    }),

  /**
   * Approve PO (PENDING_APPROVAL -> APPROVED)
   */
  approve: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const po = await ctx.prisma.purchaseOrder.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
      });

      if (!po) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Purchase order not found",
        });
      }

      if (po.status !== "PENDING_APPROVAL") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot approve purchase order in ${po.status} status. Only PENDING_APPROVAL orders can be approved.`,
        });
      }

      const updated = await ctx.prisma.purchaseOrder.update({
        where: { id: input.id },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedBy: ctx.token ?? null,
        },
        include: {
          supplier: { select: { id: true, code: true, name: true } },
        },
      });

      // Audit event
      await ctx.prisma.auditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "PurchaseOrder",
          entityId: po.id,
          action: "APPROVED",
          userId: ctx.token ?? null,
          previousState: JSON.parse(JSON.stringify({ status: po.status })),
          newState: JSON.parse(JSON.stringify({ status: updated.status })),
        },
      });

      return updated;
    }),

  /**
   * Reject PO back to draft (PENDING_APPROVAL -> DRAFT)
   */
  reject: protectedClientProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const po = await ctx.prisma.purchaseOrder.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
      });

      if (!po) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Purchase order not found",
        });
      }

      if (po.status !== "PENDING_APPROVAL") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot reject purchase order in ${po.status} status`,
        });
      }

      const updated = await ctx.prisma.purchaseOrder.update({
        where: { id: input.id },
        data: {
          status: "DRAFT",
          submittedAt: null,
          submittedBy: null,
        },
        include: {
          supplier: { select: { id: true, code: true, name: true } },
        },
      });

      // Audit event
      await ctx.prisma.auditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "PurchaseOrder",
          entityId: po.id,
          action: "REJECTED",
          userId: ctx.token ?? null,
          previousState: JSON.parse(JSON.stringify({ status: po.status })),
          newState: JSON.parse(JSON.stringify({ status: updated.status })),
          metadata: input.reason ? { reason: input.reason } : undefined,
        },
      });

      return updated;
    }),

  /**
   * Cancel PO (any status except FULLY_RECEIVED -> CANCELLED)
   */
  cancel: protectedClientProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const po = await ctx.prisma.purchaseOrder.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
      });

      if (!po) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Purchase order not found",
        });
      }

      if (po.status === "FULLY_RECEIVED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot cancel a fully received purchase order",
        });
      }

      if (po.status === "CANCELLED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Purchase order is already cancelled",
        });
      }

      const updated = await ctx.prisma.purchaseOrder.update({
        where: { id: input.id },
        data: { status: "CANCELLED" },
        include: {
          supplier: { select: { id: true, code: true, name: true } },
        },
      });

      // Audit event
      await ctx.prisma.auditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "PurchaseOrder",
          entityId: po.id,
          action: "CANCELLED",
          userId: ctx.token ?? null,
          previousState: JSON.parse(JSON.stringify({ status: po.status })),
          newState: JSON.parse(JSON.stringify({ status: updated.status })),
          metadata: input.reason ? { reason: input.reason } : undefined,
        },
      });

      return updated;
    }),

  /**
   * Duplicate PO as a new draft
   */
  duplicate: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const original = await ctx.prisma.purchaseOrder.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
        include: { lines: true },
      });

      if (!original) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Purchase order not found",
        });
      }

      // Generate new order number
      const orderNumber = await generatePONumber(ctx.prisma, ctx.installationId);

      // Create duplicate PO with lines
      const newPO = await ctx.prisma.purchaseOrder.create({
        data: {
          installationId: ctx.installationId,
          orderNumber,
          supplierId: original.supplierId,
          saleorWarehouseId: original.saleorWarehouseId,
          status: "DRAFT",
          notes: original.notes,
          externalReference: null, // Don't copy external reference
          lines: {
            create: original.lines.map((line) => ({
              saleorVariantId: line.saleorVariantId,
              saleorVariantSku: line.saleorVariantSku,
              saleorVariantName: line.saleorVariantName,
              qtyOrdered: line.qtyOrdered,
              qtyRemaining: line.qtyOrdered,
              expectedUnitCost: line.expectedUnitCost,
              currency: line.currency,
              lineNumber: line.lineNumber,
              notes: line.notes,
            })),
          },
        },
        include: {
          supplier: { select: { id: true, code: true, name: true } },
          lines: true,
        },
      });

      // Audit event
      await ctx.prisma.auditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "PurchaseOrder",
          entityId: newPO.id,
          action: "DUPLICATED",
          userId: ctx.token ?? null,
          metadata: JSON.parse(JSON.stringify({ duplicatedFromId: original.id })),
          newState: JSON.parse(JSON.stringify(newPO)),
        },
      });

      return newPO;
    }),

  /**
   * Get Saleor warehouses for dropdown
   */
  getWarehouses: protectedClientProcedure.query(async ({ ctx }) => {
    const saleorClient = createSaleorClient(ctx.apiClient);

    return saleorClient.listWarehouses();
  }),

  /**
   * Search Saleor variants for line item selection
   */
  searchVariants: protectedClientProcedure
    .input(
      z.object({
        query: z.string().min(1),
        limit: z.number().min(1).max(50).optional().default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const saleorClient = createSaleorClient(ctx.apiClient);

      return saleorClient.searchVariants(input.query, input.limit);
    }),

  /**
   * Get a single variant by ID
   */
  getVariant: protectedClientProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const saleorClient = createSaleorClient(ctx.apiClient);

      return saleorClient.getVariantById(input.id);
    }),
});
