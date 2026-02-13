/**
 * Scryfall API types for the MTG Import app.
 * Based on https://scryfall.com/docs/api
 */

// --- Card Object ---

export interface ScryfallImageUris {
  small: string;
  normal: string;
  large: string;
  png: string;
  art_crop: string;
  border_crop: string;
}

export interface ScryfallCardFace {
  object: "card_face";
  name: string;
  mana_cost: string;
  type_line: string;
  oracle_text?: string;
  colors?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  flavor_text?: string;
  illustration_id?: string;
  image_uris?: ScryfallImageUris;
}

export interface ScryfallPrices {
  usd: string | null;
  usd_foil: string | null;
  usd_etched: string | null;
  eur: string | null;
  eur_foil: string | null;
  tix: string | null;
}

export type ScryfallRarity = "common" | "uncommon" | "rare" | "mythic" | "special" | "bonus";

export type ScryfallFinish = "nonfoil" | "foil" | "etched";

export type ScryfallLayout =
  | "normal"
  | "split"
  | "flip"
  | "transform"
  | "modal_dfc"
  | "meld"
  | "leveler"
  | "class"
  | "case"
  | "saga"
  | "adventure"
  | "mutate"
  | "prototype"
  | "battle"
  | "planar"
  | "scheme"
  | "vanguard"
  | "token"
  | "double_faced_token"
  | "emblem"
  | "augment"
  | "host"
  | "art_series"
  | "reversible_card";

export type ScryfallImageStatus = "missing" | "placeholder" | "lowres" | "highres_scan";

export interface ScryfallCard {
  // Identity
  object: "card";
  id: string;
  oracle_id: string;
  name: string;
  lang: string;
  released_at: string;
  uri: string;
  scryfall_uri: string;
  layout: ScryfallLayout;

  // Gameplay
  mana_cost?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  colors?: string[];
  color_identity: string[];
  keywords: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  life_modifier?: string;
  hand_modifier?: string;

  legalities: Record<string, string>;
  reserved: boolean;

  // Print
  set: string;
  set_name: string;
  set_type: string;
  collector_number: string;
  rarity: ScryfallRarity;
  flavor_text?: string;
  artist?: string;
  illustration_id?: string;

  // Finishes & Prices
  finishes: ScryfallFinish[];
  prices: ScryfallPrices;

  // Images
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallCardFace[];
  image_status: ScryfallImageStatus;

  // Flags
  reprint: boolean;
  digital: boolean;
  full_art: boolean;
  oversized: boolean;
  promo: boolean;
  booster: boolean;

  promo_types?: string[];
  games: string[];
  border_color: string;
  frame: string;
  frame_effects?: string[];

  // External IDs
  tcgplayer_id?: number;
  tcgplayer_etched_id?: number;
  cardmarket_id?: number;
  mtgo_id?: number;
  arena_id?: number;
  multiverse_ids?: number[];

  // Popularity
  edhrec_rank?: number;
  penny_rank?: number;

  // Related
  all_parts?: ScryfallRelatedCard[];
}

export interface ScryfallRelatedCard {
  object: "related_card";
  id: string;
  component: "combo_piece" | "meld_part" | "meld_result" | "token";
  name: string;
  type_line: string;
  uri: string;
}

// --- Bulk Data ---

export interface ScryfallBulkDataItem {
  object: "bulk_data";
  id: string;
  type: "oracle_cards" | "unique_artwork" | "default_cards" | "all_cards" | "rulings";
  updated_at: string;
  uri: string;
  name: string;
  description: string;
  size: number;
  download_uri: string;
  content_type: "application/json";
  content_encoding: "gzip";
}

export interface ScryfallBulkDataResponse {
  object: "list";
  has_more: boolean;
  data: ScryfallBulkDataItem[];
}

// --- Search ---

export interface ScryfallSearchResponse {
  object: "list";
  total_cards: number;
  has_more: boolean;
  next_page?: string;
  data: ScryfallCard[];
  warnings?: string[];
}

export interface ScryfallSearchOptions {
  unique?: "cards" | "art" | "prints";
  order?: "name" | "set" | "released" | "rarity" | "color" | "usd" | "tix" | "eur" | "cmc" | "power" | "toughness" | "edhrec" | "penny" | "artist" | "review";
  dir?: "asc" | "desc" | "auto";
  include_extras?: boolean;
  include_multilingual?: boolean;
  include_variations?: boolean;
  page?: number;
}

// --- Sets ---

export interface ScryfallSet {
  object: "set";
  id: string;
  code: string;
  name: string;
  set_type: string;
  released_at?: string;
  card_count: number;
  digital: boolean;
  icon_svg_uri: string;
  search_uri: string;
  scryfall_uri: string;
  uri: string;
  parent_set_code?: string;
  block_code?: string;
  block?: string;
}

export interface ScryfallSetListResponse {
  object: "list";
  has_more: boolean;
  data: ScryfallSet[];
}

// --- Error ---

export interface ScryfallErrorResponse {
  object: "error";
  code: string;
  status: number;
  details: string;
  type?: string;
  warnings?: string[];
}

// --- Utility types for the import pipeline ---

export type ConditionCode = "NM" | "LP" | "MP" | "HP" | "DMG";
export type FinishCode = "NF" | "F" | "E";

export const CONDITIONS: ConditionCode[] = ["NM", "LP", "MP", "HP", "DMG"];

export const FINISH_MAP: Record<ScryfallFinish, FinishCode> = {
  nonfoil: "NF",
  foil: "F",
  etched: "E",
};

/** Get the primary image URI for a card, handling multi-faced cards */
export function getCardImageUri(card: ScryfallCard, size: keyof ScryfallImageUris = "normal"): string | null {
  if (card.image_uris) {
    return card.image_uris[size];
  }
  if (card.card_faces?.[0]?.image_uris) {
    return card.card_faces[0].image_uris[size];
  }
  return null;
}

/** Generate SKU string: {scryfall_id_prefix}-{condition}-{finish} */
export function generateSku(scryfallId: string, condition: ConditionCode, finish: FinishCode): string {
  // Use first 8 chars of UUID for shorter SKUs
  const prefix = scryfallId.substring(0, 8);
  return `${prefix}-${condition}-${finish}`;
}

/** Generate all variant SKUs for a card based on its available finishes */
export function generateVariantSkus(card: ScryfallCard): Array<{ sku: string; condition: ConditionCode; finish: FinishCode; scryfallFinish: ScryfallFinish }> {
  const variants: Array<{ sku: string; condition: ConditionCode; finish: FinishCode; scryfallFinish: ScryfallFinish }> = [];

  for (const finish of card.finishes) {
    const finishCode = FINISH_MAP[finish];
    for (const condition of CONDITIONS) {
      variants.push({
        sku: generateSku(card.id, condition, finishCode),
        condition,
        finish: finishCode,
        scryfallFinish: finish,
      });
    }
  }

  return variants;
}
