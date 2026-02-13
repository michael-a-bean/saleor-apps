/**
 * Token-bucket rate limiter for Scryfall API.
 *
 * Scryfall asks for 50-100ms between requests (10-20 req/sec).
 * We target 10 req/sec (100ms minimum gap) to stay safely under limits.
 */

export interface RateLimiterOptions {
  /** Maximum requests per second (default: 10) */
  maxPerSecond?: number;
  /** Minimum milliseconds between requests (default: 100) */
  minIntervalMs?: number;
}

export class RateLimiter {
  private readonly maxPerSecond: number;
  private readonly minIntervalMs: number;
  private tokens: number;
  private lastRefill: number;
  private lastRequest: number;
  private queue: Array<() => void> = [];

  constructor(options: RateLimiterOptions = {}) {
    this.maxPerSecond = options.maxPerSecond ?? 10;
    this.minIntervalMs = options.minIntervalMs ?? 100;
    this.tokens = this.maxPerSecond;
    this.lastRefill = Date.now();
    this.lastRequest = 0;
  }

  /**
   * Wait until a request slot is available, then consume it.
   * Safe for concurrent callers — requests are queued FIFO.
   */
  async acquire(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      if (this.queue.length === 1) {
        this.processQueue();
      }
    });
  }

  private async processQueue(): Promise<void> {
    while (this.queue.length > 0) {
      this.refillTokens();

      const now = Date.now();
      const timeSinceLast = now - this.lastRequest;

      // Enforce minimum interval between requests
      if (timeSinceLast < this.minIntervalMs) {
        await this.sleep(this.minIntervalMs - timeSinceLast);
        this.refillTokens();
      }

      // Wait for token availability
      if (this.tokens < 1) {
        const msUntilRefill = 1000 - (Date.now() - this.lastRefill);
        if (msUntilRefill > 0) {
          await this.sleep(msUntilRefill);
        }
        this.refillTokens();
      }

      this.tokens -= 1;
      this.lastRequest = Date.now();

      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }

  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const refill = (elapsed / 1000) * this.maxPerSecond;
    this.tokens = Math.min(this.maxPerSecond, this.tokens + refill);
    this.lastRefill = now;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
