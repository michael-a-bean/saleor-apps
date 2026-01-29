import { ScryfallCard, ScryfallFinish, getCardFinishes, getPriceForFinish } from "@/modules/scryfall";

/**
 * Saleor product input structure
 */
export interface SaleorProductInput {
  name: string;
  slug: string;
  description: string;
  productType: string;  // Product type ID
  category?: string;    // Category ID (optional)
  externalReference: string;  // Scryfall ID

  // Attributes (attribute ID -> value)
  attributes: Array<{
    id: string;
    values: string[];
  }>;
}

/**
 * Saleor variant input structure
 */
export interface SaleorVariantInput {
  sku: string;
  name: string;
  externalReference: string;  // Scryfall ID + finish

  // Attributes (attribute ID -> value)
  attributes: Array<{
    id: string;
    values: string[];
  }>;

  // Channel listings
  channelListings: Array<{
    channelId: string;
    price: number;
    costPrice?: number;
  }>;

  // Stock (warehouse ID -> quantity)
  stocks: Array<{
    warehouseId: string;
    quantity: number;
  }>;
}

/**
 * Transform result with product and variants
 */
export interface TransformResult {
  product: SaleorProductInput;
  variants: SaleorVariantInput[];
}

/**
 * Configuration for transform
 */
export interface TransformConfig {
  productTypeId: string;
  categoryId?: string;

  // Attribute IDs
  attributeIds: {
    setCode?: string;
    setName?: string;
    collectorNumber?: string;
    rarity?: string;
    colors?: string;
    colorIdentity?: string;
    manaCost?: string;
    cmc?: string;
    typeLine?: string;
    oracleText?: string;
    power?: string;
    toughness?: string;
    loyalty?: string;
    keywords?: string;
    artist?: string;
    finish?: string;  // For variant-level
    tcgplayerId?: string;
    scryfallId?: string;
  };

  // Channel IDs for listings
  channelIds: string[];

  // Default warehouse ID for stock
  warehouseId?: string;

  // Default stock quantity for new products
  defaultStock?: number;
}

/**
 * Generate a URL-safe slug from card name and set
 */
function generateSlug(card: ScryfallCard): string {
  const base = `${card.name}-${card.set}-${card.collector_number}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  // Ensure unique by appending Scryfall ID prefix
  return `${base}-${card.id.slice(0, 8)}`;
}

/**
 * Generate SKU for a variant
 * Format: SET-COLLNUM-FINISH (e.g., NEO-001-FOIL)
 */
function generateSku(card: ScryfallCard, finish: ScryfallFinish): string {
  const finishSuffix = finish === "nonfoil" ? "NF" : finish === "foil" ? "F" : "E";
  return `${card.set.toUpperCase()}-${card.collector_number.padStart(3, "0")}-${finishSuffix}`;
}

/**
 * Format description from card data
 */
function formatDescription(card: ScryfallCard): string {
  const parts: string[] = [];

  parts.push(`**${card.name}**`);
  parts.push(`*${card.type_line}*`);

  if (card.mana_cost) {
    parts.push(`Mana Cost: ${card.mana_cost}`);
  }

  if (card.oracle_text) {
    parts.push("");
    parts.push(card.oracle_text);
  }

  if (card.power && card.toughness) {
    parts.push("");
    parts.push(`Power/Toughness: ${card.power}/${card.toughness}`);
  }

  if (card.loyalty) {
    parts.push("");
    parts.push(`Loyalty: ${card.loyalty}`);
  }

  parts.push("");
  parts.push(`Set: ${card.set_name} (${card.set.toUpperCase()})`);
  parts.push(`Collector Number: ${card.collector_number}`);
  parts.push(`Rarity: ${card.rarity}`);

  if (card.artist) {
    parts.push(`Artist: ${card.artist}`);
  }

  return parts.join("\n");
}

/**
 * Build product attributes array
 */
function buildProductAttributes(
  card: ScryfallCard,
  config: TransformConfig
): Array<{ id: string; values: string[] }> {
  const attrs: Array<{ id: string; values: string[] }> = [];

  const { attributeIds } = config;

  if (attributeIds.setCode) {
    attrs.push({ id: attributeIds.setCode, values: [card.set] });
  }

  if (attributeIds.setName) {
    attrs.push({ id: attributeIds.setName, values: [card.set_name] });
  }

  if (attributeIds.collectorNumber) {
    attrs.push({ id: attributeIds.collectorNumber, values: [card.collector_number] });
  }

  if (attributeIds.rarity) {
    attrs.push({ id: attributeIds.rarity, values: [card.rarity] });
  }

  if (attributeIds.colors && card.colors && card.colors.length > 0) {
    attrs.push({ id: attributeIds.colors, values: card.colors });
  }

  if (attributeIds.colorIdentity && card.color_identity.length > 0) {
    attrs.push({ id: attributeIds.colorIdentity, values: card.color_identity });
  }

  if (attributeIds.manaCost && card.mana_cost) {
    attrs.push({ id: attributeIds.manaCost, values: [card.mana_cost] });
  }

  if (attributeIds.cmc) {
    attrs.push({ id: attributeIds.cmc, values: [card.cmc.toString()] });
  }

  if (attributeIds.typeLine) {
    attrs.push({ id: attributeIds.typeLine, values: [card.type_line] });
  }

  if (attributeIds.oracleText && card.oracle_text) {
    attrs.push({ id: attributeIds.oracleText, values: [card.oracle_text] });
  }

  if (attributeIds.power && card.power) {
    attrs.push({ id: attributeIds.power, values: [card.power] });
  }

  if (attributeIds.toughness && card.toughness) {
    attrs.push({ id: attributeIds.toughness, values: [card.toughness] });
  }

  if (attributeIds.loyalty && card.loyalty) {
    attrs.push({ id: attributeIds.loyalty, values: [card.loyalty] });
  }

  if (attributeIds.keywords && card.keywords.length > 0) {
    attrs.push({ id: attributeIds.keywords, values: card.keywords });
  }

  if (attributeIds.artist && card.artist) {
    attrs.push({ id: attributeIds.artist, values: [card.artist] });
  }

  if (attributeIds.tcgplayerId && card.tcgplayer_id) {
    attrs.push({ id: attributeIds.tcgplayerId, values: [card.tcgplayer_id.toString()] });
  }

  if (attributeIds.scryfallId) {
    attrs.push({ id: attributeIds.scryfallId, values: [card.id] });
  }

  return attrs;
}

/**
 * Build variant for a specific finish
 */
function buildVariant(
  card: ScryfallCard,
  finish: ScryfallFinish,
  config: TransformConfig
): SaleorVariantInput {
  const sku = generateSku(card, finish);
  const price = getPriceForFinish(card, finish);

  // Default price if Scryfall doesn't have one
  const finalPrice = price ?? 0.25;

  // Variant attributes
  const attrs: Array<{ id: string; values: string[] }> = [];

  if (config.attributeIds.finish) {
    attrs.push({ id: config.attributeIds.finish, values: [finish] });
  }

  // Channel listings
  const channelListings = config.channelIds.map((channelId) => ({
    channelId,
    price: finalPrice,
    // No cost price initially - will be set by purchase orders
  }));

  // Stock
  const stocks: Array<{ warehouseId: string; quantity: number }> = [];
  if (config.warehouseId) {
    stocks.push({
      warehouseId: config.warehouseId,
      quantity: config.defaultStock ?? 0,
    });
  }

  const finishLabel = finish === "nonfoil" ? "Non-Foil" : finish === "foil" ? "Foil" : "Etched";

  return {
    sku,
    name: `${card.name} (${finishLabel})`,
    externalReference: `${card.id}:${finish}`,
    attributes: attrs,
    channelListings,
    stocks,
  };
}

/**
 * Transform a Scryfall card to Saleor product + variants
 */
export function transformCard(card: ScryfallCard, config: TransformConfig): TransformResult {
  const product: SaleorProductInput = {
    name: card.name,
    slug: generateSlug(card),
    description: formatDescription(card),
    productType: config.productTypeId,
    category: config.categoryId,
    externalReference: card.id,
    attributes: buildProductAttributes(card, config),
  };

  // Create a variant for each available finish
  const finishes = getCardFinishes(card);
  const variants = finishes.map((finish) => buildVariant(card, finish, config));

  return { product, variants };
}

/**
 * Transform multiple cards
 */
export function transformCards(
  cards: ScryfallCard[],
  config: TransformConfig
): TransformResult[] {
  return cards.map((card) => transformCard(card, config));
}
