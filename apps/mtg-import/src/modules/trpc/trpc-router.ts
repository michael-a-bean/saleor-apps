import { protectedClientProcedure } from "./protected-client-procedure";
import { jobsRouter, setsRouter } from "./import-router";
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
});

export type TrpcRouter = typeof trpcRouter;
