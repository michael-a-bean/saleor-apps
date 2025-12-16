import { costLayersRouter } from "@/modules/cost-layers";
import { goodsReceiptsRouter } from "@/modules/goods-receipts";
import { landedCostsRouter } from "@/modules/landed-costs";
import { purchaseOrdersRouter } from "@/modules/purchase-orders";
import { reportingRouter } from "@/modules/reporting";
import { suppliersRouter } from "@/modules/suppliers";

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
 * Main tRPC router
 */
export const trpcRouter = router({
  health: healthRouter,
  suppliers: suppliersRouter,
  purchaseOrders: purchaseOrdersRouter,
  goodsReceipts: goodsReceiptsRouter,
  landedCosts: landedCostsRouter,
  costLayers: costLayersRouter,
  reporting: reportingRouter,
});

export type TrpcRouter = typeof trpcRouter;
