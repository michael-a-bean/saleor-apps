import { auditRouter } from "@/modules/audit";
import { importRouter } from "@/modules/import";
import { jobsRouter } from "@/modules/jobs";
import { scryfallRouter } from "@/modules/scryfall";

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
  jobs: jobsRouter,
  scryfall: scryfallRouter,
  import: importRouter,
  audit: auditRouter,
});

export type TrpcRouter = typeof trpcRouter;
