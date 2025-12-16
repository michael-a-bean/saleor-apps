import { z } from "zod";

import { getCostHistory, getInventoryValuation } from "@/modules/cost-layers";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

/**
 * Reporting Router - High-level reports for inventory management
 */
export const reportingRouter = router({
  /**
   * Full inventory valuation report
   */
  inventoryValuation: protectedClientProcedure
    .input(
      z
        .object({
          warehouseId: z.string().optional(),
          currency: z.string().optional().default("USD"),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const valuation = await getInventoryValuation({
        prisma: ctx.prisma,
        installationId: ctx.installationId,
        warehouseId: input?.warehouseId,
        currency: input?.currency,
      });

      return {
        ...valuation,
        warehouseId: input?.warehouseId || null,
        warehouseName: input?.warehouseId || null,
        itemCount: valuation.items.length,
        totalQuantity: valuation.items.reduce((sum, item) => sum + item.qtyOnHand, 0),
      };
    }),

  /**
   * Cost history report with filtering and pagination
   */
  costHistory: protectedClientProcedure
    .input(
      z.object({
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
        variantId: z.string().optional(),
        warehouseId: z.string().optional(),
        eventType: z
          .enum(["GOODS_RECEIPT", "GOODS_RECEIPT_REVERSAL", "LANDED_COST_ADJUSTMENT"])
          .optional(),
        limit: z.number().min(1).max(500).optional().default(100),
        offset: z.number().min(0).optional().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await getCostHistory({
        prisma: ctx.prisma,
        installationId: ctx.installationId,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        eventType: input.eventType,
        limit: input.limit,
        offset: input.offset,
      });

      let totalQtyDelta = 0;
      let totalValueDelta = 0;

      for (const event of result.events) {
        totalQtyDelta += event.qtyDelta;
        const unitCost = Number(event.unitCost) + Number(event.landedCostDelta);
        totalValueDelta += event.qtyDelta * unitCost;
      }

      return {
        events: result.events.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          eventTimestamp: event.eventTimestamp,
          saleorVariantId: event.saleorVariantId,
          saleorWarehouseId: event.saleorWarehouseId,
          variantSku: event.sourceGrLine?.saleorVariantSku || null,
          variantName: event.sourceGrLine?.saleorVariantName || null,
          receiptNumber: event.sourceGrLine?.goodsReceipt.receiptNumber || null,
          receiptId: event.sourceGrLine?.goodsReceipt.id || null,
          qtyDelta: event.qtyDelta,
          unitCost: event.unitCost.toString(),
          landedCostDelta: event.landedCostDelta.toString(),
          totalUnitCost: (Number(event.unitCost) + Number(event.landedCostDelta)).toFixed(4),
          currency: event.currency,
          wacAtEvent: event.wacAtEvent?.toString() || null,
          qtyOnHandAtEvent: event.qtyOnHandAtEvent,
          createdBy: event.createdBy,
        })),
        total: result.total,
        hasMore: input.offset + result.events.length < result.total,
        summary: {
          totalQtyDelta,
          totalValueDelta: totalValueDelta.toFixed(4),
          eventsInPage: result.events.length,
        },
      };
    }),

  /**
   * Stock movement summary by variant
   */
  stockMovementSummary: protectedClientProcedure
    .input(
      z.object({
        startDate: z.string().datetime().optional(),
        endDate: z.string().datetime().optional(),
        warehouseId: z.string().optional(),
        limit: z.number().min(1).max(100).optional().default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const events = await ctx.prisma.costLayerEvent.findMany({
        where: {
          installationId: ctx.installationId,
          ...(input.warehouseId && { saleorWarehouseId: input.warehouseId }),
          ...(input.startDate || input.endDate
            ? {
                eventTimestamp: {
                  ...(input.startDate && { gte: new Date(input.startDate) }),
                  ...(input.endDate && { lte: new Date(input.endDate) }),
                },
              }
            : {}),
        },
        include: {
          sourceGrLine: {
            select: {
              saleorVariantSku: true,
              saleorVariantName: true,
            },
          },
        },
      });

      const variantMap = new Map<
        string,
        {
          variantId: string;
          warehouseId: string;
          variantSku: string | null;
          variantName: string | null;
          receipts: number;
          reversals: number;
          netQty: number;
          netValue: number;
          currency: string;
        }
      >();

      for (const event of events) {
        const key = `${event.saleorVariantId}:${event.saleorWarehouseId}`;
        const existing = variantMap.get(key);
        const unitCost = Number(event.unitCost) + Number(event.landedCostDelta);

        if (existing) {
          if (event.qtyDelta > 0) {
            existing.receipts += event.qtyDelta;
          } else {
            existing.reversals += Math.abs(event.qtyDelta);
          }
          existing.netQty += event.qtyDelta;
          existing.netValue += event.qtyDelta * unitCost;
        } else {
          variantMap.set(key, {
            variantId: event.saleorVariantId,
            warehouseId: event.saleorWarehouseId,
            variantSku: event.sourceGrLine?.saleorVariantSku || null,
            variantName: event.sourceGrLine?.saleorVariantName || null,
            receipts: event.qtyDelta > 0 ? event.qtyDelta : 0,
            reversals: event.qtyDelta < 0 ? Math.abs(event.qtyDelta) : 0,
            netQty: event.qtyDelta,
            netValue: event.qtyDelta * unitCost,
            currency: event.currency,
          });
        }
      }

      const items = Array.from(variantMap.values())
        .map((item) => ({
          ...item,
          netValue: item.netValue.toFixed(4),
        }))
        .sort((a, b) => Math.abs(parseFloat(b.netValue)) - Math.abs(parseFloat(a.netValue)))
        .slice(0, input.limit);

      return {
        items,
        totalVariants: variantMap.size,
        dateRange: {
          start: input.startDate || null,
          end: input.endDate || null,
        },
      };
    }),

  /**
   * Dashboard summary statistics
   */
  dashboardSummary: protectedClientProcedure.query(async ({ ctx }) => {
    const [totalEvents, recentEvents, postedGRCount, draftGRCount] = await Promise.all([
      ctx.prisma.costLayerEvent.count({
        where: { installationId: ctx.installationId },
      }),
      ctx.prisma.costLayerEvent.findMany({
        where: { installationId: ctx.installationId },
        orderBy: { eventTimestamp: "desc" },
        take: 5,
        include: {
          sourceGrLine: {
            select: {
              saleorVariantSku: true,
              goodsReceipt: {
                select: {
                  receiptNumber: true,
                },
              },
            },
          },
        },
      }),
      ctx.prisma.goodsReceipt.count({
        where: {
          purchaseOrder: { installationId: ctx.installationId },
          status: "POSTED",
        },
      }),
      ctx.prisma.goodsReceipt.count({
        where: {
          purchaseOrder: { installationId: ctx.installationId },
          status: "DRAFT",
        },
      }),
    ]);

    const valuation = await getInventoryValuation({
      prisma: ctx.prisma,
      installationId: ctx.installationId,
    });

    return {
      inventory: {
        totalValue: valuation.totalValue,
        itemCount: valuation.items.length,
        totalQuantity: valuation.items.reduce((sum, item) => sum + item.qtyOnHand, 0),
        currency: valuation.currency,
      },
      activity: {
        totalCostEvents: totalEvents,
        postedReceipts: postedGRCount,
        draftReceipts: draftGRCount,
      },
      recentEvents: recentEvents.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        eventTimestamp: event.eventTimestamp,
        qtyDelta: event.qtyDelta,
        variantSku: event.sourceGrLine?.saleorVariantSku || null,
        receiptNumber: event.sourceGrLine?.goodsReceipt.receiptNumber || null,
      })),
    };
  }),
});
