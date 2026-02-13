import { describe, expect, it } from "vitest";

import { RateLimiter } from "@/modules/scryfall/rate-limiter";

describe("RateLimiter", () => {
  it("allows immediate first request", async () => {
    const limiter = new RateLimiter({ maxPerSecond: 10, minIntervalMs: 50 });
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it("enforces minimum interval between requests", async () => {
    const limiter = new RateLimiter({ maxPerSecond: 10, minIntervalMs: 100 });

    await limiter.acquire();
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;

    // Should wait at least minIntervalMs (with some tolerance)
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  it("handles concurrent callers in FIFO order", async () => {
    const limiter = new RateLimiter({ maxPerSecond: 10, minIntervalMs: 50 });
    const order: number[] = [];

    const promises = [1, 2, 3].map(async (n) => {
      await limiter.acquire();
      order.push(n);
    });

    await Promise.all(promises);
    expect(order).toEqual([1, 2, 3]);
  });
});
