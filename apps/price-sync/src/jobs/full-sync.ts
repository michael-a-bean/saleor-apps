/**
 * Full Sync Job
 *
 * Downloads Scryfall bulk data and updates prices for all matching variants.
 * This should run daily (e.g., 2am) to keep the full catalog in sync.
 *
 * Process:
 * 1. Download Scryfall bulk data (~80MB JSON)
 * 2. Build a lookup map of set+collector -> price
 * 3. Query all variants that have MTG attributes
 * 4. Update prices for matching variants
 */

import { Decimal } from "decimal.js";

import { getEnv } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { getPrisma } from "../lib/prisma.js";
import { parseBulkData, ScryfallProvider } from "../providers/scryfall.js";

interface FullSyncStats {
  cardsInBulkData: number;
  variantsInDatabase: number;
  variantsMatched: number;
  pricesUpdated: number;
  errors: number;
  durationMs: number;
}

interface CardPriceData {
  usd: number | null;
  scryfallUri: string;
}

/**
 * Run full catalog sync using Scryfall bulk data
 */
export async function runFullSync(): Promise<FullSyncStats> {
  const env = getEnv();
  const prisma = getPrisma();
  const provider = new ScryfallProvider();

  const startTime = Date.now();
  const stats: FullSyncStats = {
    cardsInBulkData: 0,
    variantsInDatabase: 0,
    variantsMatched: 0,
    pricesUpdated: 0,
    errors: 0,
    durationMs: 0,
  };

  logger.info("Starting full sync");

  try {
    // Step 1: Get bulk data URL
    const bulkUrl = await provider.getBulkDataUrl();
    if (!bulkUrl) {
      throw new Error("Failed to get Scryfall bulk data URL");
    }

    logger.info("Downloading bulk data", { url: bulkUrl });

    // Step 2: Download and parse bulk data into memory map
    // Key: "SET-COLLECTOR_NUMBER" (uppercase), Value: price data
    const priceMap = new Map<string, CardPriceData>();

    const response = await fetch(bulkUrl);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download bulk data: ${response.status}`);
    }

    logger.info("Parsing bulk data stream");

    for await (const card of parseBulkData(response.body)) {
      stats.cardsInBulkData++;

      // Skip cards without prices
      if (!card.prices?.usd) {
        continue;
      }

      const key = `${card.set.toUpperCase()}-${card.collector_number}`;
      priceMap.set(key, {
        usd: parseFloat(card.prices.usd),
        scryfallUri: card.scryfall_uri,
      });

      if (stats.cardsInBulkData % 10000 === 0) {
        logger.debug("Bulk data progress", {
          parsed: stats.cardsInBulkData,
          withPrices: priceMap.size,
        });
      }
    }

    logger.info("Bulk data parsed", {
      totalCards: stats.cardsInBulkData,
      cardsWithPrices: priceMap.size,
    });

    // Step 3: Get all variants that have price snapshots (these are our MTG products)
    // Group by set-collector to match against Scryfall data
    const existingSnapshots = await prisma.sellPriceSnapshot.findMany({
      where: {
        installationId: env.INSTALLATION_ID,
        source: "scryfall",
      },
      select: {
        saleorVariantId: true,
        sourceUrl: true,
        currentPrice: true,
      },
      distinct: ["saleorVariantId"],
    });

    stats.variantsInDatabase = existingSnapshots.length;
    logger.info("Found variants to update", { count: existingSnapshots.length });

    // Step 4: Match variants to Scryfall data and update prices
    const batchSize = env.BATCH_SIZE;
    const updates: Array<{
      saleorVariantId: string;
      currentPrice: Decimal;
      sourceUrl: string;
    }> = [];

    for (const snapshot of existingSnapshots) {
      if (!snapshot.sourceUrl) {
        continue;
      }

      // Extract set/number from Scryfall URL
      const match = snapshot.sourceUrl.match(/scryfall\.com\/card\/([^/]+)\/([^/]+)/);
      if (!match) {
        continue;
      }

      const key = `${match[1].toUpperCase()}-${match[2]}`;
      const priceData = priceMap.get(key);

      if (!priceData || priceData.usd === null) {
        continue;
      }

      stats.variantsMatched++;

      // Check if price changed
      const currentPrice = snapshot.currentPrice?.toNumber();
      if (currentPrice !== undefined && Math.abs(currentPrice - priceData.usd) < 0.01) {
        continue; // Price unchanged
      }

      updates.push({
        saleorVariantId: snapshot.saleorVariantId,
        currentPrice: new Decimal(priceData.usd),
        sourceUrl: priceData.scryfallUri,
      });

      // Batch insert
      if (updates.length >= batchSize) {
        await insertPriceSnapshots(prisma, env.INSTALLATION_ID, env.SALEOR_CHANNEL_ID, updates);
        stats.pricesUpdated += updates.length;
        logger.info("Batch inserted", { count: updates.length, total: stats.pricesUpdated });
        updates.length = 0;
      }
    }

    // Insert remaining updates
    if (updates.length > 0) {
      await insertPriceSnapshots(prisma, env.INSTALLATION_ID, env.SALEOR_CHANNEL_ID, updates);
      stats.pricesUpdated += updates.length;
    }

    stats.durationMs = Date.now() - startTime;

    logger.info("Full sync completed", stats);

    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Full sync failed", { error: message });
    throw error;
  }
}

/**
 * Batch insert price snapshots
 */
async function insertPriceSnapshots(
  prisma: ReturnType<typeof getPrisma>,
  installationId: string,
  channelId: string,
  updates: Array<{
    saleorVariantId: string;
    currentPrice: Decimal;
    sourceUrl: string;
  }>
): Promise<void> {
  await prisma.sellPriceSnapshot.createMany({
    data: updates.map((u) => ({
      installationId,
      saleorVariantId: u.saleorVariantId,
      saleorChannelId: channelId,
      currentPrice: u.currentPrice,
      currency: "USD",
      source: "scryfall",
      sourceUrl: u.sourceUrl,
    })),
  });
}

/**
 * Seed initial price data for variants
 *
 * This is used to bootstrap price sync for variants that don't have any
 * existing snapshots. It reads variant SKUs from Saleor and matches them
 * against Scryfall.
 *
 * SKU format expected: "SET-COLLECTOR" (e.g., "NEO-123", "2ED-233")
 */
export async function seedPricesFromSkus(skuPattern = "%-%"): Promise<void> {
  const env = getEnv();
  const prisma = getPrisma();
  const provider = new ScryfallProvider();

  logger.info("Seeding prices from SKUs", { pattern: skuPattern });

  // This would need to query Saleor for variants with matching SKUs
  // For now, log that this is a TODO
  logger.warn(
    "SKU seeding requires Saleor GraphQL integration - not implemented in standalone worker"
  );
  logger.info(
    "To seed initial data, use the buylist app's searchCards function which creates snapshots"
  );
}
