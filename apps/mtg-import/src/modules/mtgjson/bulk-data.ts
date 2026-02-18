/**
 * MTGJSON Bulk Data Manager
 *
 * Provides the same streaming interface as BulkDataManager but sourced from
 * MTGJSON AllPrintings data. Used as a fallback when Scryfall is unavailable.
 *
 * Downloads AllPrintings.json (~1.5GB) and streams cards converted to
 * ScryfallCard format via the card-adapter.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";

import { createLogger } from "@/lib/logger";
import type { ScryfallCard } from "../scryfall/types";
import { adaptMtgjsonCard, type MtgjsonCard, type MtgjsonSet } from "./card-adapter";

const logger = createLogger("MtgjsonBulkData");

const MTGJSON_URL = "https://mtgjson.com/api/v5/AllPrintings.json";
const DEFAULT_CACHE_DIR = "data/mtgjson";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface MtgjsonBulkOptions {
  cacheDir?: string;
  cacheTtlMs?: number;
}

export class MtgjsonBulkDataManager {
  private readonly cacheDir: string;
  private readonly cacheTtlMs: number;

  constructor(options: MtgjsonBulkOptions = {}) {
    this.cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
    this.cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
  }

  /**
   * Stream all cards from MTGJSON as ScryfallCard format.
   * Downloads AllPrintings.json if not cached.
   */
  async *streamCards(filter?: (card: ScryfallCard) => boolean): AsyncGenerator<ScryfallCard> {
    const filePath = await this.ensureFreshFile();
    const raw = await readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    const sets = data.data ?? data;

    let count = 0;
    for (const setCode of Object.keys(sets)) {
      const setData = sets[setCode];
      const mtgjsonSet: MtgjsonSet = {
        code: setCode,
        name: setData.name ?? setCode,
        releaseDate: setData.releaseDate,
        type: setData.type ?? "unknown",
      };

      const cards: MtgjsonCard[] = setData.cards ?? [];
      for (const card of cards) {
        if (!card.identifiers?.scryfallId) continue;

        const scryfallCard = adaptMtgjsonCard(card, mtgjsonSet);
        if (!filter || filter(scryfallCard)) {
          count++;
          yield scryfallCard;
        }
      }
    }

    logger.info("MTGJSON streaming complete", { cardsYielded: count });
  }

  /**
   * Stream cards from a specific set.
   */
  async *streamSet(setCode: string): AsyncGenerator<ScryfallCard> {
    const upperSetCode = setCode.toUpperCase();
    const lowerSetCode = setCode.toLowerCase();

    const filePath = await this.ensureFreshFile();
    const raw = await readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    const sets = data.data ?? data;

    // MTGJSON uses uppercase set codes
    const setData = sets[upperSetCode] ?? sets[lowerSetCode] ?? sets[setCode];
    if (!setData) {
      logger.warn("Set not found in MTGJSON data", { setCode });
      return;
    }

    const mtgjsonSet: MtgjsonSet = {
      code: setCode,
      name: setData.name ?? setCode,
      releaseDate: setData.releaseDate,
      type: setData.type ?? "unknown",
    };

    const cards: MtgjsonCard[] = setData.cards ?? [];
    let count = 0;
    for (const card of cards) {
      if (!card.identifiers?.scryfallId) continue;

      const scryfallCard = adaptMtgjsonCard(card, mtgjsonSet);
      count++;
      yield scryfallCard;
    }

    logger.info("MTGJSON set streaming complete", { setCode, cardsYielded: count });
  }

  /**
   * Check if MTGJSON data is available (cached and fresh).
   */
  async isAvailable(): Promise<boolean> {
    const filePath = path.join(this.cacheDir, "AllPrintings.json");
    if (!existsSync(filePath)) return false;
    const fileInfo = await stat(filePath);
    const age = Date.now() - fileInfo.mtimeMs;
    return age < this.cacheTtlMs;
  }

  private async ensureFreshFile(): Promise<string> {
    await mkdir(this.cacheDir, { recursive: true });
    const filePath = path.join(this.cacheDir, "AllPrintings.json");

    if (existsSync(filePath)) {
      const fileInfo = await stat(filePath);
      const age = Date.now() - fileInfo.mtimeMs;
      if (age < this.cacheTtlMs) {
        logger.info("Using cached MTGJSON file", {
          filePath,
          ageHours: Math.round((age / 3600000) * 10) / 10,
        });
        return filePath;
      }
    }

    logger.info("Downloading MTGJSON AllPrintings", { url: MTGJSON_URL });
    const response = await fetch(MTGJSON_URL, {
      headers: { "User-Agent": "SaleorMTGImport/1.0" },
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to download MTGJSON: HTTP ${response.status}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeStream = Readable.fromWeb(response.body as any);
    const fileWriter = createWriteStream(filePath);
    await pipeline(nodeStream, fileWriter);

    const fileInfo = await stat(filePath);
    logger.info("MTGJSON download complete", {
      filePath,
      sizeBytes: fileInfo.size,
    });

    return filePath;
  }
}
