#!/usr/bin/env node
/**
 * Price Sync Worker
 *
 * CLI tool for syncing MTG card prices from external providers (Scryfall, TCGPlayer)
 * to the shared inventory database.
 *
 * Usage:
 *   pnpm sync:full              # Full catalog sync using bulk data
 *   pnpm sync:delta             # Delta sync for active variants
 *   pnpm sync:variant <id>      # Single variant sync
 *
 * Environment:
 *   DATABASE_URL          - PostgreSQL connection string
 *   INSTALLATION_ID       - Saleor app installation UUID
 *   SALEOR_CHANNEL_ID     - Channel for price lookups (default: "default-channel")
 *   SCRYFALL_RATE_LIMIT_MS - Delay between API calls (default: 100)
 *   LOG_LEVEL             - debug|info|warn|error (default: info)
 */

import "dotenv/config";

import { runDeltaSync, runFullSync, runSeedSync, syncVariantPrice } from "./jobs/index.js";
import { logger } from "./lib/logger.js";
import { disconnectPrisma } from "./lib/prisma.js";

type Command = "full" | "delta" | "variant" | "seed" | "help";

function printUsage(): void {
  console.log(`
Price Sync Worker - MTG Card Price Synchronization

Usage:
  price-sync <command> [options]

Commands:
  full              Full catalog sync using Scryfall bulk data
                    Downloads ~80MB of card data and updates all matching variants.
                    Recommended: Run daily at off-peak hours.

  delta             Delta sync for recently active variants
                    Updates prices for variants used in buylists or with stale prices.
                    Recommended: Run every 1-4 hours.

    Options:
      --lookback <days>    How far back to look for active variants (default: 7)
      --limit <count>      Maximum variants to process (default: 500)
      --min-age <hours>    Only sync prices older than this (default: 4)

  seed              Bootstrap initial price snapshots for variants
                    Queries Saleor for variants with Scryfall-ID SKUs (-NM suffix)
                    and creates initial SellPriceSnapshot records.
                    Requires SALEOR_DATABASE_URL environment variable.

    Options:
      --limit <count>      Maximum variants to process (default: all)
      --dry-run            Show what would be done without making changes

  variant <id>      Sync price for a single variant by Saleor variant ID
                    Useful for testing or on-demand refreshes.

  help              Show this help message

Environment Variables:
  DATABASE_URL           PostgreSQL connection string for inventory-ops DB (required)
  INSTALLATION_ID        Saleor app installation UUID (required)
  SALEOR_DATABASE_URL    PostgreSQL connection string for Saleor DB (seed command only)
  SALEOR_CHANNEL_ID      Channel for price lookups (default: "default-channel")
  SCRYFALL_RATE_LIMIT_MS Delay between API calls in ms (default: 100)
  BATCH_SIZE             Batch size for database operations (default: 100)
  LOG_LEVEL              Logging level: debug|info|warn|error (default: info)

Examples:
  # Full sync
  DATABASE_URL="postgresql://..." INSTALLATION_ID="..." pnpm sync:full

  # Delta sync with custom options
  pnpm sync:delta -- --lookback 3 --limit 200

  # Single variant
  pnpm sync:variant UHJvZHVjdFZhcmlhbnQ6MTIz
`);
}

function parseArgs(args: string[]): { command: Command; options: Record<string, string> } {
  const command = (args[0] || "help") as Command;
  const options: Record<string, string> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith("--")) {
        options[key] = value;
        i++;
      } else {
        options[key] = "true";
      }
    } else if (!options.positional) {
      options.positional = arg;
    }
  }

  return { command, options };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { command, options } = parseArgs(args);

  try {
    switch (command) {
      case "full": {
        logger.info("Running full sync");
        const stats = await runFullSync();
        console.log("\nFull Sync Results:");
        console.log(`  Cards in bulk data: ${stats.cardsInBulkData.toLocaleString()}`);
        console.log(`  Variants in database: ${stats.variantsInDatabase.toLocaleString()}`);
        console.log(`  Variants matched: ${stats.variantsMatched.toLocaleString()}`);
        console.log(`  Prices updated: ${stats.pricesUpdated.toLocaleString()}`);
        console.log(`  Duration: ${(stats.durationMs / 1000).toFixed(1)}s`);
        break;
      }

      case "delta": {
        logger.info("Running delta sync");
        const deltaOptions = {
          lookbackDays: options.lookback ? parseInt(options.lookback, 10) : undefined,
          limit: options.limit ? parseInt(options.limit, 10) : undefined,
          minAgeHours: options["min-age"] ? parseInt(options["min-age"], 10) : undefined,
        };
        const stats = await runDeltaSync(deltaOptions);
        console.log("\nDelta Sync Results:");
        console.log(`  Variants processed: ${stats.variantsProcessed.toLocaleString()}`);
        console.log(`  Prices updated: ${stats.pricesUpdated.toLocaleString()}`);
        console.log(`  Skipped (unchanged): ${stats.skipped.toLocaleString()}`);
        console.log(`  Errors: ${stats.errors.toLocaleString()}`);
        console.log(`  Duration: ${(stats.durationMs / 1000).toFixed(1)}s`);
        break;
      }

      case "seed": {
        logger.info("Running seed sync");
        const seedOptions = {
          limit: options.limit ? parseInt(options.limit, 10) : undefined,
          dryRun: options["dry-run"] === "true",
        };
        const stats = await runSeedSync(seedOptions);
        console.log("\nSeed Sync Results:");
        console.log(`  Cards in bulk data: ${stats.cardsInBulkData.toLocaleString()}`);
        console.log(`  Cards with prices: ${stats.cardsWithPrices.toLocaleString()}`);
        console.log(`  Variants queried: ${stats.variantsQueried.toLocaleString()}`);
        console.log(`  Variants matched: ${stats.variantsMatched.toLocaleString()}`);
        console.log(`  Snapshots created: ${stats.snapshotsCreated.toLocaleString()}`);
        console.log(`  Errors: ${stats.errors.toLocaleString()}`);
        console.log(`  Duration: ${(stats.durationMs / 1000).toFixed(1)}s`);
        break;
      }

      case "variant": {
        const variantId = options.positional;
        if (!variantId) {
          console.error("Error: Variant ID required");
          console.error("Usage: price-sync variant <variant-id>");
          process.exit(1);
        }
        logger.info("Syncing single variant", { variantId });
        const result = await syncVariantPrice(variantId);
        if (result.success) {
          console.log(`\nVariant ${variantId}: $${result.price?.toFixed(2)}`);
        } else {
          console.error(`\nFailed: ${result.error}`);
          process.exit(1);
        }
        break;
      }

      case "help":
      default:
        printUsage();
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Command failed", { error: message });
    console.error(`\nError: ${message}`);
    process.exit(1);
  } finally {
    await disconnectPrisma();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
