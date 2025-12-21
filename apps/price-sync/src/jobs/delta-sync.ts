/**
 * Delta Sync Job
 *
 * Updates prices for variants that have been recently active (referenced in buylists,
 * cost layer events, or had price snapshots within a configurable window).
 *
 * This is intended to run frequently (e.g., every hour) to keep active inventory
 * prices up to date without hitting rate limits for the entire catalog.
 */

import { Decimal } from "decimal.js";

import { getEnv } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { getPrisma } from "../lib/prisma.js";
import { ScryfallProvider } from "../providers/scryfall.js";

interface DeltaSyncStats {
  variantsProcessed: number;
  pricesUpdated: number;
  errors: number;
  skipped: number;
  durationMs: number;
}

interface DeltaSyncOptions {
  /** How far back to look for active variants (default: 7 days) */
  lookbackDays?: number;
  /** Maximum variants to process (default: 500) */
  limit?: number;
  /** Only sync variants older than this many hours (default: 4) */
  minAgeHours?: number;
}

/**
 * Run delta sync for recently active variants
 */
export async function runDeltaSync(options: DeltaSyncOptions = {}): Promise<DeltaSyncStats> {
  const { lookbackDays = 7, limit = 500, minAgeHours = 4 } = options;

  const env = getEnv();
  const prisma = getPrisma();
  const provider = new ScryfallProvider();

  const startTime = Date.now();
  const stats: DeltaSyncStats = {
    variantsProcessed: 0,
    pricesUpdated: 0,
    errors: 0,
    skipped: 0,
    durationMs: 0,
  };

  logger.info("Starting delta sync", { lookbackDays, limit, minAgeHours });

  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);

  const minAgeDate = new Date();
  minAgeDate.setHours(minAgeDate.getHours() - minAgeHours);

  try {
    // Find active variants from multiple sources:
    // 1. Recent buylist lines
    // 2. Recent cost layer events
    // 3. Existing price snapshots that are stale

    // Using raw query for efficient UNION of sources
    const activeVariants = await prisma.$queryRaw<Array<{ saleorVariantId: string }>>`
      WITH active_variants AS (
        -- Variants from recent buylist lines
        SELECT DISTINCT bl."saleorVariantId"
        FROM "BuylistLine" bl
        JOIN "Buylist" b ON bl."buylistId" = b.id
        WHERE b."installationId" = ${env.INSTALLATION_ID}
          AND b."createdAt" > ${lookbackDate}

        UNION

        -- Variants from recent cost layer events
        SELECT DISTINCT "saleorVariantId"
        FROM "CostLayerEvent"
        WHERE "installationId" = ${env.INSTALLATION_ID}
          AND "eventTimestamp" > ${lookbackDate}

        UNION

        -- Variants with stale price snapshots
        SELECT DISTINCT "saleorVariantId"
        FROM "SellPriceSnapshot"
        WHERE "installationId" = ${env.INSTALLATION_ID}
          AND "snapshotAt" < ${minAgeDate}
      )
      SELECT av."saleorVariantId"
      FROM active_variants av
      LEFT JOIN (
        SELECT "saleorVariantId", MAX("snapshotAt") as last_snapshot
        FROM "SellPriceSnapshot"
        WHERE "installationId" = ${env.INSTALLATION_ID}
        GROUP BY "saleorVariantId"
      ) latest ON av."saleorVariantId" = latest."saleorVariantId"
      WHERE latest.last_snapshot IS NULL
         OR latest.last_snapshot < ${minAgeDate}
      LIMIT ${limit}
    `;

    logger.info("Found active variants to sync", { count: activeVariants.length });

    if (activeVariants.length === 0) {
      logger.info("No variants need price updates");
      stats.durationMs = Date.now() - startTime;
      return stats;
    }

    // Get latest snapshots for these variants to determine identifiers
    const variantIds = activeVariants.map((v) => v.saleorVariantId);

    const latestSnapshots = await prisma.sellPriceSnapshot.findMany({
      where: {
        installationId: env.INSTALLATION_ID,
        saleorVariantId: { in: variantIds },
      },
      orderBy: { snapshotAt: "desc" },
      distinct: ["saleorVariantId"],
    });

    // Create lookup map
    const snapshotMap = new Map(latestSnapshots.map((s) => [s.saleorVariantId, s]));

    // Process each variant
    for (const { saleorVariantId } of activeVariants) {
      stats.variantsProcessed++;

      const snapshot = snapshotMap.get(saleorVariantId);

      // Try to extract identifier from source URL
      let setCollectorNumber: string | undefined;
      if (snapshot?.sourceUrl) {
        const match = snapshot.sourceUrl.match(/scryfall\.com\/card\/([^/]+)\/([^/]+)/);
        if (match) {
          setCollectorNumber = `${match[1].toUpperCase()}-${match[2]}`;
        }
      }

      if (!setCollectorNumber) {
        logger.debug("Skipping variant - no identifier", { variantId: saleorVariantId });
        stats.skipped++;
        continue;
      }

      // Fetch price
      const result = await provider.fetchPrice({ setCollectorNumber });

      if (!result.found || result.prices.usd === null) {
        logger.debug("No price found", { variantId: saleorVariantId, error: result.error });
        stats.errors++;
        continue;
      }

      // Check if price actually changed
      const currentPrice = snapshot?.currentPrice?.toNumber();
      if (currentPrice !== undefined && Math.abs(currentPrice - result.prices.usd) < 0.01) {
        // Price unchanged, still create snapshot to update timestamp
        await prisma.sellPriceSnapshot.create({
          data: {
            installationId: env.INSTALLATION_ID,
            saleorVariantId,
            saleorChannelId: env.SALEOR_CHANNEL_ID,
            currentPrice: new Decimal(result.prices.usd),
            currency: "USD",
            source: "scryfall",
            sourceUrl: result.sourceUrl,
          },
        });
        stats.skipped++;
        continue;
      }

      // Create new snapshot
      await prisma.sellPriceSnapshot.create({
        data: {
          installationId: env.INSTALLATION_ID,
          saleorVariantId,
          saleorChannelId: env.SALEOR_CHANNEL_ID,
          currentPrice: new Decimal(result.prices.usd),
          currency: "USD",
          source: "scryfall",
          sourceUrl: result.sourceUrl,
        },
      });

      stats.pricesUpdated++;

      if (stats.variantsProcessed % 50 === 0) {
        logger.info("Delta sync progress", {
          processed: stats.variantsProcessed,
          updated: stats.pricesUpdated,
        });
      }
    }

    stats.durationMs = Date.now() - startTime;

    logger.info("Delta sync completed", stats);

    return stats;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Delta sync failed", { error: message });
    throw error;
  }
}
