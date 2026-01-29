import { JobStatus, JobType, PrismaClient } from "@prisma/client";
import { Client } from "urql";

import { createLogger } from "@/lib/logger";
import { PrismaQueueService, JobConfig, JobCheckpoint } from "@/modules/jobs";
import { ScryfallCard, getEnglishPaperCards, getCardsForSet, groupCardsBySet } from "@/modules/scryfall";

import { createProductWithVariants } from "./graphql-mutations";
import { transformCard, TransformConfig } from "./transform";

const logger = createLogger("import-processor");

/**
 * Import processor configuration
 */
export interface ProcessorConfig {
  installationId: string;
  prisma: PrismaClient;
  graphqlClient: Client;
  transformConfig: TransformConfig;
  batchSize?: number;
  onProgress?: (progress: number, total: number) => void;
}

/**
 * Process a bulk import job
 */
export async function processBulkImportJob(
  jobId: string,
  config: ProcessorConfig
): Promise<{ success: boolean; imported: number; errors: number }> {
  const { prisma, graphqlClient, transformConfig, batchSize = 100 } = config;
  const queueService = new PrismaQueueService(prisma);

  logger.info("Starting bulk import job", { jobId });

  // Get the job
  const job = await queueService.getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const jobConfig = job.config as JobConfig | null;

  // Load checkpoint if resuming
  const checkpoint = job.checkpoint as JobCheckpoint | null;
  const startIndex = checkpoint?.lastProcessedIndex ?? 0;

  // Get all English paper cards
  logger.info("Loading cards from Scryfall cache");
  const allCards = await getEnglishPaperCards();

  // Update total items
  await queueService.updateJob(jobId, { totalItems: allCards.length });

  logger.info("Starting import", {
    totalCards: allCards.length,
    startIndex,
    batchSize,
  });

  let imported = 0;
  let errors = 0;
  let currentIndex = startIndex;

  try {
    // Process in batches
    while (currentIndex < allCards.length) {
      const batchEnd = Math.min(currentIndex + batchSize, allCards.length);
      const batch = allCards.slice(currentIndex, batchEnd);

      logger.debug("Processing batch", {
        batchStart: currentIndex,
        batchEnd,
        batchSize: batch.length,
      });

      // Process each card in the batch
      for (const card of batch) {
        try {
          const { product, variants } = transformCard(card, transformConfig);
          const result = await createProductWithVariants(graphqlClient, product, variants);

          if (result.success) {
            imported++;

            // Track imported product
            await prisma.importedProduct.upsert({
              where: {
                installationId_scryfallId: {
                  installationId: config.installationId,
                  scryfallId: card.id,
                },
              },
              update: {
                saleorProductId: result.productId!,
                lastSyncedAt: new Date(),
                variantCount: variants.length,
              },
              create: {
                installationId: config.installationId,
                scryfallId: card.id,
                oracleId: card.oracle_id,
                tcgplayerId: card.tcgplayer_id,
                saleorProductId: result.productId!,
                setCode: card.set,
                setName: card.set_name,
                cardName: card.name,
                collectorNumber: card.collector_number,
                variantCount: variants.length,
              },
            });
          } else {
            errors++;
            logger.warn("Failed to import card", {
              cardName: card.name,
              scryfallId: card.id,
              errors: result.errors,
            });
          }
        } catch (error) {
          errors++;
          logger.error("Error processing card", {
            cardName: card.name,
            scryfallId: card.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        currentIndex++;
      }

      // Update progress and checkpoint
      await queueService.updateJob(jobId, {
        progress: currentIndex,
        checkpoint: {
          lastProcessedIndex: currentIndex,
          processedCount: imported,
          errorCount: errors,
        },
      });

      // Log progress
      const progressPercent = ((currentIndex / allCards.length) * 100).toFixed(1);
      logger.info("Import progress", {
        progress: progressPercent + "%",
        imported,
        errors,
        current: currentIndex,
        total: allCards.length,
      });

      // Call progress callback if provided
      config.onProgress?.(currentIndex, allCards.length);
    }

    logger.info("Bulk import completed", { imported, errors, total: allCards.length });

    return { success: true, imported, errors };
  } catch (error) {
    logger.error("Bulk import failed", {
      error: error instanceof Error ? error.message : String(error),
      currentIndex,
      imported,
      errors,
    });

    // Save checkpoint for resume
    await queueService.updateJob(jobId, {
      checkpoint: {
        lastProcessedIndex: currentIndex,
        processedCount: imported,
        errorCount: errors,
        lastError: error instanceof Error ? error.message : String(error),
      },
    });

    throw error;
  }
}

/**
 * Process a new set import job
 */
export async function processNewSetJob(
  jobId: string,
  config: ProcessorConfig
): Promise<{ success: boolean; imported: number; errors: number }> {
  const { prisma, graphqlClient, transformConfig } = config;
  const queueService = new PrismaQueueService(prisma);

  logger.info("Starting new set import job", { jobId });

  // Get the job
  const job = await queueService.getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const jobConfig = job.config as JobConfig | null;
  const setCode = jobConfig?.setCode;

  if (!setCode) {
    throw new Error("No setCode provided in job config");
  }

  logger.info("Importing set", { setCode });

  // Get cards for the set
  const cards = await getCardsForSet(setCode);

  // Update total items
  await queueService.updateJob(jobId, { totalItems: cards.length });

  logger.info("Found cards for set", { setCode, cardCount: cards.length });

  let imported = 0;
  let errors = 0;

  try {
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];

      try {
        const { product, variants } = transformCard(card, transformConfig);
        const result = await createProductWithVariants(graphqlClient, product, variants);

        if (result.success) {
          imported++;

          // Track imported product
          await prisma.importedProduct.upsert({
            where: {
              installationId_scryfallId: {
                installationId: config.installationId,
                scryfallId: card.id,
              },
            },
            update: {
              saleorProductId: result.productId!,
              lastSyncedAt: new Date(),
              variantCount: variants.length,
            },
            create: {
              installationId: config.installationId,
              scryfallId: card.id,
              oracleId: card.oracle_id,
              tcgplayerId: card.tcgplayer_id,
              saleorProductId: result.productId!,
              setCode: card.set,
              setName: card.set_name,
              cardName: card.name,
              collectorNumber: card.collector_number,
              variantCount: variants.length,
            },
          });
        } else {
          errors++;
        }
      } catch (error) {
        errors++;
        logger.error("Error processing card", {
          cardName: card.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Update progress
      await queueService.updateJob(jobId, {
        progress: i + 1,
        checkpoint: {
          lastProcessedIndex: i + 1,
          processedCount: imported,
          errorCount: errors,
        },
      });
    }

    logger.info("Set import completed", { setCode, imported, errors });

    return { success: true, imported, errors };
  } catch (error) {
    logger.error("Set import failed", {
      setCode,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

/**
 * Main job processor - routes to appropriate handler based on job type
 */
export async function processJob(
  jobId: string,
  config: ProcessorConfig
): Promise<{ success: boolean; imported: number; errors: number }> {
  const { prisma } = config;
  const queueService = new PrismaQueueService(prisma);

  // Claim the job
  const claimed = await queueService.claimJob(jobId);
  if (!claimed) {
    throw new Error(`Failed to claim job: ${jobId}`);
  }

  const job = await queueService.getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  try {
    let result: { success: boolean; imported: number; errors: number };

    switch (job.jobType) {
      case JobType.BULK_IMPORT:
        result = await processBulkImportJob(jobId, config);
        break;

      case JobType.NEW_SET:
        result = await processNewSetJob(jobId, config);
        break;

      // TODO: Implement other job types
      case JobType.ATTRIBUTE_ENRICHMENT:
      case JobType.CHANNEL_SYNC:
      case JobType.RECONCILIATION:
      case JobType.AUDIT:
      case JobType.REMEDIATION:
        throw new Error(`Job type not implemented: ${job.jobType}`);

      default:
        throw new Error(`Unknown job type: ${job.jobType}`);
    }

    // Complete the job
    await queueService.completeJob(jobId);

    return result;
  } catch (error) {
    // Fail the job
    await queueService.failJob(
      jobId,
      error instanceof Error ? error.message : String(error)
    );

    throw error;
  }
}
