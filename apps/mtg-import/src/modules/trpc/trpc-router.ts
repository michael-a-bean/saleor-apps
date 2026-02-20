import { protectedClientProcedure } from "./protected-client-procedure";
import { jobsRouter, setsRouter, systemRouter, catalogRouter } from "./import-router";
import { router } from "./trpc-server";

const healthRouter = router({
  check: protectedClientProcedure.query(async ({ ctx }) => {
    return {
      status: "ok",
      installationId: ctx.installationId,
      saleorApiUrl: ctx.saleorApiUrl,
    };
  }),
});

export const trpcRouter = router({
  health: healthRouter,
  jobs: jobsRouter,
  sets: setsRouter,
  system: systemRouter,
  catalog: catalogRouter,
});

export type TrpcRouter = typeof trpcRouter;
