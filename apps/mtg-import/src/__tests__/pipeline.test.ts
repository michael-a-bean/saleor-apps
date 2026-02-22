import { describe, expect, it } from "vitest";

import { cardToProductInput, batchCards } from "@/modules/import/pipeline";
import { buildAttributeIdMap } from "@/modules/import/attribute-map";
import type { ScryfallCard } from "@/modules/scryfall/types";
import type { ImportContext, SaleorAttribute } from "@/modules/saleor";

const mockCard: ScryfallCard = {
  object: "card",
  id: "ff1b8fc5-1234-5678-9abc-def012345678",
  oracle_id: "oracle-1234",
  name: "Lightning Bolt",
  lang: "en",
  released_at: "2024-01-01",
  uri: "https://api.scryfall.com/cards/ff1b8fc5",
  scryfall_uri: "https://scryfall.com/card/m11/149",
  layout: "normal",
  cmc: 1,
  type_line: "Instant",
  oracle_text: "Lightning Bolt deals 3 damage to any target.",
  colors: ["R"],
  color_identity: ["R"],
  keywords: [],
  reserved: false,
  set: "m11",
  set_name: "Magic 2011",
  set_type: "core",
  collector_number: "149",
  rarity: "common",
  finishes: ["nonfoil", "foil"],
  prices: {
    usd: "1.50",
    usd_foil: "5.00",
    usd_etched: null,
    eur: null,
    eur_foil: null,
    tix: null,
  },
  image_uris: {
    small: "https://img/small.jpg",
    normal: "https://img/normal.jpg",
    large: "https://img/large.jpg",
    png: "https://img/card.png",
    art_crop: "https://img/art.jpg",
    border_crop: "https://img/border.jpg",
  },
  image_status: "highres_scan",
  reprint: true,
  digital: false,
  full_art: false,
  oversized: false,
  promo: false,
  booster: true,
  games: ["paper", "mtgo"],
  border_color: "black",
  frame: "2015",
  legalities: {},
  mana_cost: "{R}",
  artist: "Christopher Moeller",
  flavor_text: "The sparkmage shrieked...",
};

const mockAttributes: SaleorAttribute[] = [
  { id: "attr-1", name: "Scryfall ID", slug: "mtg-scryfall-id", inputType: "PLAIN_TEXT" },
  { id: "attr-2", name: "Rarity", slug: "mtg-rarity", inputType: "DROPDOWN" },
  { id: "attr-3", name: "Mana Value", slug: "mtg-mana-value", inputType: "NUMERIC" },
  { id: "attr-4", name: "Reserved List", slug: "reserved-list", inputType: "BOOLEAN" },
  { id: "attr-5", name: "Set Code", slug: "mtg-set-code", inputType: "PLAIN_TEXT" },
];

const mockContext: ImportContext = {
  channels: [
    { id: "ch-web", name: "Webstore", slug: "webstore", currencyCode: "USD" },
    { id: "ch-singles", name: "Singles Builder", slug: "singles-builder", currencyCode: "USD" },
  ],
  productType: {
    id: "pt-1",
    name: "MTG Card",
    slug: "mtg-card",
    productAttributes: mockAttributes,
    variantAttributes: [],
  },
  category: { id: "cat-1", name: "MTG Singles", slug: "mtg-singles" },
  warehouse: { id: "wh-1", name: "Main Warehouse", slug: "main-warehouse" },
  warehouses: [{ id: "wh-1", name: "Main Warehouse", slug: "main-warehouse" }],
};

describe("cardToProductInput", () => {
  const attrIdMap = buildAttributeIdMap(mockAttributes);

  it("creates product with correct name and slug", () => {
    const input = cardToProductInput(mockCard, mockContext, attrIdMap);
    expect(input.name).toBe("Lightning Bolt");
    expect(input.slug).toBe("lightning-bolt-m11-149");
  });

  it("sets product type and category", () => {
    const input = cardToProductInput(mockCard, mockContext, attrIdMap);
    expect(input.productType).toBe("pt-1");
    expect(input.category).toBe("cat-1");
  });

  it("creates channel listings for all channels", () => {
    const input = cardToProductInput(mockCard, mockContext, attrIdMap);
    expect(input.channelListings).toHaveLength(2);
    expect(input.channelListings[0].channelId).toBe("ch-web");
    expect(input.channelListings[1].channelId).toBe("ch-singles");
    expect(input.channelListings[0].isPublished).toBe(true);
  });

  it("generates correct number of variants (5 conditions x 2 finishes = 10)", () => {
    const input = cardToProductInput(mockCard, mockContext, attrIdMap);
    expect(input.variants).toHaveLength(10);
  });

  it("sets correct NM non-foil price from Scryfall USD", () => {
    const input = cardToProductInput(mockCard, mockContext, attrIdMap);
    const nmNf = input.variants.find((v: Record<string, unknown>) => v.sku === "ff1b8fc5-NM-NF");
    expect(nmNf).toBeDefined();
    // NM = 1.0 multiplier × $1.50 = $1.50
    expect(nmNf.channelListings[0].price).toBe("1.5");
  });

  it("applies condition multiplier for LP", () => {
    const input = cardToProductInput(mockCard, mockContext, attrIdMap);
    const lpNf = input.variants.find((v: Record<string, unknown>) => v.sku === "ff1b8fc5-LP-NF");
    expect(lpNf).toBeDefined();
    // LP = 0.9 multiplier × $1.50 = $1.35
    expect(lpNf.channelListings[0].price).toBe("1.35");
  });

  it("applies condition multiplier for DMG", () => {
    const input = cardToProductInput(mockCard, mockContext, attrIdMap);
    const dmgNf = input.variants.find((v: Record<string, unknown>) => v.sku === "ff1b8fc5-DMG-NF");
    expect(dmgNf).toBeDefined();
    // DMG = 0.25 multiplier × $1.50 = $0.38
    expect(dmgNf.channelListings[0].price).toBe("0.38");
  });

  it("uses foil price for foil variants", () => {
    const input = cardToProductInput(mockCard, mockContext, attrIdMap);
    const nmF = input.variants.find((v: Record<string, unknown>) => v.sku === "ff1b8fc5-NM-F");
    expect(nmF).toBeDefined();
    // NM = 1.0 × $5.00 foil = $5.00
    expect(nmF.channelListings[0].price).toBe("5");
  });

  it("sets variant channel listings for all channels", () => {
    const input = cardToProductInput(mockCard, mockContext, attrIdMap);
    for (const variant of input.variants) {
      expect(variant.channelListings).toHaveLength(2);
      // price must never be null/undefined
      for (const listing of variant.channelListings) {
        expect(listing.price).toBeDefined();
        expect(parseFloat(listing.price as string)).toBeGreaterThan(0);
      }
    }
  });

  it("uses default price when Scryfall has no price data", () => {
    const noPriceCard = {
      ...mockCard,
      prices: { usd: null, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
    };
    const input = cardToProductInput(noPriceCard, mockContext, attrIdMap, { defaultPrice: 0.25 });
    const nmNf = input.variants.find((v: Record<string, unknown>) => v.sku === "ff1b8fc5-NM-NF");
    expect(nmNf.channelListings[0].price).toBe("0.25");
  });

  it("sets costPrice on variant channel listings", () => {
    const input = cardToProductInput(mockCard, mockContext, attrIdMap);
    const nmNf = input.variants.find((v: Record<string, unknown>) => v.sku === "ff1b8fc5-NM-NF");
    // costPrice = price * 0.5
    expect(nmNf.channelListings[0].costPrice).toBe("0.75");
  });

  it("includes product attributes", () => {
    const input = cardToProductInput(mockCard, mockContext, attrIdMap);
    expect(input.attributes.length).toBeGreaterThan(0);

    // Check specific attribute types
    const scryfallIdAttr = input.attributes.find((a: Record<string, unknown>) => a.id === "attr-1");
    expect(scryfallIdAttr).toBeDefined();
    expect(scryfallIdAttr.plainText).toBe(mockCard.id);

    const rarityAttr = input.attributes.find((a: Record<string, unknown>) => a.id === "attr-2");
    expect(rarityAttr).toBeDefined();
    expect(rarityAttr.dropdown).toEqual({ value: "common" });

    const cmcAttr = input.attributes.find((a: Record<string, unknown>) => a.id === "attr-3");
    expect(cmcAttr).toBeDefined();
    expect(cmcAttr.numeric).toBe("1");

    const reservedAttr = input.attributes.find((a: Record<string, unknown>) => a.id === "attr-4");
    expect(reservedAttr).toBeDefined();
    expect(reservedAttr.boolean).toBe(false);
  });

  it("includes EditorJS description with type_line and oracle_text", () => {
    const input = cardToProductInput(mockCard, mockContext, attrIdMap);
    const desc = JSON.parse(input.description);
    expect(desc.blocks).toHaveLength(3); // type_line + oracle_text + flavor_text
    expect(desc.blocks[0].data.text).toBe("Instant");
    expect(desc.blocks[1].data.text).toContain("3 damage");
  });

  it("includes image media", () => {
    const input = cardToProductInput(mockCard, mockContext, attrIdMap);
    expect(input.media).toHaveLength(1);
    expect(input.media[0].mediaUrl).toBe("https://img/large.jpg");
    expect(input.media[0].alt).toBe("Lightning Bolt");
  });

  it("includes metadata with scryfall_id", () => {
    const input = cardToProductInput(mockCard, mockContext, attrIdMap);
    const scryfallMeta = input.metadata.find((m: Record<string, string>) => m.key === "scryfall_id");
    expect(scryfallMeta?.value).toBe(mockCard.id);
  });

  it("sets trackInventory to false on all variants", () => {
    const input = cardToProductInput(mockCard, mockContext, attrIdMap);
    for (const variant of input.variants) {
      expect(variant.trackInventory).toBe(false);
    }
  });

  it("sets initial stock to 0 for warehouse", () => {
    const input = cardToProductInput(mockCard, mockContext, attrIdMap);
    for (const variant of input.variants) {
      expect(variant.stocks).toHaveLength(1);
      expect(variant.stocks[0].warehouse).toBe("wh-1");
      expect(variant.stocks[0].quantity).toBe(0);
    }
  });
});

describe("batchCards", () => {
  it("splits array into batches of correct size", () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    const batches = batchCards(items, 50);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(50);
    expect(batches[1]).toHaveLength(50);
    expect(batches[2]).toHaveLength(20);
  });

  it("returns single batch for small arrays", () => {
    const batches = batchCards([1, 2, 3], 50);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([1, 2, 3]);
  });

  it("handles empty array", () => {
    const batches = batchCards([], 50);
    expect(batches).toHaveLength(0);
  });
});
