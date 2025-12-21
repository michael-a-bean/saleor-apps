/**
 * Scryfall API Client
 *
 * Implements rate-limited access to Scryfall's free API.
 * Scryfall requires 50-100ms between requests.
 *
 * Docs: https://scryfall.com/docs/api
 */

import { getEnv } from "../lib/env.js";
import { logger } from "../lib/logger.js";

import type { CardIdentifier, CardPrice, CardPriceResult, PriceProvider } from "./types.js";

// Scryfall API response types
interface ScryfallCard {
  id: string;
  name: string;
  set: string;
  collector_number: string;
  prices: {
    usd: string | null;
    usd_foil: string | null;
    eur: string | null;
    eur_foil: string | null;
  };
  scryfall_uri: string;
}

interface ScryfallError {
  object: "error";
  code: string;
  status: number;
  details: string;
}

interface ScryfallBulkData {
  object: "list";
  data: Array<{
    id: string;
    type: string;
    name: string;
    download_uri: string;
    updated_at: string;
  }>;
}

/**
 * Simple rate limiter that ensures minimum delay between calls
 */
class RateLimiter {
  private lastCallTime = 0;
  private readonly minDelayMs: number;

  constructor(minDelayMs: number) {
    this.minDelayMs = minDelayMs;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCallTime;
    const waitTime = Math.max(0, this.minDelayMs - timeSinceLastCall);

    if (waitTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastCallTime = Date.now();
  }
}

export class ScryfallProvider implements PriceProvider {
  readonly name = "scryfall";

  private readonly baseUrl: string;
  private readonly rateLimiter: RateLimiter;

  constructor() {
    const env = getEnv();
    this.baseUrl = env.SCRYFALL_API_BASE_URL;
    this.rateLimiter = new RateLimiter(env.SCRYFALL_RATE_LIMIT_MS);
  }

  /**
   * Fetch a single card's price
   */
  async fetchPrice(identifier: CardIdentifier): Promise<CardPriceResult> {
    await this.rateLimiter.waitForSlot();

    const url = this.buildCardUrl(identifier);
    if (!url) {
      return {
        identifier,
        prices: { usd: null, usdFoil: null, eur: null, eurFoil: null },
        source: "scryfall",
        fetchedAt: new Date(),
        found: false,
        error: "No valid identifier provided",
      };
    }

    try {
      logger.debug("Fetching card from Scryfall", { url });

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "SaleorPriceSync/1.0 (https://github.com/saleor)",
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return {
            identifier,
            prices: { usd: null, usdFoil: null, eur: null, eurFoil: null },
            source: "scryfall",
            fetchedAt: new Date(),
            found: false,
            error: "Card not found",
          };
        }

        const errorData = (await response.json()) as ScryfallError;
        throw new Error(`Scryfall API error: ${errorData.details}`);
      }

      const card = (await response.json()) as ScryfallCard;
      return this.cardToResult(card, identifier);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to fetch card from Scryfall", { identifier, error: message });

      return {
        identifier,
        prices: { usd: null, usdFoil: null, eur: null, eurFoil: null },
        source: "scryfall",
        fetchedAt: new Date(),
        found: false,
        error: message,
      };
    }
  }

  /**
   * Fetch prices for multiple cards with rate limiting
   */
  async fetchPrices(identifiers: CardIdentifier[]): Promise<CardPriceResult[]> {
    const results: CardPriceResult[] = [];

    for (const identifier of identifiers) {
      const result = await this.fetchPrice(identifier);
      results.push(result);
    }

    return results;
  }

  /**
   * Get URL for Scryfall bulk data (all cards with prices)
   * This is more efficient for full catalog syncs
   */
  async getBulkDataUrl(): Promise<string | null> {
    await this.rateLimiter.waitForSlot();

    try {
      const response = await fetch(`${this.baseUrl}/bulk-data`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "SaleorPriceSync/1.0 (https://github.com/saleor)",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch bulk data list: ${response.status}`);
      }

      const data = (await response.json()) as ScryfallBulkData;

      // Find the "default_cards" bulk data (includes prices, ~80MB)
      const defaultCards = data.data.find((item) => item.type === "default_cards");

      if (!defaultCards) {
        logger.warn("Could not find default_cards bulk data");
        return null;
      }

      logger.info("Found Scryfall bulk data", {
        type: defaultCards.type,
        updatedAt: defaultCards.updated_at,
      });

      return defaultCards.download_uri;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to get bulk data URL", { error: message });
      return null;
    }
  }

  /**
   * Build the API URL for a card lookup
   */
  private buildCardUrl(identifier: CardIdentifier): string | null {
    if (identifier.scryfallId) {
      return `${this.baseUrl}/cards/${identifier.scryfallId}`;
    }

    if (identifier.setCollectorNumber) {
      // Parse "SET-123" format
      const match = identifier.setCollectorNumber.match(/^([A-Za-z0-9]+)-(.+)$/);
      if (match) {
        const [, set, number] = match;
        return `${this.baseUrl}/cards/${set.toLowerCase()}/${number}`;
      }
    }

    if (identifier.name) {
      return `${this.baseUrl}/cards/named?exact=${encodeURIComponent(identifier.name)}`;
    }

    return null;
  }

  /**
   * Convert Scryfall card response to our price result format
   */
  private cardToResult(card: ScryfallCard, identifier: CardIdentifier): CardPriceResult {
    const prices: CardPrice = {
      usd: card.prices.usd ? parseFloat(card.prices.usd) : null,
      usdFoil: card.prices.usd_foil ? parseFloat(card.prices.usd_foil) : null,
      eur: card.prices.eur ? parseFloat(card.prices.eur) : null,
      eurFoil: card.prices.eur_foil ? parseFloat(card.prices.eur_foil) : null,
    };

    return {
      identifier: {
        ...identifier,
        scryfallId: card.id,
        setCollectorNumber: `${card.set.toUpperCase()}-${card.collector_number}`,
      },
      prices,
      source: "scryfall",
      sourceUrl: card.scryfall_uri,
      fetchedAt: new Date(),
      found: true,
    };
  }
}

/**
 * Parse Scryfall bulk data JSON array stream
 * Used for full catalog sync
 *
 * Scryfall bulk data format is a JSON array with one card per line:
 * [
 * {...card1...},
 * {...card2...},
 * {...cardN...}
 * ]
 *
 * This parser processes line-by-line for memory efficiency.
 */
export async function* parseBulkData(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<ScryfallCard> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let cardCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining data
        if (buffer.trim()) {
          const card = tryParseCardLine(buffer);
          if (card) {
            yield card;
            cardCount++;
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.substring(0, newlineIdx);
        buffer = buffer.substring(newlineIdx + 1);

        const card = tryParseCardLine(line);
        if (card) {
          yield card;
          cardCount++;

          // Log progress periodically
          if (cardCount % 25000 === 0) {
            logger.debug("Bulk data parsing progress", { cardCount });
          }
        }
      }
    }

    logger.info("Bulk data parsing complete", { totalCards: cardCount });
  } finally {
    reader.releaseLock();
  }
}

/**
 * Try to parse a line as a card JSON object
 * Handles leading commas and array brackets
 */
function tryParseCardLine(line: string): ScryfallCard | null {
  // Trim whitespace
  let trimmed = line.trim();

  // Skip empty lines, array brackets
  if (!trimmed || trimmed === "[" || trimmed === "]") {
    return null;
  }

  // Remove trailing comma
  if (trimmed.endsWith(",")) {
    trimmed = trimmed.slice(0, -1);
  }

  // Must be a JSON object
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  try {
    const card = JSON.parse(trimmed) as ScryfallCard;
    // Validate it's a card with required fields
    if (card.id && card.set && card.collector_number) {
      return card;
    }
  } catch {
    // Invalid JSON, skip
  }

  return null;
}
