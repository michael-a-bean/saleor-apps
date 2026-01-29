import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { createGraphQLClient } from "@/lib/graphql-client";
import { saleorApp } from "@/lib/saleor-app";
import { PrismaQueueService } from "@/modules/jobs";
import { processJob } from "@/modules/import";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

const logger = createLogger("CronProcessJobs");

export async function GET(request: Request) {
  // Verify cron secret for security
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    logger.warn("Unauthorized cron request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    logger.info("Starting job processing cron");

    // Get all installations
    const installations = await prisma.appInstallation.findMany({});

    const results = [];
    let jobsProcessed = 0;

    for (const installation of installations) {
      try {
        const queueService = new PrismaQueueService(prisma);

        // Get next pending job for this installation
        const jobId = await queueService.getNextPendingJob(installation.id);

        if (!jobId) {
          logger.debug("No pending jobs for installation", {
            installationId: installation.id,
          });
          continue;
        }

        // Get auth data for GraphQL client
        const authData = await saleorApp.apl.get(installation.saleorApiUrl);

        if (!authData) {
          logger.warn("No auth data for installation, skipping", {
            installationId: installation.id,
          });
          continue;
        }

        // Create GraphQL client with app token
        const graphqlClient = createGraphQLClient({
          saleorApiUrl: authData.saleorApiUrl,
          token: authData.token,
        });

        // Process the job
        // Note: In a real implementation, you'd configure transformConfig
        // based on the actual Saleor product type and attribute IDs
        const result = await processJob(jobId, {
          installationId: installation.id,
          prisma,
          graphqlClient,
          transformConfig: {
            productTypeId: "placeholder-product-type-id",  // TODO: Get from config
            channelIds: env.DEFAULT_CHANNEL_SLUGS.split(","),
            attributeIds: {},  // TODO: Get from config
          },
        });

        jobsProcessed++;
        results.push({
          installationId: installation.id,
          jobId,
          success: result.success,
          imported: result.imported,
          errors: result.errors,
        });
      } catch (error) {
        logger.error("Error processing job for installation", {
          installationId: installation.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info("Job processing cron completed", {
      installationsChecked: installations.length,
      jobsProcessed,
    });

    return NextResponse.json({
      status: "ok",
      installationsChecked: installations.length,
      jobsProcessed,
      results,
    });
  } catch (error) {
    logger.error("Cron job failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
