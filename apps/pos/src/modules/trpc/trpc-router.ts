import { paymentsRouter } from "@/modules/payments";
import { receiptsRouter } from "@/modules/receipts";
import { registerRouter } from "@/modules/register";
import { transactionsRouter } from "@/modules/transactions";

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
 * Routers will be added as they are implemented:
 * - returns: Return/exchange flows
 * - cashManagement: Drops, payouts, drawer status
 * - customers: Lookup, create, attach to transaction
 * - credits: Store credit balance and transactions
 */
export const trpcRouter = router({
  health: healthRouter,
  register: registerRouter,
  transactions: transactionsRouter,
  payments: paymentsRouter,
  receipts: receiptsRouter,
});

export type TrpcRouter = typeof trpcRouter;
