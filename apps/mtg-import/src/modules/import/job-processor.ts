/**
 * Import job processor.
 *
 * Processes import jobs by:
 * 1. Resolving Saleor import context (channels, product type, category, warehouse)
 * 2. Streaming cards from Scryfall bulk data (or searching for a specific set)
 * 3. Converting cards to product inputs via the pipeline
 * 4. Batching and executing productBulkCreate mutations
 * 5. Tracking progress with checkpoints for resume support
 */

import type { PrismaClient, ImportJob } from "@/generated/prisma";
import type { Client } from "urql";

import { createLogger } from "@/lib/logger";
import type { ScryfallCard } from "../scryfall/types";
import { ScryfallClient, BulkDataManager, retailPaperFilter } from "../scryfall";
import { MtgjsonBulkDataManager } from "../mtgjson";
import { SaleorImportClient } from "../saleor";
import { buildAttributeIdMap } from "./attribute-map";
import { cardToProductInput, batchCards, type PipelineOptions, DEFAULT_CONDITION_MULTIPLIERS } from "./pipeline";

const logger = createLogger("JobProcessor");

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_CONCURRENCY = 3;

export interface ProcessorConfig {
  scryfallClient: ScryfallClient;
  bulkDataManager: BulkDataManager;
  prisma: PrismaClient;
  gqlClient: Client;
  batchSize?: number;
  /** Number of concurrent productBulkCreate calls (default: 3) */
  concurrency?: number;
  /** Optional MTGJSON fallback for when Scryfall is unavailable */
  mtgjsonBulkManager?: MtgjsonBulkDataManager;
  /** Optional pre-built import client (for testing) */
  saleorImportClient?: SaleorImportClient;
}

export interface ProcessResult {
  cardsProcessed: number;
  variantsCreated: number;
  errors: number;
  skipped: number;
  errorLog: string[];
}

export class JobProcessor {
  private readonly scryfall: ScryfallClient;
  private readonly bulkData: BulkDataManager;
  private readonly prisma: PrismaClient;
  private readonly saleor: SaleorImportClient;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly mtgjsonBulk: MtgjsonBulkDataManager | null;
  private abortController: AbortController | null = null;

  constructor(config: ProcessorConfig) {
    this.scryfall = config.scryfallClient;
    this.bulkData = config.bulkDataManager;
    this.prisma = config.prisma;
    this.saleor = config.saleorImportClient ?? new SaleorImportClient(config.gqlClient);
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
    this.concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
    this.mtgjsonBulk = config.mtgjsonBulkManager ?? null;
  }

  /** Process a single import job */
  async processJob(job: ImportJob): Promise<ProcessResult> {
    this.abortController = new AbortController();
    const result: ProcessResult = {
      cardsProcessed: 0,
      variantsCreated: 0,
      errors: 0,
      skipped: 0,
      errorLog: [],
    };

    try {
      // Mark job as running
      await this.prisma.importJob.update({
        where: { id: job.id },
        data: { status: "RUNNING", startedAt: new Date() },
      });

      // Load settings (if configured) — fall back to defaults
      const settings = await this.prisma.importSettings.findUnique({
        where: { installationId: job.installationId },
      });

      // Resolve Saleor context with settings
      const importContext = await this.saleor.resolveImportContext(
        settings?.channelSlugs ?? ["webstore", "singles-builder"],
        settings?.productTypeSlug ?? "mtg-card",
        settings?.categorySlug ?? "mtg-singles",
        settings?.warehouseSlugs ?? [],
      );
      const attributeIdMap = buildAttributeIdMap(importContext.productType.productAttributes);

      // Build pipeline options from settings
      const pipelineOptions: PipelineOptions = {
        batchSize: this.batchSize,
        defaultPrice: settings?.defaultPrice ?? 0.25,
        costPriceRatio: settings?.costPriceRatio ?? 0.5,
        conditionMultipliers: settings
          ? {
              NM: settings.conditionNm,
              LP: settings.conditionLp,
              MP: settings.conditionMp,
              HP: settings.conditionHp,
              DMG: settings.conditionDmg,
            }
          : DEFAULT_CONDITION_MULTIPLIERS,
        isPublished: settings?.isPublished ?? true,
        visibleInListings: settings?.visibleInListings ?? true,
        isAvailableForPurchase: settings?.isAvailableForPurchase ?? true,
        trackInventory: settings?.trackInventory ?? false,
      };

      logger.info("Starting import job", {
        jobId: job.id,
        type: job.type,
        setCode: job.setCode,
        checkpoint: job.lastCheckpoint,
        batchSize: this.batchSize,
        concurrency: this.concurrency,
      });

      // Get card stream based on job type
      const cardStream = this.getCardStream(job);

      // Process cards in concurrent batch groups
      let currentBatch: ScryfallCard[] = [];
      const pendingBatches: ScryfallCard[][] = [];
      let totalCards = 0;
      const checkpoint = job.lastCheckpoint ? parseInt(job.lastCheckpoint, 10) : 0;
      let skipped = 0;
      let aborted = false;

      for await (const card of cardStream) {
        if (this.abortController.signal.aborted) {
          logger.info("Job aborted", { jobId: job.id });
          aborted = true;
          break;
        }

        totalCards++;

        // Resume support: skip already-processed cards
        if (skipped < checkpoint) {
          skipped++;
          continue;
        }

        // Skip digital-only and non-paper cards
        if (!retailPaperFilter(card)) continue;

        currentBatch.push(card);

        if (currentBatch.length >= this.batchSize) {
          pendingBatches.push(currentBatch);
          currentBatch = [];

          // When we've collected enough batches, process them concurrently
          if (pendingBatches.length >= this.concurrency) {
            await this.processBatchGroup(
              pendingBatches,
              job,
              importContext,
              attributeIdMap,
              result,
              pipelineOptions
            );
            pendingBatches.length = 0;

            // Checkpoint after each batch group completes
            await this.saveCheckpoint(job.id, totalCards, result);

            // Check abort after batch group (SIGTERM may have arrived during processing)
            if (this.abortController.signal.aborted) {
              aborted = true;
              break;
            }
          }
        }
      }

      // If aborted (e.g. SIGTERM), save checkpoint and mark as CANCELLED
      if (aborted) {
        await this.saveCheckpoint(job.id, totalCards, result);
        await this.prisma.importJob.update({
          where: { id: job.id },
          data: {
            status: "CANCELLED",
            cardsProcessed: result.cardsProcessed,
            cardsTotal: totalCards,
            variantsCreated: result.variantsCreated,
            errors: result.errors,
            skipped: result.skipped,
            errorLog: JSON.stringify(result.errorLog.slice(0, 100)),
            errorMessage: "Interrupted by process shutdown (SIGTERM)",
          },
        });

        logger.info("Job checkpointed and cancelled due to shutdown", {
          jobId: job.id,
          cardsProcessed: result.cardsProcessed,
          checkpoint: totalCards,
        });

        return result;
      }

      // Process remaining batches (less than concurrency group + partial batch)
      if (currentBatch.length > 0) {
        pendingBatches.push(currentBatch);
      }
      if (pendingBatches.length > 0) {
        await this.processBatchGroup(
          pendingBatches,
          job,
          importContext,
          attributeIdMap,
          result,
          pipelineOptions
        );
      }

      // Mark job complete
      const finalStatus = result.errors > 0 && result.cardsProcessed === 0 ? "FAILED" : "COMPLETED";

      await this.prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: finalStatus,
          completedAt: new Date(),
          cardsProcessed: result.cardsProcessed,
          cardsTotal: totalCards,
          variantsCreated: result.variantsCreated,
          errors: result.errors,
          skipped: result.skipped,
          errorLog: JSON.stringify(result.errorLog.slice(0, 100)),
        },
      });

      // Update SetAudit for completed imports
      if (finalStatus === "COMPLETED") {
        if ((job.type === "SET" || job.type === "BACKFILL") && job.setCode) {
          await this.updateSetAudit(job);
        } else if (job.type === "BULK") {
          await this.rebuildSetAudits(job.installationId);
        }
      }

      logger.info("Import job complete", {
        jobId: job.id,
        ...result,
        ...(result.skipped > 0 ? { note: `${result.skipped} products already existed in Saleor` } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Import job failed", { jobId: job.id, error: message });

      await this.prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          errorMessage: message.substring(0, 1000),
          cardsProcessed: result.cardsProcessed,
          variantsCreated: result.variantsCreated,
          errors: result.errors,
          skipped: result.skipped,
          errorLog: JSON.stringify(result.errorLog.slice(0, 100)),
        },
      });
    }

    return result;
  }

  /** Cancel a running job */
  cancel(): void {
    this.abortController?.abort();
  }

  // --- Private ---

  /** Check if all errors in a row are slug uniqueness violations (product already exists) */
  private isSlugDuplicateError(errors: Array<{ message: string | null; code: string; path: string | null }>): boolean {
    return (
      errors.length > 0 &&
      errors.every((e) => e.code === "UNIQUE" && (e.path === "slug" || e.message?.includes("Slug already exists")))
    );
  }

  private getCardStream(job: ImportJob): AsyncIterable<ScryfallCard> {
    if (job.type === "SET" && job.setCode) {
      return this.streamSetWithFallback(job.setCode);
    }
    if (job.type === "BACKFILL" && job.setCode) {
      return this.streamBackfillForSet(job.setCode);
    }
    return this.streamAllWithBackfillFilter();
  }

  /**
   * Stream all cards with MTGJSON fallback if Scryfall fails.
   */
  private async *streamAllWithFallback(): AsyncGenerator<ScryfallCard> {
    try {
      yield* this.bulkData.streamCards();
    } catch (error) {
      if (this.mtgjsonBulk) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn("Scryfall bulk stream failed, falling back to MTGJSON", { error: msg });
        yield* this.mtgjsonBulk.streamCards();
      } else {
        throw error;
      }
    }
  }

  /**
   * Stream all cards with smart backfill filtering.
   * Pre-filters already-imported cards to avoid wasted Saleor API calls.
   */
  private async *streamAllWithBackfillFilter(): AsyncGenerator<ScryfallCard> {
    const importedProducts = await this.prisma.importedProduct.findMany({
      where: { success: true },
      select: { scryfallId: true },
    });

    const importedIds = new Set(importedProducts.map((p) => p.scryfallId));
    logger.info("Bulk import: filtering out already-imported cards", {
      importedCount: importedIds.size,
    });

    let skippedCount = 0;
    for await (const card of this.streamAllWithFallback()) {
      if (importedIds.has(card.id)) {
        skippedCount++;
        continue;
      }
      yield card;
    }

    if (skippedCount > 0) {
      logger.info("Bulk import: pre-filtered already-imported cards", {
        skippedCount,
      });
    }
  }

  /**
   * Stream cards from a set with MTGJSON fallback if Scryfall fails.
   */
  private async *streamSetWithFallback(setCode: string): AsyncGenerator<ScryfallCard> {
    try {
      yield* this.bulkData.streamSet(setCode);
    } catch (error) {
      if (this.mtgjsonBulk) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn("Scryfall set stream failed, falling back to MTGJSON", { setCode, error: msg });
        yield* this.mtgjsonBulk.streamSet(setCode);
      } else {
        throw error;
      }
    }
  }

  /**
   * Stream only missing/failed cards for a set (smart BACKFILL).
   * Queries ImportedProduct for successfully imported scryfallIds,
   * then yields only cards NOT in that set.
   */
  private async *streamBackfillForSet(setCode: string): AsyncGenerator<ScryfallCard> {
    const importedProducts = await this.prisma.importedProduct.findMany({
      where: {
        setCode: setCode.toLowerCase(),
        success: true,
      },
      select: { scryfallId: true },
    });

    const importedIds = new Set(importedProducts.map((p) => p.scryfallId));
    logger.info("Smart backfill: filtering out already-imported cards", {
      setCode,
      importedCount: importedIds.size,
    });

    for await (const card of this.streamSetWithFallback(setCode)) {
      if (!importedIds.has(card.id)) {
        yield card;
      }
    }
  }

  /**
   * Process multiple batches concurrently.
   * Each batch runs its own productBulkCreate call in parallel.
   * Results are aggregated after all batches complete.
   */
  private async processBatchGroup(
    batches: ScryfallCard[][],
    job: ImportJob,
    importContext: Awaited<ReturnType<SaleorImportClient["resolveImportContext"]>>,
    attributeIdMap: Map<string, string>,
    result: ProcessResult,
    pipelineOptions: PipelineOptions = {}
  ): Promise<void> {
    const batchPromises = batches.map((batch) =>
      this.processBatch(batch, job, importContext, attributeIdMap, pipelineOptions)
    );

    const batchResults = await Promise.all(batchPromises);

    // Aggregate results sequentially (single-threaded, no race condition)
    for (const br of batchResults) {
      result.cardsProcessed += br.cardsProcessed;
      result.variantsCreated += br.variantsCreated;
      result.errors += br.errors;
      result.skipped += br.skipped;
      result.errorLog.push(...br.errorLog);
    }

    logger.info("Batch group processed", {
      jobId: job.id,
      batchCount: batches.length,
      totalProcessed: result.cardsProcessed,
      totalErrors: result.errors,
    });
  }

  /**
   * Process a single batch: convert cards, call productBulkCreate, record results.
   * Returns a local result (not mutating shared state) for safe concurrent use.
   */
  private async processBatch(
    cards: ScryfallCard[],
    job: ImportJob,
    importContext: Awaited<ReturnType<SaleorImportClient["resolveImportContext"]>>,
    attributeIdMap: Map<string, string>,
    pipelineOptions: PipelineOptions = {}
  ): Promise<ProcessResult> {
    const localResult: ProcessResult = {
      cardsProcessed: 0,
      variantsCreated: 0,
      errors: 0,
      skipped: 0,
      errorLog: [],
    };

    try {
      // Convert cards to product inputs
      const productInputs = cards.map((card) =>
        cardToProductInput(card, importContext, attributeIdMap, pipelineOptions)
      );

      // Execute bulk create
      const createResult = await this.saleor.bulkCreateProducts(productInputs);

      // Build all Prisma upsert operations, then execute in a single transaction
      const upsertOps: Array<ReturnType<typeof this.prisma.importedProduct.upsert>> = [];

      for (let i = 0; i < createResult.results.length; i++) {
        const row = createResult.results[i];
        const card = cards[i];

        if (row.product) {
          localResult.cardsProcessed++;
          localResult.variantsCreated += row.product.variants.length;

          upsertOps.push(
            this.prisma.importedProduct.upsert({
              where: {
                scryfallId_setCode: { scryfallId: card.id, setCode: card.set },
              },
              update: {
                importJobId: job.id,
                scryfallUri: card.scryfall_uri,
                cardName: card.name.substring(0, 250),
                collectorNumber: card.collector_number,
                rarity: card.rarity,
                saleorProductId: row.product.id,
                variantCount: row.product.variants.length,
                success: true,
                errorMessage: null,
              },
              create: {
                importJobId: job.id,
                scryfallId: card.id,
                scryfallUri: card.scryfall_uri,
                cardName: card.name.substring(0, 250),
                setCode: card.set,
                collectorNumber: card.collector_number,
                rarity: card.rarity,
                saleorProductId: row.product.id,
                variantCount: row.product.variants.length,
                success: true,
              },
            })
          );
        } else if (this.isSlugDuplicateError(row.errors)) {
          localResult.cardsProcessed++;
          localResult.skipped++;

          logger.debug("Product already exists, skipping", {
            card: card.name,
            set: card.set,
            collector: card.collector_number,
          });

          upsertOps.push(
            this.prisma.importedProduct.upsert({
              where: {
                scryfallId_setCode: { scryfallId: card.id, setCode: card.set },
              },
              update: {
                importJobId: job.id,
                cardName: card.name.substring(0, 250),
                collectorNumber: card.collector_number,
                rarity: card.rarity,
                saleorProductId: "existing",
                success: true,
                errorMessage: "Already exists in Saleor (duplicate slug)",
              },
              create: {
                importJobId: job.id,
                scryfallId: card.id,
                cardName: card.name.substring(0, 250),
                setCode: card.set,
                collectorNumber: card.collector_number,
                rarity: card.rarity,
                saleorProductId: "existing",
                success: true,
                errorMessage: "Already exists in Saleor (duplicate slug)",
              },
            })
          );
        } else {
          localResult.errors++;
          const errorMsg = row.errors.map((e) => e.message).join("; ");
          localResult.errorLog.push(`${card.name} [${card.set}#${card.collector_number}]: ${errorMsg}`);

          upsertOps.push(
            this.prisma.importedProduct.upsert({
              where: {
                scryfallId_setCode: { scryfallId: card.id, setCode: card.set },
              },
              update: {
                importJobId: job.id,
                cardName: card.name.substring(0, 250),
                collectorNumber: card.collector_number,
                rarity: card.rarity,
                saleorProductId: "",
                success: false,
                errorMessage: errorMsg.substring(0, 1000),
              },
              create: {
                importJobId: job.id,
                scryfallId: card.id,
                cardName: card.name.substring(0, 250),
                setCode: card.set,
                collectorNumber: card.collector_number,
                rarity: card.rarity,
                saleorProductId: "",
                success: false,
                errorMessage: errorMsg.substring(0, 1000),
              },
            })
          );
        }
      }

      // Execute all upserts in a single transaction
      if (upsertOps.length > 0) {
        await this.prisma.$transaction(upsertOps);
      }

      logger.info("Batch processed", {
        jobId: job.id,
        batchSize: cards.length,
        processed: localResult.cardsProcessed,
        errors: localResult.errors,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      localResult.errors += cards.length;
      localResult.errorLog.push(`Batch error (${cards.length} cards): ${message}`);
      logger.error("Batch processing failed", { jobId: job.id, error: message });
    }

    return localResult;
  }

  private async saveCheckpoint(
    jobId: string,
    totalProcessed: number,
    result: ProcessResult
  ): Promise<void> {
    await this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        lastCheckpoint: String(totalProcessed),
        cardsProcessed: result.cardsProcessed,
        variantsCreated: result.variantsCreated,
        errors: result.errors,
      },
    });
    logger.info("Checkpoint saved", { jobId, totalProcessed });
  }

  /** Update SetAudit with aggregated import results for a set */
  private async updateSetAudit(job: ImportJob): Promise<void> {
    if (!job.setCode) return;

    try {
      // Count successful imports for this set across all jobs
      const importedCards = await this.prisma.importedProduct.count({
        where: {
          setCode: job.setCode,
          success: true,
          saleorProductId: { not: "existing" },
        },
      });

      // Get set metadata from Scryfall
      let setName = job.setCode.toUpperCase();
      let totalCards = 0;
      let releasedAt: Date | null = null;
      let setType: string | null = null;
      let iconSvgUri: string | null = null;

      try {
        const scryfallSet = await this.scryfall.getSet(job.setCode);
        setName = scryfallSet.name;
        totalCards = scryfallSet.card_count;
        releasedAt = scryfallSet.released_at ? new Date(scryfallSet.released_at) : null;
        setType = scryfallSet.set_type;
        iconSvgUri = scryfallSet.icon_svg_uri;
      } catch {
        // Fallback to job data if Scryfall unavailable
        totalCards = job.cardsTotal;
      }

      // Also count duplicates as imported (they exist in Saleor)
      const duplicateCount = await this.prisma.importedProduct.count({
        where: {
          setCode: job.setCode,
          success: true,
          saleorProductId: "existing",
        },
      });

      await this.prisma.setAudit.upsert({
        where: {
          installationId_setCode: {
            installationId: job.installationId,
            setCode: job.setCode,
          },
        },
        update: {
          importedCards: importedCards + duplicateCount,
          totalCards,
          lastImportedAt: new Date(),
          setName,
          releasedAt,
          setType,
          iconSvgUri,
        },
        create: {
          installationId: job.installationId,
          setCode: job.setCode,
          setName,
          totalCards,
          importedCards: importedCards + duplicateCount,
          lastImportedAt: new Date(),
          releasedAt,
          setType,
          iconSvgUri,
        },
      });

      logger.info("SetAudit updated", {
        setCode: job.setCode,
        importedCards: importedCards + duplicateCount,
        totalCards,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("Failed to update SetAudit", { setCode: job.setCode, error: msg });
    }
  }

  /** Rebuild setAudit records from importedProduct data after a BULK import */
  private async rebuildSetAudits(installationId: string): Promise<void> {
    try {
      const setCounts = await this.prisma.importedProduct.groupBy({
        by: ["setCode"],
        where: {
          success: true,
          importJob: { installationId },
        },
        _count: { _all: true },
      });

      if (setCounts.length === 0) return;

      // Fetch all sets from Scryfall in one call
      const scryfallSets = await this.scryfall.listSets();
      const scryfallMap = new Map(scryfallSets.map((s) => [s.code, s]));

      let created = 0;
      let updated = 0;

      for (const group of setCounts) {
        try {
          const scryfall = scryfallMap.get(group.setCode);

          await this.prisma.setAudit.upsert({
            where: {
              installationId_setCode: { installationId, setCode: group.setCode },
            },
            update: {
              importedCards: group._count._all,
              totalCards: scryfall?.card_count ?? group._count._all,
              lastImportedAt: new Date(),
              setName: scryfall?.name ?? group.setCode.toUpperCase(),
              releasedAt: scryfall?.released_at ? new Date(scryfall.released_at) : null,
              setType: scryfall?.set_type ?? null,
              iconSvgUri: scryfall?.icon_svg_uri ?? null,
            },
            create: {
              installationId,
              setCode: group.setCode,
              setName: scryfall?.name ?? group.setCode.toUpperCase(),
              totalCards: scryfall?.card_count ?? group._count._all,
              importedCards: group._count._all,
              lastImportedAt: new Date(),
              releasedAt: scryfall?.released_at ? new Date(scryfall.released_at) : null,
              setType: scryfall?.set_type ?? null,
              iconSvgUri: scryfall?.icon_svg_uri ?? null,
            },
          });

          created++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn("Failed to upsert SetAudit during rebuild", { setCode: group.setCode, error: msg });
        }
      }

      logger.info("Bulk import: SetAudits rebuilt", { created, updated, totalSets: setCounts.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("Failed to rebuild SetAudits after BULK import", { error: msg });
    }
  }
}
