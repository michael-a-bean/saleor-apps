import { describe, expect, it, vi, beforeEach } from "vitest";

import { JobProcessor, type ProcessorConfig } from "@/modules/import/job-processor";
import type { ImportJob } from "@prisma/client";
import type { ScryfallCard } from "@/modules/scryfall/types";

// --- Mock card factory ---

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
    image_uris: {
      small: "https://img/s.jpg",
      normal: "https://img/n.jpg",
      large: "https://img/l.jpg",
      png: "https://img/c.png",
      art_crop: "https://img/a.jpg",
      border_crop: "https://img/b.jpg",
    },
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

function makeJob(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: "job-1",
    installationId: "inst-1",
    type: "SET",
    status: "PENDING",
    priority: 2,
    setCode: "tst",
    cardsProcessed: 0,
    cardsTotal: 0,
    variantsCreated: 0,
    errors: 0,
    lastCheckpoint: null,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    errorLog: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ImportJob;
}

// --- Mock Saleor context ---

const mockContext = {
  channels: [{ id: "ch-1", name: "Webstore", slug: "webstore", currencyCode: "USD" }],
  productType: {
    id: "pt-1",
    name: "MTG Card",
    slug: "mtg-card",
    productAttributes: [
      { id: "a1", name: "Scryfall ID", slug: "mtg-scryfall-id", inputType: "PLAIN_TEXT" },
      { id: "a2", name: "Rarity", slug: "mtg-rarity", inputType: "DROPDOWN" },
    ],
    variantAttributes: [],
  },
  category: { id: "cat-1", name: "MTG Singles", slug: "mtg-singles" },
  warehouse: { id: "wh-1", name: "Warehouse", slug: "main" },
};

function makeBulkCreateResult(count: number) {
  return {
    count,
    results: Array.from({ length: count }, (_, i) => ({
      product: {
        id: `prod-${i}`,
        name: `Product ${i}`,
        slug: `product-${i}`,
        variants: [
          { id: `var-${i}-0`, sku: `sku-${i}-NM-NF`, name: "Near Mint - Non-Foil" },
        ],
      },
      errors: [],
    })),
    errors: [],
  };
}

function makeBulkCreateResultWithErrors(successCount: number, errorCount: number) {
  const results = [];
  for (let i = 0; i < successCount; i++) {
    results.push({
      product: {
        id: `prod-${i}`,
        name: `Product ${i}`,
        slug: `product-${i}`,
        variants: [{ id: `var-${i}`, sku: `sku-${i}`, name: "NM - NF" }],
      },
      errors: [],
    });
  }
  for (let i = 0; i < errorCount; i++) {
    results.push({
      product: null,
      errors: [{ message: "Invalid product data", code: "INVALID", path: "name" }],
    });
  }
  return { count: successCount, results, errors: [] };
}

function makeBulkCreateResultWithDuplicates(successCount: number, duplicateCount: number) {
  const results = [];
  for (let i = 0; i < successCount; i++) {
    results.push({
      product: {
        id: `prod-${i}`,
        name: `Product ${i}`,
        slug: `product-${i}`,
        variants: [{ id: `var-${i}`, sku: `sku-${i}`, name: "NM - NF" }],
      },
      errors: [],
    });
  }
  for (let i = 0; i < duplicateCount; i++) {
    results.push({
      product: null,
      errors: [{ message: "Product with this Slug already exists.", code: "UNIQUE", path: "slug" }],
    });
  }
  return { count: successCount, results, errors: [] };
}

// --- Mock setup ---

function createMocks(cards: ScryfallCard[] = []) {
  const mockPrisma = {
    importJob: {
      update: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn(),
    },
    importedProduct: {
      create: vi.fn().mockResolvedValue({}),
    },
  };

  const mockGqlClient = {};

  // Create mock SaleorImportClient directly (injected via saleorImportClient config)
  const mockResolveImportContext = vi.fn().mockResolvedValue(mockContext);
  const mockBulkCreateProducts = vi.fn().mockResolvedValue(makeBulkCreateResult(cards.length));

  const mockSaleorImportClient = {
    resolveImportContext: mockResolveImportContext,
    bulkCreateProducts: mockBulkCreateProducts,
  };

  // Create async generator from card array
  async function* cardGenerator() {
    for (const card of cards) {
      yield card;
    }
  }

  const mockBulkData = {
    streamSet: vi.fn().mockReturnValue(cardGenerator()),
    streamCards: vi.fn().mockReturnValue(cardGenerator()),
  };

  const mockScryfallClient = {};

  return {
    prisma: mockPrisma,
    gqlClient: mockGqlClient,
    bulkData: mockBulkData,
    scryfallClient: mockScryfallClient,
    saleorImportClient: mockSaleorImportClient,
    resolveImportContext: mockResolveImportContext,
    bulkCreateProducts: mockBulkCreateProducts,
  };
}

describe("JobProcessor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("processJob — lifecycle", () => {
    it("marks job as RUNNING with startedAt", async () => {
      const cards = [makeCard()];
      const mocks = createMocks(cards);
      mocks.bulkCreateProducts.mockResolvedValue(makeBulkCreateResult(1));

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      await processor.processJob(makeJob());

      // First call should mark as RUNNING
      const firstUpdate = mocks.prisma.importJob.update.mock.calls[0][0];
      expect(firstUpdate.data.status).toBe("RUNNING");
      expect(firstUpdate.data.startedAt).toBeInstanceOf(Date);
    });

    it("marks job as COMPLETED on success", async () => {
      const cards = [makeCard()];
      const mocks = createMocks(cards);
      mocks.bulkCreateProducts.mockResolvedValue(makeBulkCreateResult(1));

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      await processor.processJob(makeJob());

      // Last call should mark as COMPLETED
      const lastCall = mocks.prisma.importJob.update.mock.calls.at(-1)![0];
      expect(lastCall.data.status).toBe("COMPLETED");
      expect(lastCall.data.completedAt).toBeInstanceOf(Date);
    });

    it("marks job as FAILED when all cards error", async () => {
      const cards = [makeCard()];
      const mocks = createMocks(cards);
      mocks.bulkCreateProducts.mockResolvedValue(makeBulkCreateResultWithErrors(0, 1));

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      await processor.processJob(makeJob());

      const lastCall = mocks.prisma.importJob.update.mock.calls.at(-1)![0];
      expect(lastCall.data.status).toBe("FAILED");
    });

    it("marks COMPLETED (not FAILED) for partial success", async () => {
      const cards = [makeCard(), makeCard()];
      const mocks = createMocks(cards);
      mocks.bulkCreateProducts.mockResolvedValue(makeBulkCreateResultWithErrors(1, 1));

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      await processor.processJob(makeJob());

      const lastCall = mocks.prisma.importJob.update.mock.calls.at(-1)![0];
      expect(lastCall.data.status).toBe("COMPLETED");
      expect(lastCall.data.cardsProcessed).toBe(1);
      expect(lastCall.data.errors).toBe(1);
    });
  });

  describe("processJob — card stream routing", () => {
    it("uses streamSet for SET job type", async () => {
      const mocks = createMocks([]);

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      await processor.processJob(makeJob({ type: "SET" as any, setCode: "m11" }));

      expect(mocks.bulkData.streamSet).toHaveBeenCalledWith("m11");
      expect(mocks.bulkData.streamCards).not.toHaveBeenCalled();
    });

    it("uses streamCards for BULK job type", async () => {
      const mocks = createMocks([]);

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      await processor.processJob(makeJob({ type: "BULK" as any, setCode: null }));

      expect(mocks.bulkData.streamCards).toHaveBeenCalled();
      expect(mocks.bulkData.streamSet).not.toHaveBeenCalled();
    });
  });

  describe("processJob — progress tracking", () => {
    it("records ImportedProduct for each successful card", async () => {
      const cards = [makeCard({ name: "Card A" }), makeCard({ name: "Card B" })];
      const mocks = createMocks(cards);
      mocks.bulkCreateProducts.mockResolvedValue(makeBulkCreateResult(2));

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      await processor.processJob(makeJob());

      expect(mocks.prisma.importedProduct.create).toHaveBeenCalledTimes(2);
      const firstCall = mocks.prisma.importedProduct.create.mock.calls[0][0];
      expect(firstCall.data.success).toBe(true);
      expect(firstCall.data.importJobId).toBe("job-1");
    });

    it("records ImportedProduct with error for failed cards", async () => {
      const cards = [makeCard({ name: "Bad Card" })];
      const mocks = createMocks(cards);
      mocks.bulkCreateProducts.mockResolvedValue(makeBulkCreateResultWithErrors(0, 1));

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      await processor.processJob(makeJob());

      const call = mocks.prisma.importedProduct.create.mock.calls[0][0];
      expect(call.data.success).toBe(false);
      expect(call.data.errorMessage).toContain("Invalid product data");
    });

    it("returns correct process result counts", async () => {
      const cards = [makeCard(), makeCard(), makeCard()];
      const mocks = createMocks(cards);
      mocks.bulkCreateProducts.mockResolvedValue(makeBulkCreateResultWithErrors(2, 1));

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      const result = await processor.processJob(makeJob());

      expect(result.cardsProcessed).toBe(2);
      expect(result.errors).toBe(1);
    });
  });

  describe("processJob — resume from checkpoint", () => {
    it("skips cards up to checkpoint offset", async () => {
      const cards = [
        makeCard({ name: "Already Imported 1" }),
        makeCard({ name: "Already Imported 2" }),
        makeCard({ name: "New Card" }),
      ];
      const mocks = createMocks(cards);
      mocks.bulkCreateProducts.mockResolvedValue(makeBulkCreateResult(1));

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      const result = await processor.processJob(makeJob({ lastCheckpoint: "2" }));

      // Should only process the 3rd card (index 2)
      expect(result.cardsProcessed).toBe(1);
    });
  });

  describe("processJob — error handling", () => {
    it("handles thrown exception gracefully and marks FAILED", async () => {
      const mocks = createMocks([]);
      mocks.resolveImportContext.mockRejectedValue(new Error("Connection refused"));

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      const result = await processor.processJob(makeJob());

      const lastCall = mocks.prisma.importJob.update.mock.calls.at(-1)![0];
      expect(lastCall.data.status).toBe("FAILED");
      expect(lastCall.data.errorMessage).toContain("Connection refused");
    });

    it("handles batch-level errors without crashing the whole job", async () => {
      const cards = [makeCard()];
      const mocks = createMocks(cards);
      mocks.bulkCreateProducts.mockRejectedValue(new Error("GraphQL timeout"));

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      const result = await processor.processJob(makeJob());

      // Job should complete (not throw), but with errors
      expect(result.errors).toBe(1);
      expect(result.errorLog[0]).toContain("Batch error");
    });
  });

  describe("processJob — filters digital cards", () => {
    it("skips digital-only cards", async () => {
      const cards = [
        makeCard({ digital: true, games: ["arena"], set_type: "core" }),
        makeCard({ digital: false, games: ["paper"], set_type: "core" }),
      ];
      const mocks = createMocks(cards);
      mocks.bulkCreateProducts.mockResolvedValue(makeBulkCreateResult(1));

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      const result = await processor.processJob(makeJob());

      // Only 1 card should be processed (the paper one)
      expect(result.cardsProcessed).toBe(1);
    });
  });

  describe("processJob — idempotent retry (duplicate handling)", () => {
    it("treats slug duplicate errors as skipped, not failures", async () => {
      const cards = [makeCard({ name: "Existing Card" })];
      const mocks = createMocks(cards);
      mocks.bulkCreateProducts.mockResolvedValue(makeBulkCreateResultWithDuplicates(0, 1));

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      const result = await processor.processJob(makeJob());

      expect(result.cardsProcessed).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.errors).toBe(0);
      expect(result.errorLog).toHaveLength(0);
    });

    it("marks job as COMPLETED when all cards are duplicates", async () => {
      const cards = [makeCard(), makeCard(), makeCard()];
      const mocks = createMocks(cards);
      mocks.bulkCreateProducts.mockResolvedValue(makeBulkCreateResultWithDuplicates(0, 3));

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      await processor.processJob(makeJob());

      const lastCall = mocks.prisma.importJob.update.mock.calls.at(-1)![0];
      expect(lastCall.data.status).toBe("COMPLETED");
      expect(lastCall.data.cardsProcessed).toBe(3);
    });

    it("records ImportedProduct with success=true for duplicates", async () => {
      const cards = [makeCard({ name: "Duplicate Card" })];
      const mocks = createMocks(cards);
      mocks.bulkCreateProducts.mockResolvedValue(makeBulkCreateResultWithDuplicates(0, 1));

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      await processor.processJob(makeJob());

      const call = mocks.prisma.importedProduct.create.mock.calls[0][0];
      expect(call.data.success).toBe(true);
      expect(call.data.saleorProductId).toBe("existing");
      expect(call.data.errorMessage).toContain("Already exists");
    });

    it("handles mixed batch: new products + duplicates + real errors", async () => {
      const cards = [makeCard({ name: "New" }), makeCard({ name: "Existing" }), makeCard({ name: "Bad" })];
      const mocks = createMocks(cards);
      mocks.bulkCreateProducts.mockResolvedValue({
        count: 1,
        results: [
          {
            product: { id: "prod-0", name: "New", slug: "new", variants: [{ id: "v-0", sku: "sku-0", name: "NM" }] },
            errors: [],
          },
          {
            product: null,
            errors: [{ message: "Product with this Slug already exists.", code: "UNIQUE", path: "slug" }],
          },
          {
            product: null,
            errors: [{ message: "Invalid attribute value", code: "INVALID", path: "attributes" }],
          },
        ],
        errors: [],
      });

      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      const result = await processor.processJob(makeJob());

      expect(result.cardsProcessed).toBe(2); // new + duplicate
      expect(result.skipped).toBe(1);        // duplicate only
      expect(result.errors).toBe(1);          // real error only
      expect(result.variantsCreated).toBe(1); // only the new product
      expect(result.errorLog).toHaveLength(1);
      expect(result.errorLog[0]).toContain("Invalid attribute value");
    });
  });

  describe("cancel", () => {
    it("sets abort signal", () => {
      const mocks = createMocks([]);
      const processor = new JobProcessor({
        scryfallClient: mocks.scryfallClient as any,
        bulkDataManager: mocks.bulkData as any,
        prisma: mocks.prisma as any,
        gqlClient: mocks.gqlClient as any,
        saleorImportClient: mocks.saleorImportClient as any,
      });

      // cancel before processJob should not throw
      processor.cancel();
    });
  });
});
