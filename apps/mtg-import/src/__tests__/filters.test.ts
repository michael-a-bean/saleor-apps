import { describe, expect, it } from "vitest";

import { paperCardFilter, retailSetFilter, retailPaperFilter, IMPORTABLE_SET_TYPES } from "@/modules/scryfall/bulk-data";
import type { ScryfallCard } from "@/modules/scryfall/types";

/**
 * Dedicated edge-case filter tests.
 * The main filter test coverage is in bulk-data.test.ts.
 * This file focuses on combinations and boundary conditions.
 */

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    object: "card",
    id: "test-id",
    oracle_id: "oracle-1",
    name: "Test Card",
    lang: "en",
    released_at: "2024-01-01",
    uri: "https://api.scryfall.com/cards/test",
    scryfall_uri: "https://scryfall.com/card/tst/1",
    layout: "normal",
    cmc: 2,
    type_line: "Creature",
    color_identity: [],
    keywords: [],
    reserved: false,
    set: "tst",
    set_name: "Test Set",
    set_type: "core",
    collector_number: "1",
    rarity: "common",
    finishes: ["nonfoil"],
    prices: { usd: null, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
    image_status: "highres_scan",
    reprint: false,
    digital: false,
    full_art: false,
    oversized: false,
    promo: false,
    booster: true,
    games: ["paper"],
    border_color: "black",
    frame: "2015",
    legalities: {},
    ...overrides,
  };
}

describe("filter combinations", () => {
  it("paper card from memorabilia set: passes paper, fails retail", () => {
    const card = makeCard({ set_type: "memorabilia", games: ["paper"], digital: false });
    expect(paperCardFilter(card)).toBe(true);
    expect(retailSetFilter(card)).toBe(false);
    expect(retailPaperFilter(card)).toBe(false);
  });

  it("digital card from core set: fails paper, passes retail set", () => {
    const card = makeCard({ set_type: "core", digital: true, games: ["arena"] });
    expect(paperCardFilter(card)).toBe(false);
    expect(retailSetFilter(card)).toBe(true);
    expect(retailPaperFilter(card)).toBe(false);
  });

  it("oversized paper card from expansion: fails paper, passes retail set", () => {
    const card = makeCard({ set_type: "expansion", oversized: true, games: ["paper"] });
    expect(paperCardFilter(card)).toBe(false);
    expect(retailSetFilter(card)).toBe(true);
    expect(retailPaperFilter(card)).toBe(false);
  });

  it("paper + mtgo card passes paper filter", () => {
    const card = makeCard({ games: ["paper", "mtgo"] });
    expect(paperCardFilter(card)).toBe(true);
  });

  it("card with only mtgo game fails paper filter", () => {
    const card = makeCard({ games: ["mtgo"] });
    expect(paperCardFilter(card)).toBe(false);
  });
});

describe("IMPORTABLE_SET_TYPES constant", () => {
  it("contains exactly 9 set types", () => {
    expect(IMPORTABLE_SET_TYPES.size).toBe(9);
  });

  it("includes all expected types", () => {
    const expected = ["core", "expansion", "masters", "draft_innovation", "commander", "starter", "treasure_chest", "funny", "masterpiece"];
    for (const type of expected) {
      expect(IMPORTABLE_SET_TYPES.has(type)).toBe(true);
    }
  });
});

describe("special layout handling", () => {
  it.each([
    ["normal", true],
    ["split", true],
    ["flip", true],
    ["transform", true],
    ["modal_dfc", true],
    ["meld", true],
    ["adventure", true],
    ["saga", true],
    ["class", true],
    ["token", false],
    ["emblem", false],
    ["planar", false],
    ["double_faced_token", true], // not explicitly excluded
    ["art_series", true], // not explicitly excluded
  ] as const)("layout '%s' paper filter result: %s", (layout, expected) => {
    const card = makeCard({ layout: layout as any });
    expect(paperCardFilter(card)).toBe(expected);
  });
});
