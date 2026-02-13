import { describe, expect, it } from "vitest";

import {
  generateSku,
  generateVariantSkus,
  getCardImageUri,
  CONDITIONS,
  FINISH_MAP,
} from "@/modules/scryfall/types";
import type { ScryfallCard } from "@/modules/scryfall/types";

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
    small: "https://cards.scryfall.io/small/front/ff1b8fc5.jpg",
    normal: "https://cards.scryfall.io/normal/front/ff1b8fc5.jpg",
    large: "https://cards.scryfall.io/large/front/ff1b8fc5.jpg",
    png: "https://cards.scryfall.io/png/front/ff1b8fc5.png",
    art_crop: "https://cards.scryfall.io/art_crop/front/ff1b8fc5.jpg",
    border_crop: "https://cards.scryfall.io/border_crop/front/ff1b8fc5.jpg",
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
  legalities: { standard: "not_legal", modern: "legal", legacy: "legal" },
};

describe("generateSku", () => {
  it("generates correct SKU format with 8-char prefix", () => {
    const sku = generateSku("ff1b8fc5-1234-5678-9abc-def012345678", "NM", "NF");
    expect(sku).toBe("ff1b8fc5-NM-NF");
  });

  it("generates SKU for foil damaged condition", () => {
    const sku = generateSku("ff1b8fc5-1234-5678-9abc-def012345678", "DMG", "F");
    expect(sku).toBe("ff1b8fc5-DMG-F");
  });

  it("generates SKU for etched near mint", () => {
    const sku = generateSku("ff1b8fc5-1234-5678-9abc-def012345678", "NM", "E");
    expect(sku).toBe("ff1b8fc5-NM-E");
  });
});

describe("generateVariantSkus", () => {
  it("generates 10 variants for card with 2 finishes (nonfoil + foil)", () => {
    const variants = generateVariantSkus(mockCard);
    expect(variants).toHaveLength(10); // 5 conditions × 2 finishes
  });

  it("generates 5 variants for nonfoil-only card", () => {
    const nonfoilOnly = { ...mockCard, finishes: ["nonfoil" as const] };
    const variants = generateVariantSkus(nonfoilOnly);
    expect(variants).toHaveLength(5);
    expect(variants.every((v) => v.finish === "NF")).toBe(true);
  });

  it("generates 15 variants for card with all 3 finishes", () => {
    const allFinishes = { ...mockCard, finishes: ["nonfoil" as const, "foil" as const, "etched" as const] };
    const variants = generateVariantSkus(allFinishes);
    expect(variants).toHaveLength(15);
  });

  it("includes all 5 conditions for each finish", () => {
    const variants = generateVariantSkus(mockCard);
    const nfVariants = variants.filter((v) => v.finish === "NF");
    const conditions = nfVariants.map((v) => v.condition);
    expect(conditions).toEqual(CONDITIONS);
  });

  it("maps finishes correctly", () => {
    const variants = generateVariantSkus(mockCard);
    const finishes = new Set(variants.map((v) => v.scryfallFinish));
    expect(finishes).toEqual(new Set(["nonfoil", "foil"]));
  });
});

describe("getCardImageUri", () => {
  it("returns image_uris for normal layout cards", () => {
    expect(getCardImageUri(mockCard)).toBe(mockCard.image_uris!.normal);
  });

  it("returns large size when specified", () => {
    expect(getCardImageUri(mockCard, "large")).toBe(mockCard.image_uris!.large);
  });

  it("returns card_faces image for multi-faced cards", () => {
    const dfc: ScryfallCard = {
      ...mockCard,
      layout: "transform",
      image_uris: undefined,
      card_faces: [
        {
          object: "card_face",
          name: "Delver of Secrets",
          mana_cost: "{U}",
          type_line: "Creature — Human Wizard",
          image_uris: {
            small: "https://front.jpg",
            normal: "https://front-normal.jpg",
            large: "https://front-large.jpg",
            png: "https://front.png",
            art_crop: "https://front-art.jpg",
            border_crop: "https://front-border.jpg",
          },
        },
      ],
    };
    expect(getCardImageUri(dfc)).toBe("https://front-normal.jpg");
  });

  it("returns null when no images available", () => {
    const noImages = { ...mockCard, image_uris: undefined, card_faces: undefined };
    expect(getCardImageUri(noImages)).toBeNull();
  });
});

describe("FINISH_MAP", () => {
  it("maps all Scryfall finishes to codes", () => {
    expect(FINISH_MAP.nonfoil).toBe("NF");
    expect(FINISH_MAP.foil).toBe("F");
    expect(FINISH_MAP.etched).toBe("E");
  });
});
