/**
 * Next.js instrumentation hook — runs once on server startup.
 *
 * Recovers orphaned import jobs (stuck in RUNNING status) that were abandoned
 * when the previous container was killed (e.g., ECS scale-to-zero at midnight).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    // Dynamic imports to avoid Prisma/env loading during build phase
    const { prisma } = await import("@/lib/prisma");
    const { env } = await import("@/lib/env");
    const { recoverOrphanedJobs } = await import("@/modules/import/orphan-recovery");

    const result = await recoverOrphanedJobs(prisma, env.ORPHAN_JOB_THRESHOLD_MINUTES);

    if (result.count > 0) {
      console.log(
        `[OrphanRecovery] Startup: recovered ${result.count} orphaned job(s)`,
        result.recovered,
      );
    }
  } catch (err) {
    // Never crash the server — just log the failure
    console.error("[OrphanRecovery] Startup recovery failed (non-fatal):", err);
  }
}
