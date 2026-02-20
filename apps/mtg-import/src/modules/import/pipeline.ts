/**
 * Import pipeline: converts Scryfall cards → Saleor products with variants.
 *
 * For each card:
 *   1. Build product with 23 attributes + description + media
 *   2. Generate variants (5 conditions × N finishes) with SKUs
 *   3. Set channel listings with price_amount = discounted_price_amount (critical!)
 *   4. Batch into productBulkCreate calls (50 products per mutation)
 */

import { createLogger } from "@/lib/logger";
import type { ScryfallCard, ScryfallFinish, ConditionCode, FinishCode } from "../scryfall/types";
import { CONDITIONS, FINISH_MAP, getCardImageUri, generateSku } from "../scryfall/types";
import type { ImportContext, SaleorChannel } from "../saleor";
import { buildProductAttributes, buildAttributeIdMap } from "./attribute-map";

const logger = createLogger("ImportPipeline");

/** Condition multipliers for price calculation (NM = base, others discounted) */
const CONDITION_MULTIPLIERS: Record<ConditionCode, number> = {
  NM: 1.0,
  LP: 0.9,
  MP: 0.75,
  HP: 0.5,
  DMG: 0.25,
};

/** Map Scryfall finish to price key */
function getPriceKeyForFinish(finish: ScryfallFinish): "usd" | "usd_foil" | "usd_etched" {
  switch (finish) {
    case "foil": return "usd_foil";
    case "etched": return "usd_etched";
    case "nonfoil":
    default: return "usd";
  }
}

export interface PipelineOptions {
  /** Max products per GraphQL mutation batch (default: 50) */
  batchSize?: number;
  /** Default price when Scryfall has no price data (default: 0.25) */
  defaultPrice?: number;
}

/** A single product input ready for productBulkCreate */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProductInput = Record<string, any>;

/**
 * Convert a Scryfall card to a Saleor ProductBulkCreateInput.
 *
 * Creates product with:
 * - 23 MTG attributes
 * - EditorJS description (type line + oracle text)
 * - External image URL
 * - N variants (conditions × finishes) with channel listings
 * - price_amount AND discounted_price_amount both set (prevents NULL crash)
 */
export function cardToProductInput(
  card: ScryfallCard,
  context: ImportContext,
  attributeIdMap: Map<string, string>,
  options: PipelineOptions = {}
): ProductInput {
  const defaultPrice = options.defaultPrice ?? 0.25;
  const slug = makeProductSlug(card);

  // Product-level attributes (the 23 MTG attributes)
  const attributes = buildProductAttributes(card, attributeIdMap);

  // EditorJS description
  const description = buildDescription(card);

  // Media (card image)
  const media = buildMedia(card);

  // Channel listings at product level (visibility)
  const channelListings = context.channels.map((ch) => ({
    channelId: ch.id,
    isPublished: true,
    visibleInListings: true,
    isAvailableForPurchase: true,
  }));

  // Variants: conditions × finishes
  const variants = buildVariants(card, context, defaultPrice);

  return {
    name: card.name.substring(0, 250),
    slug,
    description: JSON.stringify(description),
    productType: context.productType.id,
    category: context.category.id,
    attributes,
    channelListings,
    media,
    variants,
    metadata: [
      { key: "scryfall_id", value: card.id },
      { key: "scryfall_uri", value: card.scryfall_uri },
      { key: "set_code", value: card.set },
    ],
  };
}

/**
 * Build all variant inputs for a card.
 * Each variant = 1 condition + 1 finish with proper SKU and pricing.
 */
function buildVariants(
  card: ScryfallCard,
  context: ImportContext,
  defaultPrice: number
): Array<Record<string, unknown>> {
  const variants: Array<Record<string, unknown>> = [];

  for (const scryfallFinish of card.finishes) {
    const finishCode = FINISH_MAP[scryfallFinish];
    const priceKey = getPriceKeyForFinish(scryfallFinish);
    const rawPrice = card.prices[priceKey];
    const basePrice = rawPrice ? parseFloat(rawPrice) : defaultPrice;

    for (const condition of CONDITIONS) {
      const multiplier = CONDITION_MULTIPLIERS[condition];
      const price = roundPrice(basePrice * multiplier);
      const sku = generateSku(card.id, condition, finishCode);
      const variantName = formatVariantName(condition, finishCode);

      variants.push({
        sku,
        name: variantName,
        trackInventory: false,
        attributes: [],
        channelListings: buildVariantChannelListings(context.channels, price),
        stocks: [{
          warehouse: context.warehouse.id,
          quantity: 0,
        }],
      });
    }
  }

  return variants;
}

/**
 * Build variant channel listings.
 * CRITICAL: Both price AND costPrice must be set.
 * Saleor uses `price` field which maps to both price_amount and discounted_price_amount.
 */
function buildVariantChannelListings(
  channels: SaleorChannel[],
  price: number
): Array<Record<string, unknown>> {
  return channels.map((ch) => ({
    channelId: ch.id,
    price: String(price),
    costPrice: String(roundPrice(price * 0.5)),
  }));
}

/** Create a unique slug for the product */
function makeProductSlug(card: ScryfallCard): string {
  const baseName = card.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 200);
  // Sanitize collector number (may contain ★ or other special chars)
  const safeCollector = card.collector_number
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  // Append set code + collector number for uniqueness across reprints
  const slug = `${baseName}-${card.set}-${safeCollector}`.substring(0, 255);
  // Final guard: if slug is empty or only hyphens, use scryfall ID prefix
  if (!slug || /^-+$/.test(slug)) {
    return `card-${card.id.substring(0, 36)}`;
  }
  return slug;
}

/** Build EditorJS description from card data */
function buildDescription(card: ScryfallCard): { blocks: Array<Record<string, unknown>> } {
  const blocks: Array<Record<string, unknown>> = [];

  if (card.type_line) {
    blocks.push({
      type: "paragraph",
      data: { text: card.type_line },
    });
  }

  if (card.oracle_text) {
    blocks.push({
      type: "paragraph",
      data: { text: card.oracle_text },
    });
  }

  if (card.flavor_text) {
    blocks.push({
      type: "paragraph",
      data: { text: `<i>${card.flavor_text}</i>` },
    });
  }

  return { blocks };
}

/** Build media input from card image */
function buildMedia(card: ScryfallCard): Array<Record<string, unknown>> {
  const imageUrl = getCardImageUri(card, "large");
  if (!imageUrl) return [];

  return [{
    mediaUrl: imageUrl,
    alt: card.name.substring(0, 250),
  }];
}

/** Format variant display name */
function formatVariantName(condition: ConditionCode, finish: FinishCode): string {
  const conditionNames: Record<ConditionCode, string> = {
    NM: "Near Mint",
    LP: "Lightly Played",
    MP: "Moderately Played",
    HP: "Heavily Played",
    DMG: "Damaged",
  };
  const finishNames: Record<FinishCode, string> = {
    NF: "Non-Foil",
    F: "Foil",
    E: "Etched",
  };
  return `${conditionNames[condition]} - ${finishNames[finish]}`;
}

/** Round to 2 decimal places */
function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Batch cards into groups for productBulkCreate calls.
 */
export function batchCards<T>(items: T[], batchSize: number = 50): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}
