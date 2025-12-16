import { z } from "zod";

import { protectedClientProcedure } from "./protected-client-procedure";
import { router } from "./trpc-server";

/**
 * Health check router - verifies app installation and DB connection
 */
const healthRouter = router({
  check: protectedClientProcedure.query(async ({ ctx }) => {
    return {
      status: "ok",
      installationId: ctx.installationId,
      saleorApiUrl: ctx.saleorApiUrl,
    };
  }),
});

/**
 * Placeholder routers - will be implemented in later phases
 */
const suppliersRouter = router({
  list: protectedClientProcedure.query(async ({ ctx }) => {
    const suppliers = await ctx.prisma.supplier.findMany({
      where: { installationId: ctx.installationId },
      orderBy: { name: "asc" },
    });

    return suppliers;
  }),
});

const purchaseOrdersRouter = router({
  list: protectedClientProcedure
    .input(
      z
        .object({
          status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "PARTIALLY_RECEIVED", "FULLY_RECEIVED", "CANCELLED"]).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const purchaseOrders = await ctx.prisma.purchaseOrder.findMany({
        where: {
          installationId: ctx.installationId,
          ...(input?.status && { status: input.status }),
        },
        include: {
          supplier: true,
          _count: {
            select: { lines: true, goodsReceipts: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return purchaseOrders;
    }),
});

const goodsReceiptsRouter = router({
  list: protectedClientProcedure.query(async ({ ctx }) => {
    const goodsReceipts = await ctx.prisma.goodsReceipt.findMany({
      where: {
        purchaseOrder: {
          installationId: ctx.installationId,
        },
      },
      include: {
        purchaseOrder: {
          select: {
            orderNumber: true,
            supplier: { select: { name: true } },
          },
        },
        _count: {
          select: { lines: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return goodsReceipts;
  }),
});

const costLayersRouter = router({
  getWac: protectedClientProcedure
    .input(
      z.object({
        variantId: z.string(),
        warehouseId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get all cost events for this variant/warehouse
      const events = await ctx.prisma.costLayerEvent.findMany({
        where: {
          installationId: ctx.installationId,
          saleorVariantId: input.variantId,
          saleorWarehouseId: input.warehouseId,
        },
        orderBy: { eventTimestamp: "asc" },
      });

      // Calculate WAC
      let totalQty = 0;
      let totalValue = 0;

      for (const event of events) {
        totalQty += event.qtyDelta;
        totalValue += event.qtyDelta * Number(event.unitCost);
      }

      const wac = totalQty > 0 ? totalValue / totalQty : 0;

      return {
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        wac: wac.toFixed(4),
        qtyOnHand: totalQty,
        eventCount: events.length,
      };
    }),
});

/**
 * Main tRPC router
 */
export const trpcRouter = router({
  health: healthRouter,
  suppliers: suppliersRouter,
  purchaseOrders: purchaseOrdersRouter,
  goodsReceipts: goodsReceiptsRouter,
  costLayers: costLayersRouter,
});

export type TrpcRouter = typeof trpcRouter;
