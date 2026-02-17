import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { ScryfallClient } from "@/modules/scryfall/client";
import { RateLimiter } from "@/modules/scryfall/rate-limiter";

// --- Mock fetch ---

const originalFetch = globalThis.fetch;

function mockFetchResponse(data: any, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(data),
  } as Response;
}

describe("ScryfallClient", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let noopLimiter: RateLimiter;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
    // Use a no-delay rate limiter for tests
    noopLimiter = new RateLimiter({ maxPerSecond: 1000, minIntervalMs: 0 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("search", () => {
    it("sends correct query params", async () => {
      const mockResponse = { object: "list", total_cards: 1, has_more: false, data: [] };
      mockFetch.mockResolvedValue(mockFetchResponse(mockResponse));

      const client = new ScryfallClient({ rateLimiter: noopLimiter });
      await client.search("lightning bolt", { unique: "prints", page: 2 });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/cards/search");
      expect(url).toContain("q=lightning+bolt");
      expect(url).toContain("unique=prints");
      expect(url).toContain("page=2");
    });

    it("includes User-Agent header", async () => {
      mockFetch.mockResolvedValue(mockFetchResponse({ object: "list", data: [], has_more: false, total_cards: 0 }));

      const client = new ScryfallClient({
        rateLimiter: noopLimiter,
        contactEmail: "test@example.com",
        appName: "TestApp",
        appVersion: "2.0",
      });
      await client.search("test");

      const headers = mockFetch.mock.calls[0][1]?.headers;
      expect(headers["User-Agent"]).toBe("TestApp/2.0 (test@example.com)");
    });
  });

  describe("getCard", () => {
    it("constructs correct URL path", async () => {
      const mockCard = { object: "card", id: "abc-123", name: "Test" };
      mockFetch.mockResolvedValue(mockFetchResponse(mockCard));

      const client = new ScryfallClient({ rateLimiter: noopLimiter });
      const card = await client.getCard("abc-123");

      expect(mockFetch.mock.calls[0][0]).toContain("/cards/abc-123");
      expect(card.id).toBe("abc-123");
    });
  });

  describe("getCardBySetNumber", () => {
    it("constructs correct URL path", async () => {
      mockFetch.mockResolvedValue(mockFetchResponse({ object: "card", id: "x" }));

      const client = new ScryfallClient({ rateLimiter: noopLimiter });
      await client.getCardBySetNumber("m11", "149");

      expect(mockFetch.mock.calls[0][0]).toContain("/cards/m11/149");
    });
  });

  describe("getCardByName", () => {
    it("sends exact name param", async () => {
      mockFetch.mockResolvedValue(mockFetchResponse({ object: "card", id: "x" }));

      const client = new ScryfallClient({ rateLimiter: noopLimiter });
      await client.getCardByName("Lightning Bolt", "m11");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("exact=Lightning+Bolt");
      expect(url).toContain("set=m11");
    });
  });

  describe("listSets", () => {
    it("returns data array from response", async () => {
      const sets = [{ object: "set", code: "m11" }, { object: "set", code: "lea" }];
      mockFetch.mockResolvedValue(mockFetchResponse({ object: "list", data: sets, has_more: false }));

      const client = new ScryfallClient({ rateLimiter: noopLimiter });
      const result = await client.listSets();

      expect(result).toEqual(sets);
    });
  });

  describe("getDefaultCardsBulkData", () => {
    it("finds default_cards type in catalog", async () => {
      const catalog = [
        { type: "oracle_cards", download_uri: "https://data/oracle.json" },
        { type: "default_cards", download_uri: "https://data/default.json", updated_at: "2024-01-01" },
      ];
      mockFetch.mockResolvedValue(mockFetchResponse({ object: "list", data: catalog, has_more: false }));

      const client = new ScryfallClient({ rateLimiter: noopLimiter });
      const result = await client.getDefaultCardsBulkData();

      expect(result.type).toBe("default_cards");
      expect(result.download_uri).toBe("https://data/default.json");
    });

    it("throws when default_cards not found", async () => {
      mockFetch.mockResolvedValue(mockFetchResponse({ object: "list", data: [], has_more: false }));

      const client = new ScryfallClient({ rateLimiter: noopLimiter });
      await expect(client.getDefaultCardsBulkData()).rejects.toThrow("default_cards");
    });
  });

  describe("retry logic", () => {
    it("retries on 429 with Retry-After header", async () => {
      mockFetch
        .mockResolvedValueOnce(mockFetchResponse(
          { object: "error", code: "too_many_requests", status: 429, details: "Rate limited" },
          429,
          { "Retry-After": "1" }
        ))
        .mockResolvedValueOnce(mockFetchResponse({ object: "card", id: "abc" }));

      const client = new ScryfallClient({ rateLimiter: noopLimiter });
      const result = await client.getCard("abc");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.id).toBe("abc");
    });

    it("retries on 503 up to MAX_RETRIES times", async () => {
      mockFetch
        .mockResolvedValueOnce(mockFetchResponse({ object: "error" }, 503))
        .mockResolvedValueOnce(mockFetchResponse({ object: "error" }, 503))
        .mockResolvedValueOnce(mockFetchResponse({ object: "card", id: "abc" }));

      const client = new ScryfallClient({ rateLimiter: noopLimiter });
      const result = await client.getCard("abc");

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.id).toBe("abc");
    });

    it("throws after max retries exhausted", async () => {
      mockFetch.mockResolvedValue(mockFetchResponse({ object: "error" }, 503));

      const client = new ScryfallClient({ rateLimiter: noopLimiter });
      await expect(client.getCard("abc")).rejects.toThrow("failed after");
    });

    it("does NOT retry on 404", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse({ object: "error", code: "not_found", status: 404, details: "Card not found" }, 404)
      );

      const client = new ScryfallClient({ rateLimiter: noopLimiter });
      await expect(client.getCard("nonexistent")).rejects.toThrow("Card not found");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("rate limiting", () => {
    it("calls rateLimiter.acquire() before each request", async () => {
      mockFetch.mockResolvedValue(mockFetchResponse({ object: "card", id: "x" }));

      const mockAcquire = vi.fn().mockResolvedValue(undefined);
      const mockLimiter = { acquire: mockAcquire } as unknown as RateLimiter;

      const client = new ScryfallClient({ rateLimiter: mockLimiter });
      await client.getCard("x");

      expect(mockAcquire).toHaveBeenCalledTimes(1);
    });
  });

  describe("searchAll", () => {
    it("paginates through all pages", async () => {
      mockFetch
        .mockResolvedValueOnce(mockFetchResponse({
          object: "list",
          total_cards: 3,
          has_more: true,
          data: [{ id: "1" }, { id: "2" }],
        }))
        .mockResolvedValueOnce(mockFetchResponse({
          object: "list",
          total_cards: 3,
          has_more: false,
          data: [{ id: "3" }],
        }));

      const client = new ScryfallClient({ rateLimiter: noopLimiter });
      const cards = [];
      for await (const card of client.searchAll("test")) {
        cards.push(card);
      }

      expect(cards).toHaveLength(3);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
