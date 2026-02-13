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

import type { PrismaClient, ImportJob } from "@prisma/client";
import type { Client } from "urql";

import { createLogger } from "@/lib/logger";
import type { ScryfallCard } from "../scryfall/types";
import { ScryfallClient, BulkDataManager, retailPaperFilter } from "../scryfall";
import { SaleorImportClient } from "../saleor";
import { buildAttributeIdMap } from "./attribute-map";
import { cardToProductInput, batchCards, type PipelineOptions } from "./pipeline";

const logger = createLogger("JobProcessor");

const DEFAULT_BATCH_SIZE = 50;
const CHECKPOINT_INTERVAL = 100;

export interface ProcessorConfig {
  scryfallClient: ScryfallClient;
  bulkDataManager: BulkDataManager;
  prisma: PrismaClient;
  gqlClient: Client;
  batchSize?: number;
}

export interface ProcessResult {
  cardsProcessed: number;
  variantsCreated: number;
  errors: number;
  errorLog: string[];
}

export class JobProcessor {
  private readonly scryfall: ScryfallClient;
  private readonly bulkData: BulkDataManager;
  private readonly prisma: PrismaClient;
  private readonly saleor: SaleorImportClient;
  private readonly batchSize: number;
  private abortController: AbortController | null = null;

  constructor(config: ProcessorConfig) {
    this.scryfall = config.scryfallClient;
    this.bulkData = config.bulkDataManager;
    this.prisma = config.prisma;
    this.saleor = new SaleorImportClient(config.gqlClient);
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  /** Process a single import job */
  async processJob(job: ImportJob): Promise<ProcessResult> {
    this.abortController = new AbortController();
    const result: ProcessResult = {
      cardsProcessed: 0,
      variantsCreated: 0,
      errors: 0,
      errorLog: [],
    };

    try {
      // Mark job as running
      await this.prisma.importJob.update({
        where: { id: job.id },
        data: { status: "RUNNING", startedAt: new Date() },
      });

      // Resolve Saleor context
      const importContext = await this.saleor.resolveImportContext();
      const attributeIdMap = buildAttributeIdMap(importContext.productType.productAttributes);

      logger.info("Starting import job", {
        jobId: job.id,
        type: job.type,
        setCode: job.setCode,
        checkpoint: job.lastCheckpoint,
      });

      // Get card stream based on job type
      const cardStream = this.getCardStream(job);

      // Process cards in batches
      let batch: ScryfallCard[] = [];
      let totalCards = 0;
      const checkpoint = job.lastCheckpoint ? parseInt(job.lastCheckpoint, 10) : 0;
      let skipped = 0;

      for await (const card of cardStream) {
        if (this.abortController.signal.aborted) {
          logger.info("Job aborted", { jobId: job.id });
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

        batch.push(card);

        if (batch.length >= this.batchSize) {
          const batchResult = await this.processBatch(
            batch,
            job,
            importContext,
            attributeIdMap,
            result
          );
          batch = [];

          // Checkpoint every N cards
          if (result.cardsProcessed % CHECKPOINT_INTERVAL < this.batchSize) {
            await this.saveCheckpoint(job.id, totalCards, result);
          }
        }
      }

      // Process remaining cards
      if (batch.length > 0) {
        await this.processBatch(batch, job, importContext, attributeIdMap, result);
      }

      // Mark job complete
      await this.prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: result.errors > 0 && result.cardsProcessed === 0 ? "FAILED" : "COMPLETED",
          completedAt: new Date(),
          cardsProcessed: result.cardsProcessed,
          cardsTotal: totalCards,
          variantsCreated: result.variantsCreated,
          errors: result.errors,
          errorLog: JSON.stringify(result.errorLog.slice(0, 100)),
        },
      });

      logger.info("Import job complete", {
        jobId: job.id,
        ...result,
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

  private getCardStream(job: ImportJob): AsyncIterable<ScryfallCard> {
    if (job.type === "SET" && job.setCode) {
      // On-demand set import: stream only cards from this set
      return this.bulkData.streamSet(job.setCode);
    }
    // Bulk import: stream all cards
    return this.bulkData.streamCards();
  }

  private async processBatch(
    cards: ScryfallCard[],
    job: ImportJob,
    importContext: Awaited<ReturnType<SaleorImportClient["resolveImportContext"]>>,
    attributeIdMap: Map<string, string>,
    result: ProcessResult
  ): Promise<void> {
    try {
      const pipelineOptions: PipelineOptions = { batchSize: this.batchSize };

      // Convert cards to product inputs
      const productInputs = cards.map((card) =>
        cardToProductInput(card, importContext, attributeIdMap, pipelineOptions)
      );

      // Execute bulk create
      const createResult = await this.saleor.bulkCreateProducts(productInputs);

      // Track results
      for (let i = 0; i < createResult.results.length; i++) {
        const row = createResult.results[i];
        const card = cards[i];

        if (row.product) {
          result.cardsProcessed++;
          result.variantsCreated += row.product.variants.length;

          // Record imported product
          await this.prisma.importedProduct.create({
            data: {
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
          });
        } else {
          result.errors++;
          const errorMsg = row.errors.map((e) => e.message).join("; ");
          result.errorLog.push(`${card.name} [${card.set}#${card.collector_number}]: ${errorMsg}`);

          await this.prisma.importedProduct.create({
            data: {
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
          });
        }
      }

      logger.debug("Batch processed", {
        jobId: job.id,
        batchSize: cards.length,
        processed: result.cardsProcessed,
        errors: result.errors,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors += cards.length;
      result.errorLog.push(`Batch error (${cards.length} cards): ${message}`);
      logger.error("Batch processing failed", { jobId: job.id, error: message });
    }
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
    logger.debug("Checkpoint saved", { jobId, totalProcessed });
  }
}
