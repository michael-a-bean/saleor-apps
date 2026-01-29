import { createLogger } from "@/lib/logger";

import {
  ScryfallBulkDataInfo,
  ScryfallBulkDataResponse,
  ScryfallCard,
  ScryfallList,
  ScryfallSet,
  isEnglishPaperCard,
} from "./types";

const logger = createLogger("scryfall-client");

const SCRYFALL_API_BASE = "https://api.scryfall.com";

// Rate limiting: Scryfall allows 10 requests/second
const RATE_LIMIT_DELAY_MS = 100;

let lastRequestTime = 0;

async function rateLimitedFetch(url: string, options?: RequestInit): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < RATE_LIMIT_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS - timeSinceLastRequest));
  }

  lastRequestTime = Date.now();

  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": "SaleorMTGImportApp/1.0",
      "Accept": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Scryfall API error: ${response.status} ${response.statusText}`);
  }

  return response;
}

/**
 * Get all available bulk data files
 */
export async function getBulkDataList(): Promise<ScryfallBulkDataInfo[]> {
  logger.info("Fetching bulk data list from Scryfall");

  const response = await rateLimitedFetch(`${SCRYFALL_API_BASE}/bulk-data`);
  const data: ScryfallBulkDataResponse = await response.json();

  return data.data;
}

/**
 * Get the default cards bulk data info
 * This is the main bulk file with English cards
 */
export async function getDefaultCardsBulkInfo(): Promise<ScryfallBulkDataInfo> {
  const bulkDataList = await getBulkDataList();

  const defaultCards = bulkDataList.find((item) => item.type === "default_cards");

  if (!defaultCards) {
    throw new Error("Could not find default_cards bulk data from Scryfall");
  }

  logger.info("Found default_cards bulk data", {
    size: defaultCards.size,
    updatedAt: defaultCards.updated_at,
  });

  return defaultCards;
}

/**
 * Download and parse the bulk data file
 * Returns a stream-friendly async generator for memory efficiency
 */
export async function downloadBulkData(downloadUri: string): Promise<ScryfallCard[]> {
  logger.info("Downloading bulk data from Scryfall", { uri: downloadUri });

  const response = await fetch(downloadUri, {
    headers: {
      "User-Agent": "SaleorMTGImportApp/1.0",
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download bulk data: ${response.status} ${response.statusText}`);
  }

  logger.info("Parsing bulk data JSON (this may take a moment)...");

  const cards: ScryfallCard[] = await response.json();

  logger.info("Bulk data downloaded and parsed", { totalCards: cards.length });

  return cards;
}

/**
 * Filter bulk data to only English paper cards
 */
export function filterEnglishPaperCards(cards: ScryfallCard[]): ScryfallCard[] {
  const filtered = cards.filter(isEnglishPaperCard);

  logger.info("Filtered to English paper cards", {
    originalCount: cards.length,
    filteredCount: filtered.length,
  });

  return filtered;
}

/**
 * Get all sets from Scryfall
 */
export async function getAllSets(): Promise<ScryfallSet[]> {
  logger.info("Fetching all sets from Scryfall");

  const response = await rateLimitedFetch(`${SCRYFALL_API_BASE}/sets`);
  const data: ScryfallList<ScryfallSet> = await response.json();

  logger.info("Fetched sets from Scryfall", { count: data.data.length });

  return data.data;
}

/**
 * Get a specific set by code
 */
export async function getSet(setCode: string): Promise<ScryfallSet> {
  logger.info("Fetching set from Scryfall", { setCode });

  const response = await rateLimitedFetch(`${SCRYFALL_API_BASE}/sets/${setCode}`);
  const set: ScryfallSet = await response.json();

  return set;
}

/**
 * Search cards with a query (paginated)
 * Use for per-set imports
 */
export async function searchCards(query: string): Promise<ScryfallCard[]> {
  logger.info("Searching cards from Scryfall", { query });

  const allCards: ScryfallCard[] = [];
  let nextPageUrl: string | null = `${SCRYFALL_API_BASE}/cards/search?q=${encodeURIComponent(query)}`;

  while (nextPageUrl) {
    const response = await rateLimitedFetch(nextPageUrl);
    const data: ScryfallList<ScryfallCard> = await response.json();

    allCards.push(...data.data);

    logger.debug("Fetched page of search results", {
      pageCards: data.data.length,
      totalSoFar: allCards.length,
      hasMore: data.has_more,
    });

    nextPageUrl = data.has_more && data.next_page ? data.next_page : null;
  }

  logger.info("Search complete", { totalCards: allCards.length });

  return allCards;
}

/**
 * Get all cards for a specific set
 * Uses search API with set: filter
 */
export async function getCardsForSet(setCode: string): Promise<ScryfallCard[]> {
  // Search for English paper cards in this set
  const query = `set:${setCode} lang:en game:paper -is:digital -is:oversized`;
  return searchCards(query);
}

/**
 * Get a single card by Scryfall ID
 */
export async function getCard(scryfallId: string): Promise<ScryfallCard> {
  logger.debug("Fetching single card from Scryfall", { scryfallId });

  const response = await rateLimitedFetch(`${SCRYFALL_API_BASE}/cards/${scryfallId}`);
  const card: ScryfallCard = await response.json();

  return card;
}

/**
 * Group cards by set code
 */
export function groupCardsBySet(cards: ScryfallCard[]): Map<string, ScryfallCard[]> {
  const setMap = new Map<string, ScryfallCard[]>();

  for (const card of cards) {
    const existing = setMap.get(card.set) || [];
    existing.push(card);
    setMap.set(card.set, existing);
  }

  logger.info("Grouped cards by set", {
    setCount: setMap.size,
    cardCount: cards.length,
  });

  return setMap;
}
