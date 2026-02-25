import { NextResponse } from "next/server";

import { verifyBearerToken } from "@/lib/auth";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { recoverOrphanedJobs } from "@/modules/import/orphan-recovery";

export const runtime = "nodejs";
export const maxDuration = 30;

const logger = createLogger("CronRecoverOrphans");

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (!verifyBearerToken(authHeader, env.CRON_SECRET)) {
    logger.warn("Unauthorized cron request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await recoverOrphanedJobs(prisma, env.ORPHAN_JOB_THRESHOLD_MINUTES);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Orphan recovery cron failed", { error: message });

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
