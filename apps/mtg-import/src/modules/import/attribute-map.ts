/**
 * MTG attribute mapping from Scryfall card fields to Saleor product attributes.
 *
 * 30 attributes: 23 original + 7 new (color_identity, colors, card_type, set_type, frame, border_color, colors).
 * Attributes must be pre-created on the "mtg-card" product type in Saleor Dashboard.
 */

import type { ScryfallCard } from "../scryfall/types";
import type { SaleorAttribute } from "../saleor/graphql-operations";

export type AttributeInputType = "PLAIN_TEXT" | "DROPDOWN" | "NUMERIC" | "BOOLEAN" | "MULTISELECT";

export interface AttributeDef {
  /** Scryfall card field name (or "__computed" for derived attributes) */
  scryfallField: keyof ScryfallCard | "__computed" | string;
  /** Human-readable name */
  name: string;
  /** Saleor attribute slug (must match what's in the product type) */
  slug: string;
  /** Saleor attribute input type */
  inputType: AttributeInputType;
  /** Optional transform for computed/derived attributes */
  transform?: (card: ScryfallCard) => unknown;
}

/**
 * The 17 known MTG card types from Scryfall's catalog.
 * Used to extract primary types from type_line for the mtg-card-type MULTISELECT.
 */
export const MTG_CARD_TYPES = new Set([
  "Artifact", "Battle", "Conspiracy", "Creature", "Dungeon", "Emblem",
  "Enchantment", "Hero", "Instant", "Kindred", "Land", "Phenomenon",
  "Plane", "Planeswalker", "Scheme", "Sorcery", "Vanguard",
]);

/** The 7 known MTG supertypes */
export const MTG_SUPERTYPES = new Set([
  "Basic", "Elite", "Legendary", "Ongoing", "Snow", "Token", "World",
]);

/**
 * Parse a type_line into its primary card types (supertypes + types).
 * Example: "Legendary Creature — Human Wizard" → ["Legendary", "Creature"]
 * Example: "Artifact Creature — Golem" → ["Artifact", "Creature"]
 */
export function parseCardTypes(card: ScryfallCard): string[] {
  if (!card.type_line) return [];
  // Handle double-faced cards first: split on " // " to get each face
  const faces = card.type_line.split(" // ");
  const types = new Set<string>();
  for (const face of faces) {
    // Split on " — " to separate types from subtypes, take only the left side
    const typePart = face.split(" — ")[0]?.trim() ?? "";
    for (const word of typePart.split(/\s+/)) {
      if (MTG_CARD_TYPES.has(word) || MTG_SUPERTYPES.has(word)) {
        types.add(word);
      }
    }
  }
  return [...types];
}

/**
 * The 30 MTG card attributes.
 * Order: external IDs → card properties → multiselect fields → dropdowns → boolean flags
 */
export const ATTRIBUTE_DEFS: AttributeDef[] = [
  // External IDs
  { scryfallField: "id", name: "Scryfall ID", slug: "mtg-scryfall-id", inputType: "PLAIN_TEXT" },
  { scryfallField: "oracle_id", name: "Oracle ID", slug: "mtg-oracle-id", inputType: "PLAIN_TEXT" },
  { scryfallField: "tcgplayer_id", name: "TCGPlayer ID", slug: "mtg-tcgplayer-id", inputType: "PLAIN_TEXT" },
  { scryfallField: "tcgplayer_etched_id", name: "TCGPlayer Etched ID", slug: "tcgplayer-etched-id", inputType: "PLAIN_TEXT" },
  { scryfallField: "cardmarket_id", name: "Cardmarket ID", slug: "cardmarket-id", inputType: "PLAIN_TEXT" },
  { scryfallField: "mtgo_id", name: "MTGO ID", slug: "mtgo-id", inputType: "PLAIN_TEXT" },
  { scryfallField: "arena_id", name: "Arena ID", slug: "arena-id", inputType: "PLAIN_TEXT" },
  // Card properties
  { scryfallField: "rarity", name: "Rarity", slug: "mtg-rarity", inputType: "DROPDOWN" },
  { scryfallField: "type_line", name: "Type Line", slug: "mtg-type-line", inputType: "PLAIN_TEXT" },
  { scryfallField: "mana_cost", name: "Mana Cost", slug: "mtg-mana-cost", inputType: "PLAIN_TEXT" },
  { scryfallField: "cmc", name: "Mana Value", slug: "mtg-mana-value", inputType: "NUMERIC" },
  { scryfallField: "set", name: "Set Code", slug: "mtg-set-code", inputType: "PLAIN_TEXT" },
  { scryfallField: "set_name", name: "Set Name", slug: "mtg-set-name", inputType: "PLAIN_TEXT" },
  { scryfallField: "artist", name: "Artist", slug: "mtg-artist", inputType: "PLAIN_TEXT" },
  { scryfallField: "collector_number", name: "Collector #", slug: "mtg-collector-number", inputType: "PLAIN_TEXT" },
  { scryfallField: "power", name: "Power", slug: "mtg-power", inputType: "PLAIN_TEXT" },
  { scryfallField: "toughness", name: "Toughness", slug: "mtg-toughness", inputType: "PLAIN_TEXT" },
  { scryfallField: "loyalty", name: "Loyalty", slug: "loyalty", inputType: "PLAIN_TEXT" },
  // Multiselect fields (array-valued)
  { scryfallField: "color_identity", name: "Color Identity", slug: "mtg-color-identity", inputType: "MULTISELECT" },
  { scryfallField: "colors", name: "Colors", slug: "mtg-colors", inputType: "MULTISELECT" },
  { scryfallField: "__computed", name: "Card Type", slug: "mtg-card-type", inputType: "MULTISELECT", transform: parseCardTypes },
  // Additional dropdowns
  { scryfallField: "set_type", name: "Set Type", slug: "mtg-set-type", inputType: "DROPDOWN" },
  { scryfallField: "frame", name: "Frame", slug: "mtg-frame", inputType: "DROPDOWN" },
  { scryfallField: "border_color", name: "Border Color", slug: "mtg-border-color", inputType: "DROPDOWN" },
  // Boolean flags
  { scryfallField: "reserved", name: "Reserved List", slug: "reserved-list", inputType: "BOOLEAN" },
  { scryfallField: "reprint", name: "Is Reprint", slug: "is-reprint", inputType: "BOOLEAN" },
  { scryfallField: "promo", name: "Is Promo", slug: "is-promo", inputType: "BOOLEAN" },
  { scryfallField: "full_art", name: "Is Full Art", slug: "is-full-art", inputType: "BOOLEAN" },
  { scryfallField: "digital", name: "Is Digital Only", slug: "is-digital-only", inputType: "BOOLEAN" },
  { scryfallField: "oversized", name: "Is Oversized", slug: "is-oversized", inputType: "BOOLEAN" },
];

/**
 * Build Saleor AttributeValueInput[] for a card.
 * Requires a lookup map of slug → Saleor attribute ID.
 */
export function buildProductAttributes(
  card: ScryfallCard,
  attributeIdMap: Map<string, string>
): Array<Record<string, unknown>> {
  const attrs: Array<Record<string, unknown>> = [];

  for (const def of ATTRIBUTE_DEFS) {
    const attrId = attributeIdMap.get(def.slug);
    if (!attrId) continue;

    // Use transform for computed attributes, otherwise read from card field
    const rawValue = def.transform
      ? def.transform(card)
      : getCardField(card, def.scryfallField);

    // Skip empty values (null, undefined, empty string, empty array)
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;
    if (Array.isArray(rawValue) && rawValue.length === 0) continue;

    const input = buildAttributeInput(attrId, def.inputType, rawValue);
    if (input) {
      attrs.push(input);
    }
  }

  return attrs;
}

/**
 * Create a slug→ID lookup map from the product type's attributes.
 */
export function buildAttributeIdMap(attributes: SaleorAttribute[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const attr of attributes) {
    map.set(attr.slug, attr.id);
  }
  return map;
}

// --- Internal helpers ---

function getCardField(card: ScryfallCard, field: string): unknown {
  return (card as unknown as Record<string, unknown>)[field];
}

function buildAttributeInput(
  attrId: string,
  inputType: AttributeInputType,
  value: unknown
): Record<string, unknown> | null {
  switch (inputType) {
    case "PLAIN_TEXT":
      return {
        id: attrId,
        plainText: String(value),
      };

    case "DROPDOWN":
      return {
        id: attrId,
        dropdown: {
          value: String(value),
        },
      };

    case "NUMERIC":
      return {
        id: attrId,
        numeric: String(value),
      };

    case "BOOLEAN":
      return {
        id: attrId,
        boolean: Boolean(value),
      };

    case "MULTISELECT":
      if (Array.isArray(value)) {
        return {
          id: attrId,
          multiselect: value.map((v) => ({ value: String(v) })),
        };
      }
      return null;

    default:
      return null;
  }
}
