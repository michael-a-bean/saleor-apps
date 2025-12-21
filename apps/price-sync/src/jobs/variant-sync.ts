/**
 * Single Variant Sync Job
 *
 * Fetches price for a specific variant by its Saleor variant ID.
 * Useful for testing or on-demand price refreshes.
 */

import { Decimal } from "decimal.js";

import { getEnv } from "../lib/env.js";
import { logger } from "../lib/logger.js";
import { getPrisma } from "../lib/prisma.js";
import { ScryfallProvider } from "../providers/scryfall.js";

interface VariantSyncResult {
  variantId: string;
  success: boolean;
  price?: number;
  error?: string;
}

/**
 * Sync price for a single variant
 */
export async function syncVariantPrice(saleorVariantId: string): Promise<VariantSyncResult> {
  const env = getEnv();
  const prisma = getPrisma();
  const provider = new ScryfallProvider();

  logger.info("Starting single variant sync", { variantId: saleorVariantId });

  try {
    // Look up variant in database to get MTG attributes
    // We need to find the set code and collector number from previous snapshots
    // or from Saleor product attributes

    // For now, we'll try to find existing snapshot to get the identifier
    const existingSnapshot = await prisma.sellPriceSnapshot.findFirst({
      where: {
        installationId: env.INSTALLATION_ID,
        saleorVariantId,
      },
      orderBy: { snapshotAt: "desc" },
    });

    if (!existingSnapshot?.sourceUrl) {
      // Try to parse set-collector from SKU pattern
      // This assumes SKUs follow a pattern like "NEO-123" or similar
      logger.warn("No existing snapshot found, cannot determine card identifier", {
        variantId: saleorVariantId,
      });

      return {
        variantId: saleorVariantId,
        success: false,
        error: "Cannot determine card identifier - no existing price data",
      };
    }

    // Extract set/number from Scryfall URL if available
    // URL format: https://scryfall.com/card/neo/123/...
    const urlMatch = existingSnapshot.sourceUrl.match(/scryfall\.com\/card\/([^/]+)\/([^/]+)/);
    if (!urlMatch) {
      return {
        variantId: saleorVariantId,
        success: false,
        error: "Cannot parse card identifier from existing data",
      };
    }

    const [, set, number] = urlMatch;
    const setCollectorNumber = `${set.toUpperCase()}-${number}`;

    // Fetch current price from Scryfall
    const result = await provider.fetchPrice({ setCollectorNumber });

    if (!result.found || result.prices.usd === null) {
      return {
        variantId: saleorVariantId,
        success: false,
        error: result.error || "Price not available",
      };
    }

    // Create new price snapshot
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

    logger.info("Successfully synced variant price", {
      variantId: saleorVariantId,
      price: result.prices.usd,
    });

    return {
      variantId: saleorVariantId,
      success: true,
      price: result.prices.usd,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to sync variant price", { variantId: saleorVariantId, error: message });

    return {
      variantId: saleorVariantId,
      success: false,
      error: message,
    };
  }
}
