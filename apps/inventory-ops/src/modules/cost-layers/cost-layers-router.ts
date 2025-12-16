import { z } from "zod";

import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

import {
  calculateWac,
  calculateWacHistory,
  getCostHistory,
  getInventoryValuation,
} from "./wac-service";

/**
 * Cost Layers Router - WAC calculation and cost history
 */
export const costLayersRouter = router({
  /**
   * Get current WAC for a variant/warehouse
   */
  getWac: protectedClientProcedure
    .input(
      z.object({
        variantId: z.string(),
        warehouseId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      return calculateWac({
        prisma: ctx.prisma,
        installationId: ctx.installationId,
        variantId: input.variantId,
        warehouseId: input.warehouseId,
      });
    }),

  /**
   * Get WAC for multiple variant/warehouse combinations
   */
  getWacBatch: protectedClientProcedure
    .input(
      z.object({
        items: z.array(
          z.object({
            variantId: z.string(),
            warehouseId: z.string(),
          })
        ),
      })
    )
    .query(async ({ ctx, input }) => {
      const results = await Promise.all(
        input.items.map((item) =>
          calculateWac({
            prisma: ctx.prisma,
            installationId: ctx.installationId,
            variantId: item.variantId,
            warehouseId: item.warehouseId,
          })
        )
      );
      return results;
    }),

  /**
   * Get cost event history for a variant/warehouse with running WAC
   */
  getHistory: protectedClientProcedure
    .input(
      z.object({
        variantId: z.string(),
        warehouseId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const history = await calculateWacHistory({
        prisma: ctx.prisma,
        installationId: ctx.installationId,
        variantId: input.variantId,
        warehouseId: input.warehouseId,
      });

      const latestLine = await ctx.prisma.goodsReceiptLine.findFirst({
        where: {
          saleorVariantId: input.variantId,
          goodsReceipt: {
            saleorWarehouseId: input.warehouseId,
            purchaseOrder: {
              installationId: ctx.installationId,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        select: {
          saleorVariantSku: true,
          saleorVariantName: true,
          currency: true,
        },
      });

      return {
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        variantSku: latestLine?.saleorVariantSku || null,
        variantName: latestLine?.saleorVariantName || null,
        currency: latestLine?.currency || "USD",
        events: history,
      };
    }),

  /**
   * Get inventory value for a variant/warehouse
   */
  getInventoryValue: protectedClientProcedure
    .input(
      z.object({
        variantId: z.string(),
        warehouseId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      const wac = await calculateWac({
        prisma: ctx.prisma,
        installationId: ctx.installationId,
        variantId: input.variantId,
        warehouseId: input.warehouseId,
      });

      return {
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        qtyOnHand: wac.qtyOnHand,
        wac: wac.wac,
        totalValue: wac.totalValue,
        currency: wac.currency,
      };
    }),

  /**
   * Get full inventory valuation report
   */
  getInventoryValuation: protectedClientProcedure
    .input(
      z
        .object({
          warehouseId: z.string().optional(),
          currency: z.string().optional().default("USD"),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      return getInventoryValuation({
        prisma: ctx.prisma,
        installationId: ctx.installationId,
        warehouseId: input?.warehouseId,
        currency: input?.currency,
      });
    }),

  /**
   * Get cost event history with filtering
   */
  getCostHistory: protectedClientProcedure
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

      return {
        events: result.events.map((event) => ({
          id: event.id,
          eventType: event.eventType,
          eventTimestamp: event.eventTimestamp,
          saleorVariantId: event.saleorVariantId,
          saleorWarehouseId: event.saleorWarehouseId,
          qtyDelta: event.qtyDelta,
          unitCost: event.unitCost.toString(),
          landedCostDelta: event.landedCostDelta.toString(),
          currency: event.currency,
          wacAtEvent: event.wacAtEvent?.toString() || null,
          qtyOnHandAtEvent: event.qtyOnHandAtEvent,
          sourceGrLine: event.sourceGrLine,
          createdBy: event.createdBy,
        })),
        total: result.total,
        hasMore: input.offset + result.events.length < result.total,
      };
    }),

  /**
   * Get summary statistics for cost layers
   */
  getSummary: protectedClientProcedure.query(async ({ ctx }) => {
    const [totalEvents, uniqueVariants, eventsByType] = await Promise.all([
      ctx.prisma.costLayerEvent.count({
        where: { installationId: ctx.installationId },
      }),
      ctx.prisma.costLayerEvent.groupBy({
        by: ["saleorVariantId"],
        where: { installationId: ctx.installationId },
      }),
      ctx.prisma.costLayerEvent.groupBy({
        by: ["eventType"],
        where: { installationId: ctx.installationId },
        _count: true,
      }),
    ]);

    const valuation = await getInventoryValuation({
      prisma: ctx.prisma,
      installationId: ctx.installationId,
    });

    return {
      totalEvents,
      uniqueVariants: uniqueVariants.length,
      eventsByType: eventsByType.map((e) => ({
        type: e.eventType,
        count: e._count,
      })),
      totalInventoryValue: valuation.totalValue,
      totalItemsInStock: valuation.items.length,
      currency: valuation.currency,
    };
  }),
});
