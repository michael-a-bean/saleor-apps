/**
 * Scryfall API client with rate limiting, retry logic, and proper headers.
 *
 * Handles:
 * - Rate limiting (10 req/sec via token bucket)
 * - Retry with exponential backoff for 429/503
 * - Proper User-Agent per Scryfall TOS
 * - Card search with pagination
 * - Set listing
 * - Single card lookup
 */

import { createLogger } from "@/lib/logger";
import { ScryfallApiError } from "@/lib/errors";
import { RateLimiter } from "./rate-limiter";
import type {
  ScryfallCard,
  ScryfallErrorResponse,
  ScryfallSearchOptions,
  ScryfallSearchResponse,
  ScryfallSet,
  ScryfallSetListResponse,
  ScryfallBulkDataItem,
  ScryfallBulkDataResponse,
} from "./types";

const logger = createLogger("ScryfallClient");

const SCRYFALL_API_BASE = "https://api.scryfall.com";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

export interface ScryfallClientOptions {
  /** Contact email for User-Agent header (required by Scryfall TOS) */
  contactEmail?: string;
  /** App name for User-Agent (default: SaleorMTGImport) */
  appName?: string;
  /** App version for User-Agent (default: 1.0) */
  appVersion?: string;
  /** Custom rate limiter (default: 10 req/sec) */
  rateLimiter?: RateLimiter;
}

export class ScryfallClient {
  private readonly rateLimiter: RateLimiter;
  private readonly userAgent: string;

  constructor(options: ScryfallClientOptions = {}) {
    this.rateLimiter = options.rateLimiter ?? new RateLimiter();

    const appName = options.appName ?? "SaleorMTGImport";
    const appVersion = options.appVersion ?? "1.0";
    const contact = options.contactEmail ? ` (${options.contactEmail})` : "";
    this.userAgent = `${appName}/${appVersion}${contact}`;
  }

  // --- Public API ---

  /** Search for cards using Scryfall search syntax */
  async search(query: string, options: ScryfallSearchOptions = {}): Promise<ScryfallSearchResponse> {
    const params = new URLSearchParams({ q: query });

    if (options.unique) params.set("unique", options.unique);
    if (options.order) params.set("order", options.order);
    if (options.dir) params.set("dir", options.dir);
    if (options.include_extras) params.set("include_extras", "true");
    if (options.include_multilingual) params.set("include_multilingual", "true");
    if (options.include_variations) params.set("include_variations", "true");
    if (options.page) params.set("page", String(options.page));

    return this.get<ScryfallSearchResponse>(`/cards/search?${params}`);
  }

  /** Iterate all pages of a search query */
  async *searchAll(query: string, options: Omit<ScryfallSearchOptions, "page"> = {}): AsyncGenerator<ScryfallCard> {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.search(query, { ...options, page });

      for (const card of response.data) {
        yield card;
      }

      hasMore = response.has_more;
      page += 1;
    }
  }

  /** Get a single card by Scryfall ID */
  async getCard(scryfallId: string): Promise<ScryfallCard> {
    return this.get<ScryfallCard>(`/cards/${encodeURIComponent(scryfallId)}`);
  }

  /** Get a card by set code and collector number */
  async getCardBySetNumber(setCode: string, collectorNumber: string): Promise<ScryfallCard> {
    return this.get<ScryfallCard>(
      `/cards/${encodeURIComponent(setCode)}/${encodeURIComponent(collectorNumber)}`
    );
  }

  /** Get a card by exact name (optionally scoped to a set) */
  async getCardByName(name: string, setCode?: string): Promise<ScryfallCard> {
    const params = new URLSearchParams({ exact: name });
    if (setCode) params.set("set", setCode);
    return this.get<ScryfallCard>(`/cards/named?${params}`);
  }

  /** List all sets */
  async listSets(): Promise<ScryfallSet[]> {
    const response = await this.get<ScryfallSetListResponse>("/sets");
    return response.data;
  }

  /** Get a specific set by code */
  async getSet(setCode: string): Promise<ScryfallSet> {
    return this.get<ScryfallSet>(`/sets/${encodeURIComponent(setCode)}`);
  }

  /** Get bulk data catalog (lists available bulk downloads) */
  async getBulkDataCatalog(): Promise<ScryfallBulkDataItem[]> {
    const response = await this.get<ScryfallBulkDataResponse>("/bulk-data");
    return response.data;
  }

  /** Get the default_cards bulk data entry (for download URL) */
  async getDefaultCardsBulkData(): Promise<ScryfallBulkDataItem> {
    const catalog = await this.getBulkDataCatalog();
    const defaultCards = catalog.find((item) => item.type === "default_cards");

    if (!defaultCards) {
      throw new ScryfallApiError("Bulk data type 'default_cards' not found in catalog");
    }

    return defaultCards;
  }

  // --- Internal ---

  private async get<T>(path: string): Promise<T> {
    await this.rateLimiter.acquire();

    const url = `${SCRYFALL_API_BASE}${path}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        logger.info(`Retry ${attempt}/${MAX_RETRIES} after ${backoff}ms`, { url });
        await this.sleep(backoff);
        await this.rateLimiter.acquire();
      }

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            "User-Agent": this.userAgent,
            Accept: "application/json",
          },
        });
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn("Fetch failed", { url, attempt, error: lastError.message });
        continue;
      }

      // Success
      if (response.ok) {
        return (await response.json()) as T;
      }

      // Handle Scryfall error response
      const errorBody = await this.tryParseError(response);

      // Retryable: 429 Too Many Requests
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        logger.warn("Rate limited (429)", { url, waitMs, attempt });
        await this.sleep(waitMs);
        continue;
      }

      // Retryable: 503 Service Unavailable
      if (response.status === 503) {
        logger.warn("Service unavailable (503)", { url, attempt });
        continue;
      }

      // Non-retryable errors
      const detail = errorBody?.details ?? `HTTP ${response.status}`;
      throw new ScryfallApiError(`Scryfall API error: ${detail}`, {
        props: {
          status: response.status,
          code: errorBody?.code,
          url,
        },
      });
    }

    throw new ScryfallApiError(
      `Scryfall API request failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? "unknown error"}`,
      { props: { url } }
    );
  }

  private async tryParseError(response: Response): Promise<ScryfallErrorResponse | null> {
    try {
      const body = await response.json();
      if (body && body.object === "error") {
        return body as ScryfallErrorResponse;
      }
    } catch {
      // Response body wasn't valid JSON
    }
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
