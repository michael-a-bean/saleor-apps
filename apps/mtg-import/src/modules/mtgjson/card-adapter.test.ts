/**
 * MTGJSON Card Adapter Tests
 *
 * Comprehensive tests for the MTGJSON-to-ScryfallCard adapter.
 * Covers: all 23 attribute mappings, image URI construction,
 * edge cases (DFCs, split cards, Art Series, missing fields),
 * and finish/price mapping.
 */
import { describe, expect, it } from "vitest";
import { adaptMtgjsonCard, adaptMtgjsonSet, buildScryfallImageUri } from "./card-adapter";
import type { MtgjsonCard, MtgjsonSet } from "./card-adapter";
import type { ScryfallCard } from "../scryfall/types";

// --- Fixtures ---

/** A complete MTGJSON card with all fields populated */
function makeFullCard(overrides: Partial<MtgjsonCard> = {}): MtgjsonCard {
  return {
    uuid: "mtgjson-uuid-001",
    name: "Lightning Bolt",
    type: "Instant",
    manaCost: "{R}",
    manaValue: 1,
    text: "Lightning Bolt deals 3 damage to any target.",
    power: undefined,
    toughness: undefined,
    loyalty: undefined,
    number: "149",
    rarity: "common",
    artist: "Christopher Rush",
    layout: "normal",
    setCode: "M11",
    flavorText: "The spark mage shrieked, calling on the rage of the storm.",
    colors: ["R"],
    colorIdentity: ["R"],
    keywords: [],
    isReserved: false,
    isReprint: true,
    isPromo: false,
    isFullArt: false,
    isOnlineOnly: false,
    finishTypes: ["nonfoil", "foil"],
    identifiers: {
      scryfallId: "b04dd037-4bfd-40a7-bd9a-53d9d7eb484c",
      scryfallOracleId: "oracle-id-bolt",
      tcgplayerProductId: "36975",
      tcgplayerEtchedProductId: undefined,
      cardmarketId: "12345",
      mtgoId: "67890",
      mtgArenaId: "11111",
    },
    prices: {
      paper: {
        tcgplayer: {
          retail: {
            normal: { "2026-02-17": 1.5, "2026-02-16": 1.48 },
            foil: { "2026-02-17": 5.0 },
          },
        },
      },
    },
    ...overrides,
  };
}

/** A MTGJSON set for context */
function makeSet(overrides: Partial<MtgjsonSet> = {}): MtgjsonSet {
  return {
    code: "M11",
    name: "Magic 2011",
    releaseDate: "2010-07-16",
    type: "core",
    ...overrides,
  };
}

describe("adaptMtgjsonCard", () => {
  const set = makeSet();

  // --- Identity fields ---

  describe("identity mappings", () => {
    it("maps scryfallId to id", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.id).toBe("b04dd037-4bfd-40a7-bd9a-53d9d7eb484c");
    });

    it("maps scryfallOracleId to oracle_id", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.oracle_id).toBe("oracle-id-bolt");
    });

    it("maps name directly", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.name).toBe("Lightning Bolt");
    });

    it("maps layout directly", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.layout).toBe("normal");
    });

    it("sets object to 'card'", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.object).toBe("card");
    });

    it("sets lang to 'en'", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.lang).toBe("en");
    });
  });

  // --- External IDs ---

  describe("external ID mappings", () => {
    it("maps tcgplayerProductId to tcgplayer_id as number", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.tcgplayer_id).toBe(36975);
    });

    it("maps tcgplayerEtchedProductId to tcgplayer_etched_id as number", () => {
      const card = makeFullCard({
        identifiers: {
          ...makeFullCard().identifiers,
          tcgplayerEtchedProductId: "99999",
        },
      });
      const result = adaptMtgjsonCard(card, set);

      expect(result.tcgplayer_etched_id).toBe(99999);
    });

    it("maps cardmarketId to cardmarket_id as number", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.cardmarket_id).toBe(12345);
    });

    it("maps mtgoId to mtgo_id as number", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.mtgo_id).toBe(67890);
    });

    it("maps mtgArenaId to arena_id as number", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.arena_id).toBe(11111);
    });

    it("leaves optional numeric IDs undefined when not present", () => {
      const card = makeFullCard({
        identifiers: {
          scryfallId: "some-id",
          scryfallOracleId: "some-oracle",
          tcgplayerProductId: undefined,
          tcgplayerEtchedProductId: undefined,
          cardmarketId: undefined,
          mtgoId: undefined,
          mtgArenaId: undefined,
        },
      });
      const result = adaptMtgjsonCard(card, set);

      expect(result.tcgplayer_id).toBeUndefined();
      expect(result.tcgplayer_etched_id).toBeUndefined();
      expect(result.cardmarket_id).toBeUndefined();
      expect(result.mtgo_id).toBeUndefined();
      expect(result.arena_id).toBeUndefined();
    });
  });

  // --- Card property mappings ---

  describe("card property mappings", () => {
    it("maps rarity directly", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.rarity).toBe("common");
    });

    it("maps type to type_line", () => {
      const card = makeFullCard({ type: "Legendary Creature - Human Wizard" });
      const result = adaptMtgjsonCard(card, set);

      expect(result.type_line).toBe("Legendary Creature - Human Wizard");
    });

    it("maps manaCost to mana_cost", () => {
      const card = makeFullCard({ manaCost: "{2}{W}{U}" });
      const result = adaptMtgjsonCard(card, set);

      expect(result.mana_cost).toBe("{2}{W}{U}");
    });

    it("maps manaValue to cmc", () => {
      const card = makeFullCard({ manaValue: 4 });
      const result = adaptMtgjsonCard(card, set);

      expect(result.cmc).toBe(4);
    });

    it("maps setCode to set (lowercase)", () => {
      const card = makeFullCard({ setCode: "M11" });
      const result = adaptMtgjsonCard(card, set);

      expect(result.set).toBe("m11");
    });

    it("maps set name from the set context", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.set_name).toBe("Magic 2011");
    });

    it("maps set type from the set context", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.set_type).toBe("core");
    });

    it("maps artist directly", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.artist).toBe("Christopher Rush");
    });

    it("maps number to collector_number", () => {
      const card = makeFullCard({ number: "149" });
      const result = adaptMtgjsonCard(card, set);

      expect(result.collector_number).toBe("149");
    });

    it("maps power when present", () => {
      const card = makeFullCard({ power: "3" });
      const result = adaptMtgjsonCard(card, set);

      expect(result.power).toBe("3");
    });

    it("maps toughness when present", () => {
      const card = makeFullCard({ toughness: "3" });
      const result = adaptMtgjsonCard(card, set);

      expect(result.toughness).toBe("3");
    });

    it("maps loyalty when present", () => {
      const card = makeFullCard({ loyalty: "4" });
      const result = adaptMtgjsonCard(card, set);

      expect(result.loyalty).toBe("4");
    });

    it("maps text to oracle_text", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.oracle_text).toBe(
        "Lightning Bolt deals 3 damage to any target."
      );
    });

    it("maps flavorText to flavor_text", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.flavor_text).toBe(
        "The spark mage shrieked, calling on the rage of the storm."
      );
    });
  });

  // --- Boolean flags ---

  describe("boolean flag mappings", () => {
    it("maps isReserved to reserved", () => {
      const card = makeFullCard({ isReserved: true });
      const result = adaptMtgjsonCard(card, set);

      expect(result.reserved).toBe(true);
    });

    it("maps isReprint to reprint", () => {
      const card = makeFullCard({ isReprint: true });
      const result = adaptMtgjsonCard(card, set);

      expect(result.reprint).toBe(true);
    });

    it("maps isPromo to promo", () => {
      const card = makeFullCard({ isPromo: true });
      const result = adaptMtgjsonCard(card, set);

      expect(result.promo).toBe(true);
    });

    it("maps isFullArt to full_art", () => {
      const card = makeFullCard({ isFullArt: true });
      const result = adaptMtgjsonCard(card, set);

      expect(result.full_art).toBe(true);
    });

    it("maps isOnlineOnly to digital", () => {
      const card = makeFullCard({ isOnlineOnly: true });
      const result = adaptMtgjsonCard(card, set);

      expect(result.digital).toBe(true);
    });

    it("defaults booleans to false when not provided", () => {
      const card = makeFullCard({
        isReserved: false,
        isReprint: false,
        isPromo: false,
        isFullArt: false,
        isOnlineOnly: false,
      });
      const result = adaptMtgjsonCard(card, set);

      expect(result.reserved).toBe(false);
      expect(result.reprint).toBe(false);
      expect(result.promo).toBe(false);
      expect(result.full_art).toBe(false);
      expect(result.digital).toBe(false);
    });
  });

  // --- Finishes ---

  describe("finish mappings", () => {
    it("maps nonfoil and foil finishTypes", () => {
      const card = makeFullCard({ finishTypes: ["nonfoil", "foil"] });
      const result = adaptMtgjsonCard(card, set);

      expect(result.finishes).toEqual(["nonfoil", "foil"]);
    });

    it("maps etched finishType", () => {
      const card = makeFullCard({ finishTypes: ["nonfoil", "etched"] });
      const result = adaptMtgjsonCard(card, set);

      expect(result.finishes).toEqual(["nonfoil", "etched"]);
    });

    it("maps single finish", () => {
      const card = makeFullCard({ finishTypes: ["nonfoil"] });
      const result = adaptMtgjsonCard(card, set);

      expect(result.finishes).toEqual(["nonfoil"]);
    });

    it("defaults to nonfoil when finishTypes is empty", () => {
      const card = makeFullCard({ finishTypes: [] });
      const result = adaptMtgjsonCard(card, set);

      expect(result.finishes).toEqual(["nonfoil"]);
    });
  });

  // --- Pricing ---

  describe("price mappings", () => {
    it("extracts latest TCGPlayer retail normal price as usd", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.prices.usd).toBe("1.50");
    });

    it("extracts latest TCGPlayer retail foil price as usd_foil", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.prices.usd_foil).toBe("5.00");
    });

    it("sets usd_etched when etched prices exist", () => {
      const card = makeFullCard({
        prices: {
          paper: {
            tcgplayer: {
              retail: {
                normal: { "2026-02-17": 10.0 },
                etched: { "2026-02-17": 20.0 },
              },
            },
          },
        },
      });
      const result = adaptMtgjsonCard(card, set);

      expect(result.prices.usd_etched).toBe("20.00");
    });

    it("returns null prices when no pricing data", () => {
      const card = makeFullCard({ prices: {} as any });
      const result = adaptMtgjsonCard(card, set);

      expect(result.prices.usd).toBeNull();
      expect(result.prices.usd_foil).toBeNull();
      expect(result.prices.usd_etched).toBeNull();
    });

    it("returns null for eur and tix (not available from MTGJSON TCGPlayer)", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.prices.eur).toBeNull();
      expect(result.prices.eur_foil).toBeNull();
      expect(result.prices.tix).toBeNull();
    });
  });

  // --- Image URIs ---

  describe("image URI construction", () => {
    it("constructs Scryfall CDN image URL from scryfallId", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.image_uris).toBeDefined();
      // ID: b04dd037-4bfd-40a7-bd9a-53d9d7eb484c
      // First char: b, second char: 0
      expect(result.image_uris!.normal).toBe(
        "https://cards.scryfall.io/normal/front/b/0/b04dd037-4bfd-40a7-bd9a-53d9d7eb484c.jpg"
      );
      expect(result.image_uris!.small).toBe(
        "https://cards.scryfall.io/small/front/b/0/b04dd037-4bfd-40a7-bd9a-53d9d7eb484c.jpg"
      );
      expect(result.image_uris!.large).toBe(
        "https://cards.scryfall.io/large/front/b/0/b04dd037-4bfd-40a7-bd9a-53d9d7eb484c.jpg"
      );
      expect(result.image_uris!.png).toBe(
        "https://cards.scryfall.io/png/front/b/0/b04dd037-4bfd-40a7-bd9a-53d9d7eb484c.png"
      );
      expect(result.image_uris!.art_crop).toBe(
        "https://cards.scryfall.io/art_crop/front/b/0/b04dd037-4bfd-40a7-bd9a-53d9d7eb484c.jpg"
      );
      expect(result.image_uris!.border_crop).toBe(
        "https://cards.scryfall.io/border_crop/front/b/0/b04dd037-4bfd-40a7-bd9a-53d9d7eb484c.jpg"
      );
    });
  });

  // --- buildScryfallImageUri utility ---

  describe("buildScryfallImageUri", () => {
    it("constructs correct URL for normal size", () => {
      const url = buildScryfallImageUri(
        "b04dd037-4bfd-40a7-bd9a-53d9d7eb484c",
        "normal"
      );
      expect(url).toBe(
        "https://cards.scryfall.io/normal/front/b/0/b04dd037-4bfd-40a7-bd9a-53d9d7eb484c.jpg"
      );
    });

    it("uses .png extension for png size", () => {
      const url = buildScryfallImageUri(
        "b04dd037-4bfd-40a7-bd9a-53d9d7eb484c",
        "png"
      );
      expect(url).toBe(
        "https://cards.scryfall.io/png/front/b/0/b04dd037-4bfd-40a7-bd9a-53d9d7eb484c.png"
      );
    });

    it("handles IDs starting with numbers", () => {
      const url = buildScryfallImageUri(
        "12345678-abcd-efgh-ijkl-mnopqrstuvwx",
        "normal"
      );
      expect(url).toBe(
        "https://cards.scryfall.io/normal/front/1/2/12345678-abcd-efgh-ijkl-mnopqrstuvwx.jpg"
      );
    });
  });

  // --- Edge cases ---

  describe("edge cases", () => {
    it("handles double-faced card (DFC) layout", () => {
      const card = makeFullCard({
        layout: "modal_dfc",
        name: "Agadeem's Awakening // Agadeem, the Undercrypt",
        type: "Sorcery // Land",
        manaCost: "{X}{B}{B}{B}",
      });
      const result = adaptMtgjsonCard(card, set);

      expect(result.layout).toBe("modal_dfc");
      expect(result.name).toBe(
        "Agadeem's Awakening // Agadeem, the Undercrypt"
      );
      expect(result.type_line).toBe("Sorcery // Land");
    });

    it("handles split card layout", () => {
      const card = makeFullCard({
        layout: "split",
        name: "Fire // Ice",
        type: "Instant // Instant",
        manaCost: "{1}{R} // {1}{U}",
      });
      const result = adaptMtgjsonCard(card, set);

      expect(result.layout).toBe("split");
      expect(result.name).toBe("Fire // Ice");
    });

    it("handles Art Series layout", () => {
      const card = makeFullCard({
        layout: "art_series",
        name: "Forest",
        isFullArt: true,
      });
      const result = adaptMtgjsonCard(card, set);

      expect(result.layout).toBe("art_series");
      expect(result.full_art).toBe(true);
    });

    it("handles missing optional fields gracefully", () => {
      const card = makeFullCard({
        manaCost: undefined,
        text: undefined,
        flavorText: undefined,
        power: undefined,
        toughness: undefined,
        loyalty: undefined,
        artist: undefined,
        colors: undefined,
        keywords: undefined,
      });
      const result = adaptMtgjsonCard(card, set);

      expect(result.mana_cost).toBeUndefined();
      expect(result.oracle_text).toBeUndefined();
      expect(result.flavor_text).toBeUndefined();
      expect(result.power).toBeUndefined();
      expect(result.toughness).toBeUndefined();
      expect(result.loyalty).toBeUndefined();
      expect(result.artist).toBeUndefined();
    });

    it("handles creature with power/toughness", () => {
      const card = makeFullCard({
        name: "Tarmogoyf",
        type: "Creature - Lhurgoyf",
        power: "*",
        toughness: "1+*",
        manaCost: "{1}{G}",
        manaValue: 2,
      });
      const result = adaptMtgjsonCard(card, set);

      expect(result.power).toBe("*");
      expect(result.toughness).toBe("1+*");
    });

    it("handles planeswalker with loyalty", () => {
      const card = makeFullCard({
        name: "Jace, the Mind Sculptor",
        type: "Legendary Planeswalker - Jace",
        loyalty: "3",
        manaCost: "{2}{U}{U}",
        manaValue: 4,
        power: undefined,
        toughness: undefined,
      });
      const result = adaptMtgjsonCard(card, set);

      expect(result.loyalty).toBe("3");
      expect(result.power).toBeUndefined();
      expect(result.toughness).toBeUndefined();
    });

    it("handles card with zero mana value", () => {
      const card = makeFullCard({
        name: "Mox Pearl",
        manaCost: "{0}",
        manaValue: 0,
      });
      const result = adaptMtgjsonCard(card, set);

      expect(result.cmc).toBe(0);
    });

    it("handles land with no mana cost", () => {
      const card = makeFullCard({
        name: "Forest",
        type: "Basic Land - Forest",
        manaCost: undefined,
        manaValue: 0,
      });
      const result = adaptMtgjsonCard(card, set);

      expect(result.mana_cost).toBeUndefined();
      expect(result.cmc).toBe(0);
    });
  });

  // --- Scryfall URI construction ---

  describe("URI construction", () => {
    it("constructs scryfall_uri from set code and collector number", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.scryfall_uri).toContain("scryfall.com");
      expect(result.scryfall_uri).toContain("m11");
      expect(result.scryfall_uri).toContain("149");
    });

    it("constructs uri from scryfallId", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.uri).toContain("api.scryfall.com");
      expect(result.uri).toContain(card.identifiers.scryfallId);
    });
  });

  // --- released_at from set ---

  describe("released_at mapping", () => {
    it("uses set releaseDate for released_at", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.released_at).toBe("2010-07-16");
    });

    it("uses empty string when set has no release date", () => {
      const card = makeFullCard();
      const noDateSet = makeSet({ releaseDate: undefined });
      const result = adaptMtgjsonCard(card, noDateSet);

      expect(result.released_at).toBe("");
    });
  });

  // --- Default/required fields ---

  describe("required field defaults", () => {
    it("provides empty legalities object", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.legalities).toEqual({});
    });

    it("provides empty color_identity array from card data", () => {
      const card = makeFullCard({ colorIdentity: ["R"] });
      const result = adaptMtgjsonCard(card, set);

      expect(result.color_identity).toEqual(["R"]);
    });

    it("provides empty keywords array by default", () => {
      const card = makeFullCard({ keywords: [] });
      const result = adaptMtgjsonCard(card, set);

      expect(result.keywords).toEqual([]);
    });

    it("sets image_status to lowres", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.image_status).toBe("lowres");
    });

    it("sets oversized to false", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.oversized).toBe(false);
    });

    it("sets booster to true by default", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.booster).toBe(true);
    });

    it("sets border_color to black by default", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.border_color).toBe("black");
    });

    it("sets frame to 2015 by default", () => {
      const card = makeFullCard();
      const result = adaptMtgjsonCard(card, set);

      expect(result.frame).toBe("2015");
    });

    it("includes paper in games array", () => {
      const card = makeFullCard({ isOnlineOnly: false });
      const result = adaptMtgjsonCard(card, set);

      expect(result.games).toContain("paper");
    });

    it("includes only mtgo/arena for online-only cards", () => {
      const card = makeFullCard({ isOnlineOnly: true });
      const result = adaptMtgjsonCard(card, set);

      expect(result.games).not.toContain("paper");
      expect(result.digital).toBe(true);
    });
  });
});

// --- adaptMtgjsonSet ---

describe("adaptMtgjsonSet", () => {
  it("converts all cards in a set", () => {
    const set: MtgjsonSet = {
      code: "M11",
      name: "Magic 2011",
      releaseDate: "2010-07-16",
      type: "core",
    };

    const cards: MtgjsonCard[] = [
      makeFullCard({ name: "Lightning Bolt", number: "149" }),
      makeFullCard({
        name: "Fireball",
        number: "137",
        identifiers: {
          ...makeFullCard().identifiers,
          scryfallId: "fireball-scryfall-id",
        },
      }),
    ];

    const results = adaptMtgjsonSet(set, cards);

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("Lightning Bolt");
    expect(results[1].name).toBe("Fireball");
    expect(results[0].set_name).toBe("Magic 2011");
    expect(results[1].set_name).toBe("Magic 2011");
  });

  it("filters out cards with no scryfallId", () => {
    const set: MtgjsonSet = {
      code: "M11",
      name: "Magic 2011",
      releaseDate: "2010-07-16",
      type: "core",
    };

    const cards: MtgjsonCard[] = [
      makeFullCard({ name: "Has ID" }),
      makeFullCard({
        name: "No ID",
        identifiers: {
          ...makeFullCard().identifiers,
          scryfallId: "",
        },
      }),
    ];

    const results = adaptMtgjsonSet(set, cards);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Has ID");
  });
});
