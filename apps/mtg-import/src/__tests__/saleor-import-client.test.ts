import { describe, expect, it, vi, beforeEach } from "vitest";

import { SaleorImportClient } from "@/modules/saleor/saleor-import-client";

// --- Mock urql Client factory ---

function createMockUrqlClient(overrides: {
  queryResponses?: Record<string, any>;
  mutationResponse?: any;
} = {}) {
  const queryResponses = overrides.queryResponses ?? {};
  const mutationResponse = overrides.mutationResponse ?? { data: null };

  return {
    query: vi.fn().mockImplementation((query: any, variables: any) => ({
      toPromise: vi.fn().mockResolvedValue(
        queryResponses[query?.definitions?.[0]?.name?.value] ?? { data: null }
      ),
    })),
    mutation: vi.fn().mockReturnValue({
      toPromise: vi.fn().mockResolvedValue(mutationResponse),
    }),
  };
}

// Simpler approach: mock by call order
function createSequentialMockClient(responses: Array<{ data?: any; error?: any }>) {
  let callIndex = 0;
  const client = {
    query: vi.fn().mockImplementation(() => ({
      toPromise: vi.fn().mockImplementation(() => {
        const response = responses[callIndex] ?? { data: null };
        callIndex++;
        return Promise.resolve(response);
      }),
    })),
    mutation: vi.fn().mockReturnValue({
      toPromise: vi.fn().mockResolvedValue(responses[responses.length - 1] ?? { data: null }),
    }),
  };
  return client;
}

describe("SaleorImportClient", () => {
  describe("getChannels", () => {
    it("returns channels from query", async () => {
      const mockChannels = [
        { id: "ch-1", name: "Webstore", slug: "webstore", currencyCode: "USD" },
        { id: "ch-2", name: "Singles", slug: "singles-builder", currencyCode: "USD" },
      ];
      const client = {
        query: vi.fn().mockReturnValue({
          toPromise: vi.fn().mockResolvedValue({ data: { channels: mockChannels } }),
        }),
        mutation: vi.fn(),
      };

      const saleor = new SaleorImportClient(client as any);
      const channels = await saleor.getChannels();

      expect(channels).toEqual(mockChannels);
    });

    it("throws on GraphQL error", async () => {
      const client = {
        query: vi.fn().mockReturnValue({
          toPromise: vi.fn().mockResolvedValue({ error: { message: "Auth failed" } }),
        }),
        mutation: vi.fn(),
      };

      const saleor = new SaleorImportClient(client as any);
      await expect(saleor.getChannels()).rejects.toThrow("Failed to fetch channels");
    });

    it("returns empty array when no channels", async () => {
      const client = {
        query: vi.fn().mockReturnValue({
          toPromise: vi.fn().mockResolvedValue({ data: { channels: null } }),
        }),
        mutation: vi.fn(),
      };

      const saleor = new SaleorImportClient(client as any);
      const channels = await saleor.getChannels();
      expect(channels).toEqual([]);
    });
  });

  describe("getChannelsBySlugs", () => {
    it("filters channels by slug list", async () => {
      const allChannels = [
        { id: "ch-1", name: "Webstore", slug: "webstore", currencyCode: "USD" },
        { id: "ch-2", name: "Singles", slug: "singles-builder", currencyCode: "USD" },
        { id: "ch-3", name: "Other", slug: "other", currencyCode: "USD" },
      ];
      const client = {
        query: vi.fn().mockReturnValue({
          toPromise: vi.fn().mockResolvedValue({ data: { channels: allChannels } }),
        }),
        mutation: vi.fn(),
      };

      const saleor = new SaleorImportClient(client as any);
      const found = await saleor.getChannelsBySlugs(["webstore", "singles-builder"]);

      expect(found).toHaveLength(2);
      expect(found.map((c) => c.slug)).toEqual(["webstore", "singles-builder"]);
    });
  });

  describe("getProductType", () => {
    it("finds product type by slug", async () => {
      const mockType = {
        id: "pt-1",
        name: "MTG Card",
        slug: "mtg-card",
        productAttributes: [],
        variantAttributes: [],
      };
      const client = {
        query: vi.fn().mockReturnValue({
          toPromise: vi.fn().mockResolvedValue({
            data: { productTypes: { edges: [{ node: mockType }] } },
          }),
        }),
        mutation: vi.fn(),
      };

      const saleor = new SaleorImportClient(client as any);
      const pt = await saleor.getProductType();

      expect(pt.slug).toBe("mtg-card");
    });

    it("throws when product type not found", async () => {
      const client = {
        query: vi.fn().mockReturnValue({
          toPromise: vi.fn().mockResolvedValue({
            data: { productTypes: { edges: [] } },
          }),
        }),
        mutation: vi.fn(),
      };

      const saleor = new SaleorImportClient(client as any);
      await expect(saleor.getProductType()).rejects.toThrow('Product type "mtg-card" not found');
    });
  });

  describe("getCategory", () => {
    it("finds category by slug", async () => {
      const mockCat = { id: "cat-1", name: "MTG Cards", slug: "mtg-cards" };
      const client = {
        query: vi.fn().mockReturnValue({
          toPromise: vi.fn().mockResolvedValue({
            data: { categories: { edges: [{ node: mockCat }] } },
          }),
        }),
        mutation: vi.fn(),
      };

      const saleor = new SaleorImportClient(client as any);
      const cat = await saleor.getCategory();

      expect(cat.slug).toBe("mtg-cards");
    });

    it("throws when category not found", async () => {
      const client = {
        query: vi.fn().mockReturnValue({
          toPromise: vi.fn().mockResolvedValue({
            data: { categories: { edges: [] } },
          }),
        }),
        mutation: vi.fn(),
      };

      const saleor = new SaleorImportClient(client as any);
      await expect(saleor.getCategory()).rejects.toThrow('Category "mtg-cards" not found');
    });
  });

  describe("getWarehouse", () => {
    it("returns first warehouse", async () => {
      const mockWh = { id: "wh-1", name: "Main", slug: "main" };
      const client = {
        query: vi.fn().mockReturnValue({
          toPromise: vi.fn().mockResolvedValue({
            data: { warehouses: { edges: [{ node: mockWh }] } },
          }),
        }),
        mutation: vi.fn(),
      };

      const saleor = new SaleorImportClient(client as any);
      const wh = await saleor.getWarehouse();

      expect(wh.id).toBe("wh-1");
    });

    it("throws when no warehouses exist", async () => {
      const client = {
        query: vi.fn().mockReturnValue({
          toPromise: vi.fn().mockResolvedValue({
            data: { warehouses: { edges: [] } },
          }),
        }),
        mutation: vi.fn(),
      };

      const saleor = new SaleorImportClient(client as any);
      await expect(saleor.getWarehouse()).rejects.toThrow("No warehouses found");
    });
  });

  describe("productExists", () => {
    it("returns true when product found", async () => {
      const client = {
        query: vi.fn().mockReturnValue({
          toPromise: vi.fn().mockResolvedValue({
            data: { product: { id: "prod-1", name: "Card", slug: "card" } },
          }),
        }),
        mutation: vi.fn(),
      };

      const saleor = new SaleorImportClient(client as any);
      expect(await saleor.productExists("card")).toBe(true);
    });

    it("returns false when product not found", async () => {
      const client = {
        query: vi.fn().mockReturnValue({
          toPromise: vi.fn().mockResolvedValue({
            data: { product: null },
          }),
        }),
        mutation: vi.fn(),
      };

      const saleor = new SaleorImportClient(client as any);
      expect(await saleor.productExists("nonexistent")).toBe(false);
    });
  });

  describe("bulkCreateProducts", () => {
    it("returns structured result on success", async () => {
      const mockResult = {
        count: 2,
        results: [
          { product: { id: "p1", name: "Card 1", slug: "card-1", variants: [] }, errors: [] },
          { product: { id: "p2", name: "Card 2", slug: "card-2", variants: [] }, errors: [] },
        ],
        errors: [],
      };
      const client = {
        query: vi.fn(),
        mutation: vi.fn().mockReturnValue({
          toPromise: vi.fn().mockResolvedValue({
            data: { productBulkCreate: mockResult },
          }),
        }),
      };

      const saleor = new SaleorImportClient(client as any);
      const result = await saleor.bulkCreateProducts([{}, {}]);

      expect(result.count).toBe(2);
      expect(result.results).toHaveLength(2);
    });

    it("throws on GraphQL error", async () => {
      const client = {
        query: vi.fn(),
        mutation: vi.fn().mockReturnValue({
          toPromise: vi.fn().mockResolvedValue({
            error: { message: "Internal server error" },
          }),
        }),
      };

      const saleor = new SaleorImportClient(client as any);
      await expect(saleor.bulkCreateProducts([{}])).rejects.toThrow("productBulkCreate failed");
    });

    it("throws when mutation returns no data", async () => {
      const client = {
        query: vi.fn(),
        mutation: vi.fn().mockReturnValue({
          toPromise: vi.fn().mockResolvedValue({ data: { productBulkCreate: null } }),
        }),
      };

      const saleor = new SaleorImportClient(client as any);
      await expect(saleor.bulkCreateProducts([{}])).rejects.toThrow("returned no data");
    });
  });
});
