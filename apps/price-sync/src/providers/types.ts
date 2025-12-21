/**
 * Price provider types - shared interface for all price sources
 */

export interface CardPrice {
  /** USD price (primary) */
  usd: number | null;
  /** USD foil price */
  usdFoil: number | null;
  /** EUR price */
  eur: number | null;
  /** EUR foil price */
  eurFoil: number | null;
}

export interface CardIdentifier {
  /** Scryfall card ID */
  scryfallId?: string;
  /** Set code + collector number (e.g., "NEO-123") */
  setCollectorNumber?: string;
  /** TCGPlayer product ID */
  tcgplayerId?: string;
  /** Card name (fallback) */
  name?: string;
}

export interface CardPriceResult {
  identifier: CardIdentifier;
  prices: CardPrice;
  source: "scryfall" | "tcgplayer";
  sourceUrl?: string;
  fetchedAt: Date;
  /** True if card was found */
  found: boolean;
  /** Error message if lookup failed */
  error?: string;
}

export interface PriceProvider {
  /** Provider name */
  name: string;

  /**
   * Fetch price for a single card
   */
  fetchPrice(identifier: CardIdentifier): Promise<CardPriceResult>;

  /**
   * Fetch prices for multiple cards (with rate limiting)
   */
  fetchPrices(identifiers: CardIdentifier[]): Promise<CardPriceResult[]>;

  /**
   * Get bulk data download URL (if supported)
   */
  getBulkDataUrl?(): Promise<string | null>;
}
