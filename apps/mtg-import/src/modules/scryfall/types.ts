/**
 * Scryfall API Types
 * Based on https://scryfall.com/docs/api
 */

/**
 * Scryfall card finishes
 */
export type ScryfallFinish = "nonfoil" | "foil" | "etched";

/**
 * Scryfall card prices
 */
export interface ScryfallPrices {
  usd: string | null;
  usd_foil: string | null;
  usd_etched: string | null;
  eur: string | null;
  eur_foil: string | null;
  tix: string | null;
}

/**
 * Scryfall image URIs
 */
export interface ScryfallImageUris {
  small: string;
  normal: string;
  large: string;
  png: string;
  art_crop: string;
  border_crop: string;
}

/**
 * Scryfall card object
 */
export interface ScryfallCard {
  // Core identifiers
  id: string;  // Scryfall UUID
  oracle_id: string;
  tcgplayer_id?: number;
  cardmarket_id?: number;

  // Names
  name: string;
  printed_name?: string;
  lang: string;

  // Set info
  set: string;
  set_name: string;
  set_type: string;
  collector_number: string;

  // Card characteristics
  type_line: string;
  oracle_text?: string;
  mana_cost?: string;
  cmc: number;
  colors?: string[];
  color_identity: string[];
  keywords: string[];

  // Power/toughness (creature cards)
  power?: string;
  toughness?: string;

  // Loyalty (planeswalker cards)
  loyalty?: string;

  // Rarity
  rarity: "common" | "uncommon" | "rare" | "mythic" | "special" | "bonus";

  // Availability
  finishes: ScryfallFinish[];
  games: string[];

  // Legal in formats
  legalities: Record<string, "legal" | "not_legal" | "restricted" | "banned">;

  // Pricing
  prices: ScryfallPrices;

  // Images
  image_uris?: ScryfallImageUris;

  // Card faces (for double-faced cards)
  card_faces?: Array<{
    name: string;
    type_line: string;
    oracle_text?: string;
    mana_cost?: string;
    colors?: string[];
    power?: string;
    toughness?: string;
    loyalty?: string;
    image_uris?: ScryfallImageUris;
  }>;

  // Layout
  layout: string;

  // Flags
  reserved: boolean;
  foil: boolean;
  nonfoil: boolean;
  oversized: boolean;
  promo: boolean;
  reprint: boolean;
  variation: boolean;
  digital: boolean;

  // Artist
  artist?: string;

  // Frame info
  frame: string;
  full_art: boolean;
  textless: boolean;
  border_color: string;

  // Release date
  released_at: string;

  // URI
  scryfall_uri: string;
  uri: string;
}

/**
 * Scryfall set object
 */
export interface ScryfallSet {
  id: string;
  code: string;
  name: string;
  set_type: string;
  released_at?: string;
  card_count: number;
  digital: boolean;
  foil_only: boolean;
  nonfoil_only: boolean;
  icon_svg_uri: string;
  search_uri: string;
  scryfall_uri: string;
}

/**
 * Scryfall bulk data info
 */
export interface ScryfallBulkDataInfo {
  id: string;
  type: string;
  name: string;
  description: string;
  download_uri: string;
  updated_at: string;
  size: number;
  content_type: string;
  content_encoding: string;
}

/**
 * Scryfall list response (paginated)
 */
export interface ScryfallList<T> {
  object: "list";
  total_cards?: number;
  has_more: boolean;
  next_page?: string;
  data: T[];
}

/**
 * Scryfall bulk data response
 */
export interface ScryfallBulkDataResponse {
  object: "list";
  has_more: boolean;
  data: ScryfallBulkDataInfo[];
}

/**
 * Filter for English, paper-legal cards
 */
export function isEnglishPaperCard(card: ScryfallCard): boolean {
  return (
    card.lang === "en" &&
    card.games.includes("paper") &&
    !card.digital &&
    !card.oversized
  );
}

/**
 * Get card finishes that should have variants
 */
export function getCardFinishes(card: ScryfallCard): ScryfallFinish[] {
  return card.finishes.filter((finish) =>
    finish === "nonfoil" || finish === "foil" || finish === "etched"
  );
}

/**
 * Get price for a specific finish
 */
export function getPriceForFinish(card: ScryfallCard, finish: ScryfallFinish): number | null {
  const priceStr = finish === "nonfoil"
    ? card.prices.usd
    : finish === "foil"
      ? card.prices.usd_foil
      : card.prices.usd_etched;

  if (!priceStr) return null;

  const price = parseFloat(priceStr);
  return isNaN(price) ? null : price;
}
