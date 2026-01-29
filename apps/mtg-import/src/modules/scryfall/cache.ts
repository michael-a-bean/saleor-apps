import * as fs from "fs/promises";
import * as path from "path";

import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";

import { downloadBulkData, filterEnglishPaperCards, getDefaultCardsBulkInfo } from "./client";
import { ScryfallCard } from "./types";

const logger = createLogger("scryfall-cache");

const CACHE_DIR = env.SCRYFALL_CACHE_DIR;
const CACHE_MAX_AGE_MS = env.SCRYFALL_CACHE_MAX_AGE_HOURS * 60 * 60 * 1000;

const BULK_DATA_CACHE_FILE = "default-cards.json";
const METADATA_CACHE_FILE = "metadata.json";

interface CacheMetadata {
  downloadedAt: string;
  scryfallUpdatedAt: string;
  cardCount: number;
  fileSize: number;
}

/**
 * Ensure cache directory exists
 */
async function ensureCacheDir(): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (error) {
    logger.error("Failed to create cache directory", { error, cacheDir: CACHE_DIR });
    throw error;
  }
}

/**
 * Check if cache is valid (exists and not expired)
 */
async function isCacheValid(): Promise<boolean> {
  try {
    const metadataPath = path.join(CACHE_DIR, METADATA_CACHE_FILE);
    const dataPath = path.join(CACHE_DIR, BULK_DATA_CACHE_FILE);

    // Check if both files exist
    await Promise.all([
      fs.access(metadataPath),
      fs.access(dataPath),
    ]);

    // Read and check metadata
    const metadataRaw = await fs.readFile(metadataPath, "utf-8");
    const metadata: CacheMetadata = JSON.parse(metadataRaw);

    const cacheAge = Date.now() - new Date(metadata.downloadedAt).getTime();

    if (cacheAge > CACHE_MAX_AGE_MS) {
      logger.info("Cache expired", {
        cacheAgeHours: (cacheAge / 1000 / 60 / 60).toFixed(2),
        maxAgeHours: env.SCRYFALL_CACHE_MAX_AGE_HOURS,
      });
      return false;
    }

    logger.info("Cache is valid", {
      cacheAgeHours: (cacheAge / 1000 / 60 / 60).toFixed(2),
      cardCount: metadata.cardCount,
    });

    return true;
  } catch {
    logger.debug("Cache not found or invalid");
    return false;
  }
}

/**
 * Load cards from cache
 */
async function loadFromCache(): Promise<ScryfallCard[]> {
  const dataPath = path.join(CACHE_DIR, BULK_DATA_CACHE_FILE);

  logger.info("Loading cards from cache", { path: dataPath });

  const dataRaw = await fs.readFile(dataPath, "utf-8");
  const cards: ScryfallCard[] = JSON.parse(dataRaw);

  logger.info("Loaded cards from cache", { count: cards.length });

  return cards;
}

/**
 * Save cards to cache
 */
async function saveToCache(cards: ScryfallCard[], scryfallUpdatedAt: string): Promise<void> {
  await ensureCacheDir();

  const dataPath = path.join(CACHE_DIR, BULK_DATA_CACHE_FILE);
  const metadataPath = path.join(CACHE_DIR, METADATA_CACHE_FILE);

  const dataJson = JSON.stringify(cards);

  const metadata: CacheMetadata = {
    downloadedAt: new Date().toISOString(),
    scryfallUpdatedAt,
    cardCount: cards.length,
    fileSize: dataJson.length,
  };

  logger.info("Saving cards to cache", {
    path: dataPath,
    cardCount: cards.length,
    sizeBytes: dataJson.length,
  });

  await Promise.all([
    fs.writeFile(dataPath, dataJson, "utf-8"),
    fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8"),
  ]);

  logger.info("Cache saved successfully");
}

/**
 * Get all English paper cards, using cache if available
 */
export async function getEnglishPaperCards(forceRefresh = false): Promise<ScryfallCard[]> {
  // Check cache first (unless forcing refresh)
  if (!forceRefresh && await isCacheValid()) {
    return loadFromCache();
  }

  // Download fresh data
  logger.info("Downloading fresh bulk data from Scryfall");

  const bulkInfo = await getDefaultCardsBulkInfo();
  const allCards = await downloadBulkData(bulkInfo.download_uri);

  // Filter to English paper cards
  const englishPaperCards = filterEnglishPaperCards(allCards);

  // Save to cache
  await saveToCache(englishPaperCards, bulkInfo.updated_at);

  return englishPaperCards;
}

/**
 * Get cache metadata (for UI display)
 */
export async function getCacheMetadata(): Promise<CacheMetadata | null> {
  try {
    const metadataPath = path.join(CACHE_DIR, METADATA_CACHE_FILE);
    const metadataRaw = await fs.readFile(metadataPath, "utf-8");
    return JSON.parse(metadataRaw);
  } catch {
    return null;
  }
}

/**
 * Clear the cache
 */
export async function clearCache(): Promise<void> {
  const dataPath = path.join(CACHE_DIR, BULK_DATA_CACHE_FILE);
  const metadataPath = path.join(CACHE_DIR, METADATA_CACHE_FILE);

  try {
    await Promise.all([
      fs.unlink(dataPath).catch(() => {}),
      fs.unlink(metadataPath).catch(() => {}),
    ]);
    logger.info("Cache cleared");
  } catch (error) {
    logger.error("Failed to clear cache", { error });
  }
}
