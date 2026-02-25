import type { PrismaClient } from "@/generated/prisma";

import { createLogger } from "@/lib/logger";

const logger = createLogger("OrphanRecovery");

export interface RecoveryResult {
  recovered: Array<{ id: string; setCode: string | null; lastUpdated: Date }>;
  count: number;
}

/**
 * Find RUNNING jobs whose `updatedAt` is older than `thresholdMinutes` and mark them FAILED.
 *
 * The checkpoint cadence during normal processing is ~25s, so any RUNNING job that hasn't
 * been updated in 10+ minutes is almost certainly orphaned (container killed, OOM, etc.).
 */
export async function recoverOrphanedJobs(
  prisma: PrismaClient,
  thresholdMinutes: number,
): Promise<RecoveryResult> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);

  const staleJobs = await prisma.importJob.findMany({
    where: {
      status: "RUNNING",
      updatedAt: { lt: cutoff },
    },
    select: { id: true, setCode: true, updatedAt: true },
  });

  if (staleJobs.length === 0) {
    logger.info("No orphaned jobs found");
    return { recovered: [], count: 0 };
  }

  const ids = staleJobs.map((j) => j.id);

  await prisma.importJob.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "FAILED",
      errorMessage: `Orphaned: no checkpoint update for ${thresholdMinutes}+ minutes (container likely killed). Checkpoint preserved — retry to resume.`,
    },
  });

  const recovered = staleJobs.map((j) => ({
    id: j.id,
    setCode: j.setCode,
    lastUpdated: j.updatedAt,
  }));

  logger.warn("Recovered orphaned jobs", { count: recovered.length, jobs: recovered });

  return { recovered, count: recovered.length };
}
