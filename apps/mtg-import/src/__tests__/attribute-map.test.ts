import { describe, expect, it } from "vitest";

import {
  ATTRIBUTE_DEFS,
  buildProductAttributes,
  buildAttributeIdMap,
  parseCardTypes,
  MTG_CARD_TYPES,
  MTG_SUPERTYPES,
} from "@/modules/import/attribute-map";
import type { ScryfallCard } from "@/modules/scryfall/types";
import type { SaleorAttribute } from "@/modules/saleor";

describe("ATTRIBUTE_DEFS", () => {
  it("has exactly 30 attributes", () => {
    expect(ATTRIBUTE_DEFS).toHaveLength(30);
  });

  it("all slugs are valid kebab-case identifiers", () => {
    for (const def of ATTRIBUTE_DEFS) {
      expect(def.slug).toMatch(/^[a-z][a-z0-9-]+$/);
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

    const reservedDef = ATTRIBUTE_DEFS.find((d) => d.slug === "reserved-list");
    expect(reservedDef?.inputType).toBe("BOOLEAN");

    const scryfallIdDef = ATTRIBUTE_DEFS.find((d) => d.slug === "mtg-scryfall-id");
    expect(scryfallIdDef?.inputType).toBe("PLAIN_TEXT");
  });

  it("has MULTISELECT type for array-valued fields", () => {
    const colorIdentity = ATTRIBUTE_DEFS.find((d) => d.slug === "mtg-color-identity");
    expect(colorIdentity?.inputType).toBe("MULTISELECT");

    const colors = ATTRIBUTE_DEFS.find((d) => d.slug === "mtg-colors");
    expect(colors?.inputType).toBe("MULTISELECT");

    const cardType = ATTRIBUTE_DEFS.find((d) => d.slug === "mtg-card-type");
    expect(cardType?.inputType).toBe("MULTISELECT");
    expect(cardType?.transform).toBeDefined();
  });

  it("has DROPDOWN type for new categorical fields", () => {
    const setType = ATTRIBUTE_DEFS.find((d) => d.slug === "mtg-set-type");
    expect(setType?.inputType).toBe("DROPDOWN");

    const frame = ATTRIBUTE_DEFS.find((d) => d.slug === "mtg-frame");
    expect(frame?.inputType).toBe("DROPDOWN");

    const borderColor = ATTRIBUTE_DEFS.find((d) => d.slug === "mtg-border-color");
    expect(borderColor?.inputType).toBe("DROPDOWN");
  });
});

describe("parseCardTypes", () => {
  it("extracts types from simple type line", () => {
    const card = { type_line: "Instant" } as ScryfallCard;
    expect(parseCardTypes(card)).toEqual(["Instant"]);
  });

  it("extracts types and supertypes from complex type line", () => {
    const card = { type_line: "Legendary Creature — Human Wizard" } as ScryfallCard;
    const result = parseCardTypes(card);
    expect(result).toContain("Legendary");
    expect(result).toContain("Creature");
    expect(result).not.toContain("Human");
    expect(result).not.toContain("Wizard");
  });

  it("handles multi-type cards", () => {
    const card = { type_line: "Artifact Creature — Golem" } as ScryfallCard;
    const result = parseCardTypes(card);
    expect(result).toContain("Artifact");
    expect(result).toContain("Creature");
    expect(result).toHaveLength(2);
  });

  it("handles enchantment creatures", () => {
    const card = { type_line: "Enchantment Creature — God" } as ScryfallCard;
    const result = parseCardTypes(card);
    expect(result).toContain("Enchantment");
    expect(result).toContain("Creature");
  });

  it("handles double-faced cards", () => {
    const card = { type_line: "Creature — Werewolf // Creature — Werewolf" } as ScryfallCard;
    const result = parseCardTypes(card);
    expect(result).toContain("Creature");
    expect(result).toHaveLength(1); // deduped
  });

  it("handles DFC with different types", () => {
    const card = { type_line: "Legendary Creature — Human // Legendary Planeswalker — Arlinn" } as ScryfallCard;
    const result = parseCardTypes(card);
    expect(result).toContain("Legendary");
    expect(result).toContain("Creature");
    expect(result).toContain("Planeswalker");
  });

  it("handles Snow types", () => {
    const card = { type_line: "Snow Land — Forest" } as ScryfallCard;
    const result = parseCardTypes(card);
    expect(result).toContain("Snow");
    expect(result).toContain("Land");
  });

  it("handles basic lands", () => {
    const card = { type_line: "Basic Land — Mountain" } as ScryfallCard;
    const result = parseCardTypes(card);
    expect(result).toContain("Basic");
    expect(result).toContain("Land");
  });

  it("returns empty array for empty type line", () => {
    const card = { type_line: "" } as ScryfallCard;
    expect(parseCardTypes(card)).toEqual([]);
  });

  it("returns empty array for undefined type line", () => {
    const card = {} as ScryfallCard;
    expect(parseCardTypes(card)).toEqual([]);
  });
});

describe("MTG type catalogs", () => {
  it("MTG_CARD_TYPES has 17 entries", () => {
    expect(MTG_CARD_TYPES.size).toBe(17);
  });

  it("MTG_SUPERTYPES has 7 entries", () => {
    expect(MTG_SUPERTYPES.size).toBe(7);
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
    { id: "a4", name: "Reserved List", slug: "reserved-list", inputType: "BOOLEAN" },
    { id: "a5", name: "Color Identity", slug: "mtg-color-identity", inputType: "MULTISELECT" },
    { id: "a6", name: "Colors", slug: "mtg-colors", inputType: "MULTISELECT" },
    { id: "a7", name: "Card Type", slug: "mtg-card-type", inputType: "MULTISELECT" },
    { id: "a8", name: "Set Type", slug: "mtg-set-type", inputType: "DROPDOWN" },
    { id: "a9", name: "Frame", slug: "mtg-frame", inputType: "DROPDOWN" },
    { id: "a10", name: "Border Color", slug: "mtg-border-color", inputType: "DROPDOWN" },
  ];
  const attrIdMap = buildAttributeIdMap(saleorAttrs);

  const card = {
    id: "test-uuid",
    rarity: "mythic",
    cmc: 5,
    reserved: true,
    color_identity: ["W", "U"],
    colors: ["W", "U"],
    type_line: "Legendary Creature — Human Wizard",
    set_type: "expansion",
    frame: "2015",
    border_color: "black",
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

  it("builds MULTISELECT attribute for color_identity", () => {
    const attrs = buildProductAttributes(card, attrIdMap);
    const colorIdentity = attrs.find((a) => a.id === "a5");
    expect(colorIdentity).toEqual({
      id: "a5",
      multiselect: [{ value: "W" }, { value: "U" }],
    });
  });

  it("builds MULTISELECT attribute for colors", () => {
    const attrs = buildProductAttributes(card, attrIdMap);
    const colors = attrs.find((a) => a.id === "a6");
    expect(colors).toEqual({
      id: "a6",
      multiselect: [{ value: "W" }, { value: "U" }],
    });
  });

  it("builds MULTISELECT for computed card type from type_line", () => {
    const attrs = buildProductAttributes(card, attrIdMap);
    const cardType = attrs.find((a) => a.id === "a7");
    expect(cardType).toEqual({
      id: "a7",
      multiselect: [{ value: "Legendary" }, { value: "Creature" }],
    });
  });

  it("builds DROPDOWN for set_type", () => {
    const attrs = buildProductAttributes(card, attrIdMap);
    const setType = attrs.find((a) => a.id === "a8");
    expect(setType).toEqual({ id: "a8", dropdown: { value: "expansion" } });
  });

  it("builds DROPDOWN for frame", () => {
    const attrs = buildProductAttributes(card, attrIdMap);
    const frame = attrs.find((a) => a.id === "a9");
    expect(frame).toEqual({ id: "a9", dropdown: { value: "2015" } });
  });

  it("builds DROPDOWN for border_color", () => {
    const attrs = buildProductAttributes(card, attrIdMap);
    const borderColor = attrs.find((a) => a.id === "a10");
    expect(borderColor).toEqual({ id: "a10", dropdown: { value: "black" } });
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

  it("skips empty color_identity array", () => {
    const colorlessCard = {
      id: "test",
      color_identity: [],
      colors: [],
      type_line: "Artifact",
    } as unknown as ScryfallCard;
    const attrs = buildProductAttributes(colorlessCard, attrIdMap);
    const ids = attrs.map((a) => a.id);
    expect(ids).not.toContain("a5"); // color identity (empty array)
    expect(ids).not.toContain("a6"); // colors (empty array)
  });

  it("handles colorless card with card type correctly", () => {
    const artifactCard = {
      id: "test",
      color_identity: [],
      colors: [],
      type_line: "Artifact — Equipment",
    } as unknown as ScryfallCard;
    const attrs = buildProductAttributes(artifactCard, attrIdMap);
    const cardType = attrs.find((a) => a.id === "a7");
    expect(cardType).toEqual({
      id: "a7",
      multiselect: [{ value: "Artifact" }],
    });
  });
});
