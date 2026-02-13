import { describe, expect, it } from "vitest";

import {
  ATTRIBUTE_DEFS,
  buildProductAttributes,
  buildAttributeIdMap,
} from "@/modules/import/attribute-map";
import type { ScryfallCard } from "@/modules/scryfall/types";
import type { SaleorAttribute } from "@/modules/saleor";

describe("ATTRIBUTE_DEFS", () => {
  it("has exactly 23 attributes", () => {
    expect(ATTRIBUTE_DEFS).toHaveLength(23);
  });

  it("all slugs start with mtg-", () => {
    for (const def of ATTRIBUTE_DEFS) {
      expect(def.slug).toMatch(/^mtg-/);
    }
  });

  it("all slugs are unique", () => {
    const slugs = ATTRIBUTE_DEFS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has correct input types for known fields", () => {
    const rarityDef = ATTRIBUTE_DEFS.find((d) => d.slug === "mtg-rarity");
    expect(rarityDef?.inputType).toBe("DROPDOWN");

    const cmcDef = ATTRIBUTE_DEFS.find((d) => d.slug === "mtg-mana-value");
    expect(cmcDef?.inputType).toBe("NUMERIC");

    const reservedDef = ATTRIBUTE_DEFS.find((d) => d.slug === "mtg-reserved");
    expect(reservedDef?.inputType).toBe("BOOLEAN");

    const scryfallIdDef = ATTRIBUTE_DEFS.find((d) => d.slug === "mtg-scryfall-id");
    expect(scryfallIdDef?.inputType).toBe("PLAIN_TEXT");
  });
});

describe("buildAttributeIdMap", () => {
  it("creates map from slug to ID", () => {
    const attributes: SaleorAttribute[] = [
      { id: "a1", name: "Test", slug: "mtg-test", inputType: "PLAIN_TEXT" },
      { id: "a2", name: "Test2", slug: "mtg-test2", inputType: "DROPDOWN" },
    ];
    const map = buildAttributeIdMap(attributes);
    expect(map.get("mtg-test")).toBe("a1");
    expect(map.get("mtg-test2")).toBe("a2");
  });
});

describe("buildProductAttributes", () => {
  const saleorAttrs: SaleorAttribute[] = [
    { id: "a1", name: "Scryfall ID", slug: "mtg-scryfall-id", inputType: "PLAIN_TEXT" },
    { id: "a2", name: "Rarity", slug: "mtg-rarity", inputType: "DROPDOWN" },
    { id: "a3", name: "Mana Value", slug: "mtg-mana-value", inputType: "NUMERIC" },
    { id: "a4", name: "Reserved List", slug: "mtg-reserved", inputType: "BOOLEAN" },
  ];
  const attrIdMap = buildAttributeIdMap(saleorAttrs);

  const card = {
    id: "test-uuid",
    rarity: "mythic",
    cmc: 5,
    reserved: true,
  } as unknown as ScryfallCard;

  it("builds PLAIN_TEXT attribute correctly", () => {
    const attrs = buildProductAttributes(card, attrIdMap);
    const scryfallId = attrs.find((a) => a.id === "a1");
    expect(scryfallId).toEqual({ id: "a1", plainText: "test-uuid" });
  });

  it("builds DROPDOWN attribute correctly", () => {
    const attrs = buildProductAttributes(card, attrIdMap);
    const rarity = attrs.find((a) => a.id === "a2");
    expect(rarity).toEqual({ id: "a2", dropdown: { value: "mythic" } });
  });

  it("builds NUMERIC attribute correctly", () => {
    const attrs = buildProductAttributes(card, attrIdMap);
    const cmc = attrs.find((a) => a.id === "a3");
    expect(cmc).toEqual({ id: "a3", numeric: "5" });
  });

  it("builds BOOLEAN attribute correctly", () => {
    const attrs = buildProductAttributes(card, attrIdMap);
    const reserved = attrs.find((a) => a.id === "a4");
    expect(reserved).toEqual({ id: "a4", boolean: true });
  });

  it("skips attributes not in the Saleor product type", () => {
    const limitedMap = new Map([["mtg-scryfall-id", "a1"]]);
    const attrs = buildProductAttributes(card, limitedMap);
    expect(attrs).toHaveLength(1);
  });

  it("skips empty/null values", () => {
    const sparseCard = { id: "test", rarity: "", cmc: undefined } as unknown as ScryfallCard;
    const attrs = buildProductAttributes(sparseCard, attrIdMap);
    // Only id should be present (rarity empty, cmc undefined, reserved undefined)
    const ids = attrs.map((a) => a.id);
    expect(ids).toContain("a1"); // scryfall ID
    expect(ids).not.toContain("a2"); // rarity (empty)
  });
});
