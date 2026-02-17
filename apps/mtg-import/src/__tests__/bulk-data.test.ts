import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { BulkDataManager, paperCardFilter, retailSetFilter, retailPaperFilter, IMPORTABLE_SET_TYPES } from "@/modules/scryfall/bulk-data";
import type { ScryfallCard } from "@/modules/scryfall/types";

// --- Card fixtures ---

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    object: "card",
    id: `card-${Math.random().toString(36).slice(2, 10)}`,
    oracle_id: "oracle-1",
    name: "Test Card",
    lang: "en",
    released_at: "2024-01-01",
    uri: "https://api.scryfall.com/cards/test",
    scryfall_uri: "https://scryfall.com/card/tst/1",
    layout: "normal",
    cmc: 2,
    type_line: "Creature — Test",
    color_identity: ["R"],
    keywords: [],
    reserved: false,
    set: "tst",
    set_name: "Test Set",
    set_type: "core",
    collector_number: "1",
    rarity: "common",
    finishes: ["nonfoil"],
    prices: { usd: "1.00", usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
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

describe("BulkDataManager — streaming", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mtg-bulk-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("streams cards from a JSON array file", async () => {
    const cards = [
      makeCard({ name: "Card A", set: "m11" }),
      makeCard({ name: "Card B", set: "m11" }),
      makeCard({ name: "Card C", set: "lea" }),
    ];
    const filePath = path.join(tempDir, "test-cards.json");
    await writeFile(filePath, JSON.stringify(cards));

    // Write metadata pointing to the file
    const metadata = {
      updatedAt: new Date().toISOString(),
      downloadedAt: new Date().toISOString(),
      filePath,
      sizeBytes: 1000,
      type: "default_cards",
    };
    await writeFile(path.join(tempDir, "bulk-metadata.json"), JSON.stringify(metadata));

    const mockClient = {
      getDefaultCardsBulkData: vi.fn(),
    };

    const manager = new BulkDataManager({
      client: mockClient as any,
      cacheDir: tempDir,
      cacheTtlMs: 999999999,
    });

    const result: ScryfallCard[] = [];
    for await (const card of manager.streamCards()) {
      result.push(card);
    }

    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("Card A");
    expect(result[2].name).toBe("Card C");
  });

  it("applies filter to stream", async () => {
    const cards = [
      makeCard({ name: "Paper Card", digital: false, games: ["paper"] }),
      makeCard({ name: "Digital Card", digital: true, games: ["arena"] }),
    ];
    const filePath = path.join(tempDir, "test-cards.json");
    await writeFile(filePath, JSON.stringify(cards));

    const metadata = {
      updatedAt: new Date().toISOString(),
      downloadedAt: new Date().toISOString(),
      filePath,
      sizeBytes: 1000,
      type: "default_cards",
    };
    await writeFile(path.join(tempDir, "bulk-metadata.json"), JSON.stringify(metadata));

    const manager = new BulkDataManager({
      client: { getDefaultCardsBulkData: vi.fn() } as any,
      cacheDir: tempDir,
      cacheTtlMs: 999999999,
    });

    const result: ScryfallCard[] = [];
    for await (const card of manager.streamCards((c) => !c.digital)) {
      result.push(card);
    }

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Paper Card");
  });

  it("streamSet filters by set code (case insensitive)", async () => {
    const cards = [
      makeCard({ name: "M11 Card", set: "m11" }),
      makeCard({ name: "LEA Card", set: "lea" }),
      makeCard({ name: "Another M11", set: "m11" }),
    ];
    const filePath = path.join(tempDir, "test-cards.json");
    await writeFile(filePath, JSON.stringify(cards));

    const metadata = {
      updatedAt: new Date().toISOString(),
      downloadedAt: new Date().toISOString(),
      filePath,
      sizeBytes: 1000,
      type: "default_cards",
    };
    await writeFile(path.join(tempDir, "bulk-metadata.json"), JSON.stringify(metadata));

    const manager = new BulkDataManager({
      client: { getDefaultCardsBulkData: vi.fn() } as any,
      cacheDir: tempDir,
      cacheTtlMs: 999999999,
    });

    const result: ScryfallCard[] = [];
    for await (const card of manager.streamSet("M11")) {
      result.push(card);
    }

    expect(result).toHaveLength(2);
    expect(result.every((c) => c.set === "m11")).toBe(true);
  });
});

describe("BulkDataManager — cache logic", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "mtg-cache-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("getCacheStatus returns cached=false when no metadata", async () => {
    const manager = new BulkDataManager({
      client: { getDefaultCardsBulkData: vi.fn() } as any,
      cacheDir: tempDir,
    });

    const status = await manager.getCacheStatus();
    expect(status.cached).toBe(false);
    expect(status.ageHours).toBeNull();
  });

  it("getCacheStatus returns correct data when cache exists", async () => {
    const filePath = path.join(tempDir, "test.json");
    await writeFile(filePath, "[]");

    const metadata = {
      updatedAt: "2024-01-01T00:00:00Z",
      downloadedAt: new Date().toISOString(),
      filePath,
      sizeBytes: 2,
      type: "default_cards",
    };
    await writeFile(path.join(tempDir, "bulk-metadata.json"), JSON.stringify(metadata));

    const manager = new BulkDataManager({
      client: { getDefaultCardsBulkData: vi.fn() } as any,
      cacheDir: tempDir,
    });

    const status = await manager.getCacheStatus();
    expect(status.cached).toBe(true);
    expect(status.sizeBytes).toBe(2);
    expect(status.ageHours).toBeDefined();
    expect(status.ageHours!).toBeGreaterThanOrEqual(0);
  });

  it("clearCache removes file and metadata", async () => {
    const filePath = path.join(tempDir, "test.json");
    await writeFile(filePath, "[]");

    const metadata = {
      updatedAt: "2024-01-01T00:00:00Z",
      downloadedAt: new Date().toISOString(),
      filePath,
      sizeBytes: 2,
      type: "default_cards",
    };
    await writeFile(path.join(tempDir, "bulk-metadata.json"), JSON.stringify(metadata));

    const manager = new BulkDataManager({
      client: { getDefaultCardsBulkData: vi.fn() } as any,
      cacheDir: tempDir,
    });

    await manager.clearCache();

    const status = await manager.getCacheStatus();
    expect(status.cached).toBe(false);
  });
});

describe("paperCardFilter", () => {
  it("accepts standard paper card", () => {
    expect(paperCardFilter(makeCard())).toBe(true);
  });

  it("rejects digital-only card", () => {
    expect(paperCardFilter(makeCard({ digital: true }))).toBe(false);
  });

  it("rejects oversized card", () => {
    expect(paperCardFilter(makeCard({ oversized: true }))).toBe(false);
  });

  it("rejects non-paper game card", () => {
    expect(paperCardFilter(makeCard({ games: ["mtgo"] }))).toBe(false);
  });

  it("rejects token layout", () => {
    expect(paperCardFilter(makeCard({ layout: "token" }))).toBe(false);
  });

  it("rejects emblem layout", () => {
    expect(paperCardFilter(makeCard({ layout: "emblem" }))).toBe(false);
  });

  it("rejects planar layout", () => {
    expect(paperCardFilter(makeCard({ layout: "planar" }))).toBe(false);
  });

  it("accepts transform layout", () => {
    expect(paperCardFilter(makeCard({ layout: "transform" }))).toBe(true);
  });

  it("accepts saga layout", () => {
    expect(paperCardFilter(makeCard({ layout: "saga" }))).toBe(true);
  });
});

describe("retailSetFilter", () => {
  it.each([
    "core",
    "expansion",
    "masters",
    "draft_innovation",
    "commander",
    "starter",
    "funny",
    "masterpiece",
    "treasure_chest",
  ])("accepts %s set type", (setType) => {
    expect(retailSetFilter(makeCard({ set_type: setType }))).toBe(true);
  });

  it.each([
    "token",
    "memorabilia",
    "promo",
    "alchemy",
    "spellbook",
    "from_the_vault",
    "premium_deck",
    "duel_deck",
    "box",
    "arsenal",
    "planechase",
    "archenemy",
    "vanguard",
    "minigame",
  ])("rejects %s set type", (setType) => {
    expect(retailSetFilter(makeCard({ set_type: setType }))).toBe(false);
  });
});

describe("retailPaperFilter", () => {
  it("accepts paper card from core set", () => {
    expect(retailPaperFilter(makeCard({ digital: false, games: ["paper"], set_type: "core" }))).toBe(true);
  });

  it("rejects digital card from core set", () => {
    expect(retailPaperFilter(makeCard({ digital: true, games: ["arena"], set_type: "core" }))).toBe(false);
  });

  it("rejects paper card from token set", () => {
    expect(retailPaperFilter(makeCard({ digital: false, games: ["paper"], set_type: "token" }))).toBe(false);
  });
});
