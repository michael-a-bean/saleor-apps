/**
 * MTG attribute mapping from Scryfall card fields to Saleor product attributes.
 *
 * 23 attributes matching the legacy import script's ATTRIBUTE_DEFS.
 * Attributes must be pre-created on the "mtg-card" product type in Saleor Dashboard.
 */

import type { ScryfallCard } from "../scryfall/types";
import type { SaleorAttribute } from "../saleor/graphql-operations";

export type AttributeInputType = "PLAIN_TEXT" | "DROPDOWN" | "NUMERIC" | "BOOLEAN";

export interface AttributeDef {
  /** Scryfall card field name */
  scryfallField: keyof ScryfallCard | string;
  /** Human-readable name */
  name: string;
  /** Saleor attribute slug (must match what's in the product type) */
  slug: string;
  /** Saleor attribute input type */
  inputType: AttributeInputType;
}

/**
 * The 23 MTG card attributes, matching legacy import_command.py ATTRIBUTE_DEFS.
 * Order: external IDs → card properties → boolean flags
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
  // Boolean flags
  { scryfallField: "reserved", name: "Reserved List", slug: "reserved-list", inputType: "BOOLEAN" },
  { scryfallField: "reprint", name: "Is Reprint", slug: "is-reprint", inputType: "BOOLEAN" },
  { scryfallField: "promo", name: "Is Promo", slug: "is-promo", inputType: "BOOLEAN" },
  { scryfallField: "full_art", name: "Is Full Art", slug: "is-full-art", inputType: "BOOLEAN" },
  { scryfallField: "digital", name: "Is Digital Only", slug: "is-digital-only", inputType: "BOOLEAN" },
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

    const rawValue = getCardField(card, def.scryfallField);
    if (rawValue === null || rawValue === undefined || rawValue === "") continue;

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

    default:
      return null;
  }
}
