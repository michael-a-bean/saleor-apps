/**
 * Seed Sync Job
 *
 * Bootstrap initial SellPriceSnapshot records for variants that have
 * Scryfall-based SKUs but no existing price data.
 *
 * This job:
 * 1. Downloads Scryfall bulk data (~80MB)
 * 2. Queries the Saleor database for NM variants (SKU format: {scryfall-id}-NM)
 * 3. Matches variants to Scryfall cards by ID
 * 4. Creates initial price snapshots for matched variants
 *
 * Run this once after the condition variants migration to bootstrap price data.
 *
 * Requires SALEOR_DATABASE_URL environment variable.
 */

import { Decimal } from "decimal.js";
import { PrismaClient } from "@prisma/client";

import { getEnv } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { getPrisma } from "../lib/prisma.js";
import { parseBulkData, ScryfallProvider } from "../providers/scryfall.js";

export interface SeedSyncStats {
  cardsInBulkData: number;
  cardsWithPrices: number;
  variantsQueried: number;
  variantsMatched: number;
  snapshotsCreated: number;
  errors: number;
  durationMs: number;
}

interface ScryfallPriceData {
  usd: number;
  scryfallUri: string;
}

interface VariantRow {
  id: string;
  sku: string;
}

/**
 * Run seed sync to bootstrap initial price snapshots
 */
export async function runSeedSync(options: {
  limit?: number;
  dryRun?: boolean;
} = {}): Promise<SeedSyncStats> {
  const env = getEnv();
  const prisma = getPrisma();
  const provider = new ScryfallProvider();

  const { limit = 0, dryRun = false } = options;

  const startTime = Date.now();
  const stats: SeedSyncStats = {
    cardsInBulkData: 0,
    cardsWithPrices: 0,
    variantsQueried: 0,
    variantsMatched: 0,
    snapshotsCreated: 0,
    errors: 0,
    durationMs: 0,
  };

  logger.info("Starting seed sync", { limit, dryRun });

  try {
    // Check for Saleor database URL
    const saleorDbUrl = process.env.SALEOR_DATABASE_URL;
    if (!saleorDbUrl) {
      throw new Error(
        "SALEOR_DATABASE_URL required for seed sync. " +
        "Set to PostgreSQL URL for Saleor database (e.g., postgresql://saleor:saleor@db:5432/saleor)"
      );
    }

    // Create Saleor DB client
    const saleorDb = new PrismaClient({
      datasources: { db: { url: saleorDbUrl } },
    });

    // Step 1: Download Scryfall bulk data
    const bulkUrl = await provider.getBulkDataUrl();
    if (!bulkUrl) {
      throw new Error("Failed to get Scryfall bulk data URL");
    }

    logger.info("Downloading bulk data", { url: bulkUrl });

    const response = await fetch(bulkUrl);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download bulk data: ${response.status}`);
    }

    // Build price map: scryfall_id -> price data
    const priceMap = new Map<string, ScryfallPriceData>();

    logger.info("Parsing bulk data stream");

    for await (const card of parseBulkData(response.body)) {
      stats.cardsInBulkData++;

      if (!card.prices?.usd) {
        continue;
      }

      stats.cardsWithPrices++;
      priceMap.set(card.id, {
        usd: parseFloat(card.prices.usd),
        scryfallUri: card.scryfall_uri,
      });

      if (stats.cardsInBulkData % 25000 === 0) {
        logger.debug("Bulk data progress", {
          parsed: stats.cardsInBulkData,
          withPrices: stats.cardsWithPrices,
        });
      }
    }

    logger.info("Bulk data parsed", {
      totalCards: stats.cardsInBulkData,
      cardsWithPrices: stats.cardsWithPrices,
    });

    // Step 2: Query NM variants from Saleor database
    // These have SKU format: {scryfall-id}-NM
    const limitClause = limit > 0 ? `LIMIT ${limit}` : "";

    const variants = await saleorDb.$queryRawUnsafe<VariantRow[]>(`
      SELECT
        pv.id::text as id,
        pv.sku
      FROM product_productvariant pv
      WHERE pv.sku LIKE '%-NM'
      ${limitClause}
    `);

    stats.variantsQueried = variants.length;
    logger.info("Queried NM variants from Saleor", { count: variants.length });

    // Step 3: Check existing snapshots to avoid duplicates
    const existingVariantIds = new Set(
      (
        await prisma.sellPriceSnapshot.findMany({
          where: {
            installationId: env.INSTALLATION_ID,
          },
          select: { saleorVariantId: true },
          distinct: ["saleorVariantId"],
        })
      ).map((s) => s.saleorVariantId)
    );

    logger.info("Found existing snapshots", { count: existingVariantIds.size });

    // Step 4: Match and create snapshots
    const batchSize = env.BATCH_SIZE;
    const snapshots: Array<{
      saleorVariantId: string;
      currentPrice: Decimal;
      sourceUrl: string;
    }> = [];

    for (const variant of variants) {
      if (!variant.sku) continue;

      // Skip if already has snapshot
      if (existingVariantIds.has(variant.id)) {
        continue;
      }

      // Extract Scryfall ID from SKU (format: {scryfall-id}-NM)
      const scryfallId = variant.sku.replace(/-NM$/, "");
      const priceData = priceMap.get(scryfallId);

      if (!priceData) {
        stats.errors++;
        continue;
      }

      stats.variantsMatched++;

      snapshots.push({
        saleorVariantId: variant.id,
        currentPrice: new Decimal(priceData.usd),
        sourceUrl: priceData.scryfallUri,
      });

      // Batch insert
      if (snapshots.length >= batchSize && !dryRun) {
        await insertSnapshots(prisma, env.INSTALLATION_ID, env.SALEOR_CHANNEL_ID, snapshots);
        stats.snapshotsCreated += snapshots.length;
        logger.info("Batch inserted", { count: snapshots.length, total: stats.snapshotsCreated });
        snapshots.length = 0;
      }
    }

    // Insert remaining snapshots
    if (snapshots.length > 0 && !dryRun) {
      await insertSnapshots(prisma, env.INSTALLATION_ID, env.SALEOR_CHANNEL_ID, snapshots);
      stats.snapshotsCreated += snapshots.length;
    }

    if (dryRun) {
      stats.snapshotsCreated = snapshots.length + stats.snapshotsCreated;
      logger.info("Dry run - would create snapshots", { count: stats.snapshotsCreated });
    }

    // Cleanup
    await saleorDb.$disconnect();

    stats.durationMs = Date.now() - startTime;

    logger.info("Seed sync completed", stats);

    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Seed sync failed", { error: message });
    throw error;
  }
}

/**
 * Batch insert price snapshots
 */
async function insertSnapshots(
  prisma: ReturnType<typeof getPrisma>,
  installationId: string,
  channelId: string,
  snapshots: Array<{
    saleorVariantId: string;
    currentPrice: Decimal;
    sourceUrl: string;
  }>
): Promise<void> {
  await prisma.sellPriceSnapshot.createMany({
    data: snapshots.map((s) => ({
      installationId,
      saleorVariantId: s.saleorVariantId,
      saleorChannelId: channelId,
      currentPrice: s.currentPrice,
      currency: "USD",
      source: "scryfall",
      sourceUrl: s.sourceUrl,
    })),
  });
}
