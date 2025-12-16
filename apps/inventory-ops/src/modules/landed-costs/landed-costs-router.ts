import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

import {
  executeAllocations,
  generateAllocationPreview,
  getLandedCostPerUnit,
  getTotalLandedCostForLine,
} from "./allocation-service";

// Validation schemas
const landedCostCreateSchema = z.object({
  goodsReceiptId: z.string().uuid("Invalid goods receipt ID"),
  costType: z.enum(["FREIGHT", "DUTY", "INSURANCE", "HANDLING", "OTHER"]),
  description: z.string().min(1, "Description is required").max(500),
  amount: z.number().positive("Amount must be positive"),
  currency: z.string().length(3, "Currency must be 3 characters"),
  allocationMethod: z.enum(["VALUE", "QUANTITY"]).optional().default("VALUE"),
});

const landedCostUpdateSchema = z.object({
  id: z.string().uuid(),
  data: z.object({
    costType: z.enum(["FREIGHT", "DUTY", "INSURANCE", "HANDLING", "OTHER"]).optional(),
    description: z.string().min(1).max(500).optional(),
    amount: z.number().positive().optional(),
    currency: z.string().length(3).optional(),
    allocationMethod: z.enum(["VALUE", "QUANTITY"]).optional(),
  }),
});

/**
 * Landed Costs Router - CRUD + Allocation
 */
export const landedCostsRouter = router({
  /**
   * List landed costs for a goods receipt
   */
  listByGR: protectedClientProcedure
    .input(z.object({ goodsReceiptId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify GR belongs to this installation
      const gr = await ctx.prisma.goodsReceipt.findFirst({
        where: {
          id: input.goodsReceiptId,
          purchaseOrder: {
            installationId: ctx.installationId,
          },
        },
        select: { id: true, status: true },
      });

      if (!gr) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Goods receipt not found",
        });
      }

      const landedCosts = await ctx.prisma.landedCost.findMany({
        where: { goodsReceiptId: input.goodsReceiptId },
        include: {
          allocations: {
            include: {
              goodsReceiptLine: {
                select: {
                  id: true,
                  saleorVariantSku: true,
                  saleorVariantName: true,
                  qtyReceived: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      return {
        landedCosts: landedCosts.map((lc) => ({
          id: lc.id,
          costType: lc.costType,
          description: lc.description,
          amount: lc.amount.toString(),
          currency: lc.currency,
          allocationMethod: lc.allocationMethod,
          isAllocated: lc.isAllocated,
          createdAt: lc.createdAt,
          allocations: lc.allocations.map((a) => ({
            lineId: a.goodsReceiptLineId,
            variantSku: a.goodsReceiptLine.saleorVariantSku,
            variantName: a.goodsReceiptLine.saleorVariantName,
            lineQty: a.goodsReceiptLine.qtyReceived,
            allocatedAmount: a.allocatedAmount.toString(),
          })),
        })),
        canEdit: gr.status === "DRAFT",
      };
    }),

  /**
   * Get a single landed cost with allocations
   */
  getById: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const landedCost = await ctx.prisma.landedCost.findFirst({
        where: {
          id: input.id,
          goodsReceipt: {
            purchaseOrder: {
              installationId: ctx.installationId,
            },
          },
        },
        include: {
          goodsReceipt: {
            select: {
              id: true,
              receiptNumber: true,
              status: true,
            },
          },
          allocations: {
            include: {
              goodsReceiptLine: {
                select: {
                  id: true,
                  saleorVariantSku: true,
                  saleorVariantName: true,
                  qtyReceived: true,
                  unitCost: true,
                },
              },
            },
          },
        },
      });

      if (!landedCost) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Landed cost not found",
        });
      }

      return {
        id: landedCost.id,
        costType: landedCost.costType,
        description: landedCost.description,
        amount: landedCost.amount.toString(),
        currency: landedCost.currency,
        allocationMethod: landedCost.allocationMethod,
        isAllocated: landedCost.isAllocated,
        createdAt: landedCost.createdAt,
        goodsReceipt: landedCost.goodsReceipt,
        canEdit: landedCost.goodsReceipt.status === "DRAFT" && !landedCost.isAllocated,
        allocations: landedCost.allocations.map((a) => ({
          lineId: a.goodsReceiptLineId,
          variantSku: a.goodsReceiptLine.saleorVariantSku,
          variantName: a.goodsReceiptLine.saleorVariantName,
          lineQty: a.goodsReceiptLine.qtyReceived,
          lineUnitCost: a.goodsReceiptLine.unitCost.toString(),
          allocatedAmount: a.allocatedAmount.toString(),
        })),
      };
    }),

  /**
   * Create a new landed cost
   */
  create: protectedClientProcedure.input(landedCostCreateSchema).mutation(async ({ ctx, input }) => {
    // Verify GR exists and is in DRAFT status
    const gr = await ctx.prisma.goodsReceipt.findFirst({
      where: {
        id: input.goodsReceiptId,
        purchaseOrder: {
          installationId: ctx.installationId,
        },
      },
      select: { id: true, status: true },
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
        message: `Cannot add landed costs to goods receipt in ${gr.status} status. Only DRAFT receipts can be modified.`,
      });
    }

    const landedCost = await ctx.prisma.landedCost.create({
      data: {
        goodsReceiptId: input.goodsReceiptId,
        costType: input.costType,
        description: input.description,
        amount: input.amount,
        currency: input.currency,
        allocationMethod: input.allocationMethod,
        isAllocated: false,
      },
    });

    // Audit event
    await ctx.prisma.auditEvent.create({
      data: {
        installationId: ctx.installationId,
        entityType: "LandedCost",
        entityId: landedCost.id,
        action: "CREATED",
        userId: ctx.token ?? null,
        newState: JSON.parse(JSON.stringify(landedCost)),
      },
    });

    return {
      id: landedCost.id,
      costType: landedCost.costType,
      description: landedCost.description,
      amount: landedCost.amount.toString(),
      currency: landedCost.currency,
      allocationMethod: landedCost.allocationMethod,
      isAllocated: landedCost.isAllocated,
    };
  }),

  /**
   * Update a landed cost (only before allocation)
   */
  update: protectedClientProcedure.input(landedCostUpdateSchema).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.landedCost.findFirst({
      where: {
        id: input.id,
        goodsReceipt: {
          purchaseOrder: {
            installationId: ctx.installationId,
          },
        },
      },
      include: {
        goodsReceipt: {
          select: { status: true },
        },
      },
    });

    if (!existing) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Landed cost not found",
      });
    }

    if (existing.goodsReceipt.status !== "DRAFT") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Cannot modify landed costs on a posted goods receipt",
      });
    }

    if (existing.isAllocated) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Cannot modify an already allocated landed cost. Delete and recreate if needed.",
      });
    }

    const updated = await ctx.prisma.landedCost.update({
      where: { id: input.id },
      data: input.data,
    });

    return {
      id: updated.id,
      costType: updated.costType,
      description: updated.description,
      amount: updated.amount.toString(),
      currency: updated.currency,
      allocationMethod: updated.allocationMethod,
      isAllocated: updated.isAllocated,
    };
  }),

  /**
   * Delete a landed cost (only before allocation)
   */
  delete: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.landedCost.findFirst({
        where: {
          id: input.id,
          goodsReceipt: {
            purchaseOrder: {
              installationId: ctx.installationId,
            },
          },
        },
        include: {
          goodsReceipt: {
            select: { status: true },
          },
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Landed cost not found",
        });
      }

      if (existing.goodsReceipt.status !== "DRAFT") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot delete landed costs from a posted goods receipt",
        });
      }

      if (existing.isAllocated) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot delete an already allocated landed cost",
        });
      }

      await ctx.prisma.landedCost.delete({
        where: { id: input.id },
      });

      // Audit event
      await ctx.prisma.auditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "LandedCost",
          entityId: input.id,
          action: "DELETED",
          userId: ctx.token ?? null,
          previousState: JSON.parse(JSON.stringify(existing)),
        },
      });

      return { success: true };
    }),

  /**
   * Preview allocation for all unallocated landed costs on a GR
   */
  previewAllocation: protectedClientProcedure
    .input(z.object({ goodsReceiptId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify GR belongs to this installation
      const gr = await ctx.prisma.goodsReceipt.findFirst({
        where: {
          id: input.goodsReceiptId,
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

      const preview = await generateAllocationPreview(ctx.prisma, input.goodsReceiptId);
      return { allocations: preview };
    }),

  /**
   * Execute allocation for all unallocated landed costs on a GR
   * This is typically called automatically during GR posting
   */
  allocate: protectedClientProcedure
    .input(z.object({ goodsReceiptId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify GR belongs to this installation and is in DRAFT status
      const gr = await ctx.prisma.goodsReceipt.findFirst({
        where: {
          id: input.goodsReceiptId,
          purchaseOrder: {
            installationId: ctx.installationId,
          },
        },
        select: { id: true, status: true },
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
          message: `Cannot allocate landed costs on goods receipt in ${gr.status} status`,
        });
      }

      const result = await executeAllocations(ctx.prisma, input.goodsReceiptId);

      // Audit event
      await ctx.prisma.auditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "GoodsReceipt",
          entityId: input.goodsReceiptId,
          action: "LANDED_COSTS_ALLOCATED",
          userId: ctx.token ?? null,
          metadata: JSON.parse(JSON.stringify({ allocatedCount: result.allocatedCount })),
        },
      });

      return result;
    }),

  /**
   * Get landed cost summary for a GR line
   */
  getLineSummary: protectedClientProcedure
    .input(z.object({ lineId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const line = await ctx.prisma.goodsReceiptLine.findFirst({
        where: {
          id: input.lineId,
          goodsReceipt: {
            purchaseOrder: {
              installationId: ctx.installationId,
            },
          },
        },
        include: {
          landedCostAllocations: {
            include: {
              landedCost: true,
            },
          },
        },
      });

      if (!line) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Line not found",
        });
      }

      const totalLandedCost = await getTotalLandedCostForLine(ctx.prisma, input.lineId);
      const perUnitLandedCost = await getLandedCostPerUnit(ctx.prisma, input.lineId);

      return {
        lineId: line.id,
        totalLandedCost: totalLandedCost.toFixed(4),
        perUnitLandedCost: perUnitLandedCost.toFixed(4),
        allocations: line.landedCostAllocations.map((a) => ({
          costType: a.landedCost.costType,
          description: a.landedCost.description,
          allocatedAmount: a.allocatedAmount.toString(),
        })),
      };
    }),

  /**
   * Get total landed costs for a GR
   */
  getGRSummary: protectedClientProcedure
    .input(z.object({ goodsReceiptId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const gr = await ctx.prisma.goodsReceipt.findFirst({
        where: {
          id: input.goodsReceiptId,
          purchaseOrder: {
            installationId: ctx.installationId,
          },
        },
        include: {
          landedCosts: true,
          lines: {
            include: {
              landedCostAllocations: true,
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

      const totalLandedCost = gr.landedCosts.reduce(
        (sum, lc) => sum + parseFloat(lc.amount.toString()),
        0
      );

      const totalAllocated = gr.lines.reduce((sum, line) => {
        return (
          sum +
          line.landedCostAllocations.reduce(
            (lineSum, a) => lineSum + parseFloat(a.allocatedAmount.toString()),
            0
          )
        );
      }, 0);

      const unallocatedCount = gr.landedCosts.filter((lc) => !lc.isAllocated).length;

      return {
        totalLandedCost: totalLandedCost.toFixed(4),
        totalAllocated: totalAllocated.toFixed(4),
        landedCostCount: gr.landedCosts.length,
        unallocatedCount,
        currency: gr.landedCosts[0]?.currency || "USD",
        byType: gr.landedCosts.reduce(
          (acc, lc) => {
            const type = lc.costType;
            if (!acc[type]) {
              acc[type] = 0;
            }
            acc[type] += parseFloat(lc.amount.toString());
            return acc;
          },
          {} as Record<string, number>
        ),
      };
    }),
});
