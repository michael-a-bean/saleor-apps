/**
 * Scryfall bulk data download, streaming JSON parse, and local cache.
 *
 * The default_cards bulk file is ~500MB of JSON. This module:
 * 1. Checks if a cached copy exists and is fresh (< 24h)
 * 2. Downloads the file if stale or missing (no rate limit on data.scryfall.io)
 * 3. Streams the JSON array, yielding one card at a time (never loads full file into memory)
 */

import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile, stat, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { parser } from "stream-json";
import { streamArray } from "stream-json/streamers/StreamArray";

import { createLogger } from "@/lib/logger";
import { ScryfallApiError } from "@/lib/errors";
import type { ScryfallCard, ScryfallBulkDataItem } from "./types";
import { ScryfallClient } from "./client";

const logger = createLogger("ScryfallBulkData");

const DEFAULT_CACHE_DIR = "data/bulk";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const METADATA_FILE = "bulk-metadata.json";

interface BulkCacheMetadata {
  updatedAt: string;
  downloadedAt: string;
  filePath: string;
  sizeBytes: number;
  type: string;
}

export interface BulkDataOptions {
  /** Directory for cached bulk files (default: data/bulk) */
  cacheDir?: string;
  /** Cache TTL in milliseconds (default: 24 hours) */
  cacheTtlMs?: number;
  /** Scryfall client instance for API calls */
  client: ScryfallClient;
  /** Filter function applied to each card during streaming (return false to skip) */
  filter?: (card: ScryfallCard) => boolean;
}

export class BulkDataManager {
  private readonly cacheDir: string;
  private readonly cacheTtlMs: number;
  private readonly client: ScryfallClient;
  private readonly defaultFilter: (card: ScryfallCard) => boolean;

  constructor(options: BulkDataOptions) {
    this.cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
    this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
    this.client = options.client;
    this.defaultFilter = options.filter ?? (() => true);
  }

  /**
   * Stream all cards from the bulk data file, downloading if necessary.
   * Yields one ScryfallCard at a time — safe for 500MB+ files.
   */
  async *streamCards(filter?: (card: ScryfallCard) => boolean): AsyncGenerator<ScryfallCard> {
    const cardFilter = filter ?? this.defaultFilter;
    const filePath = await this.ensureFreshBulkFile();

    logger.info("Streaming cards from bulk file", { filePath });

    let count = 0;
    const fileStream = createReadStream(filePath, { encoding: "utf-8" });
    const jsonParser = parser();
    const arrayStreamer = streamArray();

    const pipelineStream = fileStream.pipe(jsonParser).pipe(arrayStreamer);

    try {
      for await (const { value } of pipelineStream) {
        const card = value as ScryfallCard;
        if (cardFilter(card)) {
          count++;
          yield card;
        }
      }
    } finally {
      // Clean up streams
      fileStream.destroy();
      logger.info("Streaming complete", { cardsYielded: count });
    }
  }

  /**
   * Stream cards from a specific set only.
   */
  async *streamSet(setCode: string): AsyncGenerator<ScryfallCard> {
    const lowerSetCode = setCode.toLowerCase();
    yield* this.streamCards((card) => card.set === lowerSetCode);
  }

  /**
   * Ensure a fresh bulk data file exists locally. Downloads if stale or missing.
   * Returns the path to the cached file.
   */
  async ensureFreshBulkFile(): Promise<string> {
    await mkdir(this.cacheDir, { recursive: true });

    const metadata = await this.loadMetadata();

    // Check if cached file exists and is fresh
    if (metadata) {
      const cachedExists = existsSync(metadata.filePath);
      const age = Date.now() - new Date(metadata.downloadedAt).getTime();

      if (cachedExists && age < this.cacheTtlMs) {
        logger.info("Using cached bulk file", {
          filePath: metadata.filePath,
          ageHours: Math.round(age / 3600000 * 10) / 10,
        });
        return metadata.filePath;
      }

      // Check if Scryfall has newer data
      if (cachedExists) {
        const remote = await this.client.getDefaultCardsBulkData();
        if (remote.updated_at === metadata.updatedAt) {
          // Remote hasn't changed — update our downloadedAt to extend cache
          await this.saveMetadata({ ...metadata, downloadedAt: new Date().toISOString() });
          logger.info("Bulk data unchanged on Scryfall, extending cache TTL");
          return metadata.filePath;
        }
      }
    }

    // Download fresh
    return this.downloadBulkFile();
  }

  /**
   * Force a fresh download regardless of cache state.
   */
  async downloadBulkFile(): Promise<string> {
    const bulkData = await this.client.getDefaultCardsBulkData();
    return this.downloadFromEntry(bulkData);
  }

  /**
   * Get cache metadata without downloading.
   */
  async getCacheStatus(): Promise<{ cached: boolean; ageHours: number | null; updatedAt: string | null; sizeBytes: number | null }> {
    const metadata = await this.loadMetadata();
    if (!metadata || !existsSync(metadata.filePath)) {
      return { cached: false, ageHours: null, updatedAt: null, sizeBytes: null };
    }

    const age = Date.now() - new Date(metadata.downloadedAt).getTime();
    return {
      cached: true,
      ageHours: Math.round(age / 3600000 * 10) / 10,
      updatedAt: metadata.updatedAt,
      sizeBytes: metadata.sizeBytes,
    };
  }

  /**
   * Delete cached bulk file and metadata.
   */
  async clearCache(): Promise<void> {
    const metadata = await this.loadMetadata();
    if (metadata && existsSync(metadata.filePath)) {
      await unlink(metadata.filePath);
    }
    const metaPath = path.join(this.cacheDir, METADATA_FILE);
    if (existsSync(metaPath)) {
      await unlink(metaPath);
    }
    logger.info("Bulk data cache cleared");
  }

  // --- Private ---

  private async downloadFromEntry(bulkData: ScryfallBulkDataItem): Promise<string> {
    const fileName = `default-cards-${Date.now()}.json`;
    const filePath = path.join(this.cacheDir, fileName);

    logger.info("Downloading bulk data", {
      downloadUri: bulkData.download_uri,
      expectedSize: bulkData.size,
      destination: filePath,
    });

    // Download the file (data.scryfall.io has no rate limit)
    const response = await fetch(bulkData.download_uri);
    if (!response.ok || !response.body) {
      throw new ScryfallApiError(
        `Failed to download bulk data: HTTP ${response.status}`,
        { props: { url: bulkData.download_uri, status: response.status } }
      );
    }

    // Clean up old cached files before writing new one
    await this.cleanOldFiles(filePath);

    // Stream response body to disk
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeStream = Readable.fromWeb(response.body as any);
    const fileWriter = createWriteStream(filePath);
    await pipeline(nodeStream, fileWriter);

    // Verify file was written
    const fileInfo = await stat(filePath);
    logger.info("Bulk data download complete", {
      filePath,
      sizeBytes: fileInfo.size,
    });

    // Save metadata
    const metadata: BulkCacheMetadata = {
      updatedAt: bulkData.updated_at,
      downloadedAt: new Date().toISOString(),
      filePath,
      sizeBytes: fileInfo.size,
      type: bulkData.type,
    };
    await this.saveMetadata(metadata);

    return filePath;
  }

  private async cleanOldFiles(exceptPath: string): Promise<void> {
    const metadata = await this.loadMetadata();
    if (metadata && metadata.filePath !== exceptPath && existsSync(metadata.filePath)) {
      try {
        await unlink(metadata.filePath);
        logger.info("Cleaned old bulk file", { path: metadata.filePath });
      } catch {
        // Non-fatal: old file might already be gone
      }
    }
  }

  private async loadMetadata(): Promise<BulkCacheMetadata | null> {
    const metaPath = path.join(this.cacheDir, METADATA_FILE);
    try {
      const raw = await readFile(metaPath, "utf-8");
      return JSON.parse(raw) as BulkCacheMetadata;
    } catch {
      return null;
    }
  }

  private async saveMetadata(metadata: BulkCacheMetadata): Promise<void> {
    const metaPath = path.join(this.cacheDir, METADATA_FILE);
    await writeFile(metaPath, JSON.stringify(metadata, null, 2), "utf-8");
  }
}

// --- Utility filters for common use cases ---

/** Filter: paper-only cards (excludes digital-only, oversized, tokens) */
export function paperCardFilter(card: ScryfallCard): boolean {
  if (card.digital) return false;
  if (card.oversized) return false;
  if (!card.games.includes("paper")) return false;
  if (card.layout === "token" || card.layout === "emblem" || card.layout === "planar") return false;
  return true;
}

/** Set types that make sense for a retail singles store */
export const IMPORTABLE_SET_TYPES = new Set([
  "core",
  "expansion",
  "masters",
  "draft_innovation",
  "commander",
  "starter",
  "treasure_chest",
  "funny",
  "masterpiece",
]);

/** Filter: only cards from importable set types */
export function retailSetFilter(card: ScryfallCard): boolean {
  return IMPORTABLE_SET_TYPES.has(card.set_type);
}

/** Combined filter for retail paper singles */
export function retailPaperFilter(card: ScryfallCard): boolean {
  return paperCardFilter(card) && retailSetFilter(card);
}

// --- Configurable filter for settings-driven imports ---

export interface CardFilterOptions {
  physicalOnly: boolean;
  includeOversized: boolean;
  includeTokens: boolean;
  importableSetTypes: Set<string>;
}

/** Create a card filter from user-configured settings */
export function createCardFilter(options: CardFilterOptions): (card: ScryfallCard) => boolean {
  return (card) => {
    if (options.physicalOnly) {
      if (card.digital) return false;
      if (!card.games.includes("paper")) return false;
    }
    if (!options.includeOversized && card.oversized) return false;
    if (!options.includeTokens && (card.layout === "token" || card.layout === "emblem" || card.layout === "planar")) return false;
    if (!options.importableSetTypes.has(card.set_type)) return false;
    return true;
  };
}
