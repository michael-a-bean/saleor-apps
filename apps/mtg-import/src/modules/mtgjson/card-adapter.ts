/**
 * MTGJSON-to-ScryfallCard Adapter
 *
 * Normalizes MTGJSON card data into the ScryfallCard shape so that
 * pipeline.ts and attribute-map.ts need zero changes. This allows
 * MTGJSON to serve as a fallback data source when Scryfall is down.
 *
 * Key design decisions:
 * - Image URIs are constructed from the Scryfall CDN URL pattern
 * - Prices map only TCGPlayer retail (paper) since that's what we use
 * - Cards without scryfallId are filtered out (no way to link them)
 * - Set-level data (name, type, releaseDate) comes from the set context
 */

import type {
  ScryfallCard,
  ScryfallFinish,
  ScryfallImageUris,
  ScryfallLayout,
  ScryfallPrices,
  ScryfallRarity,
} from "../scryfall/types";

// --- MTGJSON Input Types ---

export interface MtgjsonCardIdentifiers {
  scryfallId: string;
  scryfallOracleId?: string;
  tcgplayerProductId?: string;
  tcgplayerEtchedProductId?: string;
  cardmarketId?: string;
  mtgoId?: string;
  mtgArenaId?: string;
}

export interface MtgjsonCardPrices {
  paper?: {
    tcgplayer?: {
      retail?: {
        normal?: Record<string, number>;
        foil?: Record<string, number>;
        etched?: Record<string, number>;
      };
    };
  };
}

export interface MtgjsonCard {
  uuid: string;
  name: string;
  type: string;
  manaCost?: string;
  manaValue: number;
  text?: string;
  flavorText?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  number: string;
  rarity: string;
  artist?: string;
  layout: string;
  setCode: string;
  colors?: string[];
  colorIdentity?: string[];
  keywords?: string[];
  isReserved: boolean;
  isReprint: boolean;
  isPromo: boolean;
  isFullArt: boolean;
  isOnlineOnly: boolean;
  finishTypes: string[];
  identifiers: MtgjsonCardIdentifiers;
  prices: MtgjsonCardPrices;
}

export interface MtgjsonSet {
  code: string;
  name: string;
  releaseDate?: string;
  type: string;
}

// --- Image URI Construction ---

const SCRYFALL_CDN_BASE = "https://cards.scryfall.io";

/**
 * Build a Scryfall CDN image URL from a card's Scryfall ID.
 *
 * Scryfall CDN URL pattern:
 *   https://cards.scryfall.io/{size}/front/{id[0]}/{id[1]}/{id}.{ext}
 *
 * Where ext is "png" for the png size and "jpg" for all others.
 */
export function buildScryfallImageUri(
  scryfallId: string,
  size: keyof ScryfallImageUris
): string {
  const dir1 = scryfallId[0];
  const dir2 = scryfallId[1];
  const ext = size === "png" ? "png" : "jpg";
  return `${SCRYFALL_CDN_BASE}/${size}/front/${dir1}/${dir2}/${scryfallId}.${ext}`;
}

/**
 * Build complete ScryfallImageUris from a Scryfall ID.
 */
function buildImageUris(scryfallId: string): ScryfallImageUris {
  return {
    small: buildScryfallImageUri(scryfallId, "small"),
    normal: buildScryfallImageUri(scryfallId, "normal"),
    large: buildScryfallImageUri(scryfallId, "large"),
    png: buildScryfallImageUri(scryfallId, "png"),
    art_crop: buildScryfallImageUri(scryfallId, "art_crop"),
    border_crop: buildScryfallImageUri(scryfallId, "border_crop"),
  };
}

// --- Price Extraction ---

/**
 * Get the most recent price from a date-keyed price object.
 * MTGJSON prices: { "2026-02-17": 1.50, "2026-02-16": 1.48 }
 * ISO dates sort lexicographically, reverse gives latest first.
 */
function getLatestPrice(
  datePrices: Record<string, number> | undefined
): number | null {
  if (!datePrices) return null;
  const dates = Object.keys(datePrices).sort().reverse();
  if (dates.length === 0) return null;
  const price = datePrices[dates[0]];
  return typeof price === "number" && !isNaN(price) ? price : null;
}

/**
 * Format a number to 2 decimal places as a string (matching Scryfall format).
 */
function formatPrice(value: number | null): string | null {
  if (value === null) return null;
  return value.toFixed(2);
}

/**
 * Extract ScryfallPrices from MTGJSON price data.
 * Only maps TCGPlayer retail paper prices (normal, foil, etched).
 * EUR/TIX are not available from MTGJSON's TCGPlayer data.
 */
function extractPrices(prices: MtgjsonCardPrices): ScryfallPrices {
  const retail = prices?.paper?.tcgplayer?.retail;

  return {
    usd: formatPrice(getLatestPrice(retail?.normal)),
    usd_foil: formatPrice(getLatestPrice(retail?.foil)),
    usd_etched: formatPrice(getLatestPrice(retail?.etched)),
    eur: null,
    eur_foil: null,
    tix: null,
  };
}

// --- Finish Mapping ---

/**
 * Map MTGJSON finishTypes to ScryfallFinish values.
 * MTGJSON uses the same names: "nonfoil", "foil", "etched".
 */
function mapFinishes(finishTypes: string[]): ScryfallFinish[] {
  if (finishTypes.length === 0) {
    return ["nonfoil"]; // Default fallback
  }

  const validFinishes: ScryfallFinish[] = [];
  for (const ft of finishTypes) {
    if (ft === "nonfoil" || ft === "foil" || ft === "etched") {
      validFinishes.push(ft);
    }
  }

  return validFinishes.length > 0 ? validFinishes : ["nonfoil"];
}

// --- Games Array ---

/**
 * Determine which game platforms a card is available on.
 */
function determineGames(card: MtgjsonCard): string[] {
  if (card.isOnlineOnly) {
    // Online-only cards appear on MTGO and/or Arena but not paper
    const games: string[] = [];
    if (card.identifiers.mtgoId) games.push("mtgo");
    if (card.identifiers.mtgArenaId) games.push("arena");
    return games.length > 0 ? games : ["mtgo"];
  }
  return ["paper"];
}

// --- Optional Numeric ID Parsing ---

/**
 * Parse an optional string ID to a number, returning undefined if not parseable.
 */
function parseOptionalId(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const num = parseInt(value, 10);
  return isNaN(num) ? undefined : num;
}

// --- Main Adapter ---

/**
 * Adapt a single MTGJSON card to the ScryfallCard shape.
 *
 * This function maps every field that pipeline.ts and attribute-map.ts consume,
 * including all 23 attributes, image URIs, prices, and structural metadata.
 *
 * Fields that MTGJSON does not provide get sensible defaults:
 * - legalities: empty object (not needed for import)
 * - image_status: "lowres" (CDN URLs are valid but may be from older scans)
 * - border_color, frame: reasonable defaults
 */
export function adaptMtgjsonCard(
  card: MtgjsonCard,
  set: MtgjsonSet
): ScryfallCard {
  const scryfallId = card.identifiers.scryfallId;
  const setCodeLower = card.setCode.toLowerCase();

  return {
    // Identity
    object: "card",
    id: scryfallId,
    oracle_id: card.identifiers.scryfallOracleId ?? "",
    name: card.name,
    lang: "en",
    released_at: set.releaseDate ?? "",
    uri: `https://api.scryfall.com/cards/${scryfallId}`,
    scryfall_uri: `https://scryfall.com/card/${setCodeLower}/${card.number}`,
    layout: card.layout as ScryfallLayout,

    // Gameplay
    mana_cost: card.manaCost,
    cmc: card.manaValue,
    type_line: card.type,
    oracle_text: card.text,
    colors: card.colors,
    color_identity: card.colorIdentity ?? [],
    keywords: card.keywords ?? [],
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    flavor_text: card.flavorText,

    legalities: {},
    reserved: card.isReserved,

    // Print
    set: setCodeLower,
    set_name: set.name,
    set_type: set.type,
    collector_number: card.number,
    rarity: card.rarity as ScryfallRarity,
    artist: card.artist,

    // Finishes & Prices
    finishes: mapFinishes(card.finishTypes),
    prices: extractPrices(card.prices),

    // Images
    image_uris: buildImageUris(scryfallId),
    image_status: "lowres",

    // Flags
    reprint: card.isReprint,
    digital: card.isOnlineOnly,
    full_art: card.isFullArt,
    oversized: false,
    promo: card.isPromo,
    booster: true,

    games: determineGames(card),
    border_color: "black",
    frame: "2015",

    // External IDs
    tcgplayer_id: parseOptionalId(card.identifiers.tcgplayerProductId),
    tcgplayer_etched_id: parseOptionalId(
      card.identifiers.tcgplayerEtchedProductId
    ),
    cardmarket_id: parseOptionalId(card.identifiers.cardmarketId),
    mtgo_id: parseOptionalId(card.identifiers.mtgoId),
    arena_id: parseOptionalId(card.identifiers.mtgArenaId),
  };
}

/**
 * Adapt all cards in a MTGJSON set to ScryfallCard[].
 * Filters out cards without a scryfallId (they cannot be used in our pipeline).
 */
export function adaptMtgjsonSet(
  set: MtgjsonSet,
  cards: MtgjsonCard[]
): ScryfallCard[] {
  return cards
    .filter((card) => card.identifiers.scryfallId?.length > 0)
    .map((card) => adaptMtgjsonCard(card, set));
}
