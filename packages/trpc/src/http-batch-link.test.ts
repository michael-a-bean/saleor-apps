import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { normalizeBasePath, getBasePath, buildTrpcUrl, getBaseUrl } from "./http-batch-link";

describe("http-batch-link", () => {
  describe("normalizeBasePath", () => {
    it("returns empty string for undefined", () => {
      expect(normalizeBasePath(undefined)).toBe("");
    });

    it("returns empty string for null", () => {
      expect(normalizeBasePath(null)).toBe("");
    });

    it("returns empty string for empty string", () => {
      expect(normalizeBasePath("")).toBe("");
    });

    it("returns empty string for whitespace only", () => {
      expect(normalizeBasePath("   ")).toBe("");
    });

    it("adds leading slash if missing", () => {
      expect(normalizeBasePath("apps/stripe")).toBe("/apps/stripe");
    });

    it("preserves leading slash", () => {
      expect(normalizeBasePath("/apps/stripe")).toBe("/apps/stripe");
    });

    it("removes trailing slashes", () => {
      expect(normalizeBasePath("/apps/stripe/")).toBe("/apps/stripe");
      expect(normalizeBasePath("/apps/stripe//")).toBe("/apps/stripe");
    });

    it("removes double slashes", () => {
      expect(normalizeBasePath("/apps//stripe")).toBe("/apps/stripe");
      expect(normalizeBasePath("//apps/stripe")).toBe("/apps/stripe");
    });

    it("handles complex malformed paths", () => {
      expect(normalizeBasePath("  //apps//stripe//  ")).toBe("/apps/stripe");
    });

    it("handles single slash", () => {
      expect(normalizeBasePath("/")).toBe("");
    });
  });

  describe("getBasePath", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("returns normalized NEXT_PUBLIC_BASE_PATH when set", () => {
      process.env.NEXT_PUBLIC_BASE_PATH = "/apps/stripe";
      expect(getBasePath()).toBe("/apps/stripe");
    });

    it("returns empty string when NEXT_PUBLIC_BASE_PATH is not set", () => {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
      expect(getBasePath()).toBe("");
    });

    it("normalizes trailing slashes from env var", () => {
      process.env.NEXT_PUBLIC_BASE_PATH = "/apps/stripe/";
      expect(getBasePath()).toBe("/apps/stripe");
    });

    it("logs warning in production when basePath is missing and warnIfMissing is true", () => {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
      process.env.NODE_ENV = "production";

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      getBasePath({ warnIfMissing: true });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("NEXT_PUBLIC_BASE_PATH is not set"));
      warnSpy.mockRestore();
    });

    it("does not log warning in development", () => {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
      process.env.NODE_ENV = "development";

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      getBasePath({ warnIfMissing: true });

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("does not log warning when basePath is set", () => {
      process.env.NEXT_PUBLIC_BASE_PATH = "/apps/stripe";
      process.env.NODE_ENV = "production";

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      getBasePath({ warnIfMissing: true });

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("buildTrpcUrl", () => {
    it("constructs URL with empty basePath (local development)", () => {
      expect(buildTrpcUrl("http://localhost:3000", "")).toBe("http://localhost:3000/api/trpc");
    });

    it("constructs URL with basePath (production)", () => {
      expect(buildTrpcUrl("", "/apps/stripe")).toBe("/apps/stripe/api/trpc");
    });

    it("constructs URL with full base URL and basePath", () => {
      expect(buildTrpcUrl("https://example.com", "/apps/stripe")).toBe(
        "https://example.com/apps/stripe/api/trpc"
      );
    });

    it("handles client-side relative URL with basePath", () => {
      // On client side, baseUrl is empty, only basePath is used
      expect(buildTrpcUrl("", "/apps/stripe")).toBe("/apps/stripe/api/trpc");
    });

    it("handles client-side relative URL without basePath", () => {
      // Local development without basePath
      expect(buildTrpcUrl("", "")).toBe("/api/trpc");
    });
  });

  describe("getBaseUrl", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      // Ensure we're not in a browser environment
      // @ts-expect-error - simulating server environment
      global.window = undefined;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("returns Vercel URL when VERCEL_URL is set", () => {
      process.env.VERCEL_URL = "my-app.vercel.app";
      expect(getBaseUrl()).toBe("https://my-app.vercel.app");
    });

    it("returns localhost with PORT when PORT is set", () => {
      delete process.env.VERCEL_URL;
      process.env.PORT = "3001";
      expect(getBaseUrl()).toBe("http://localhost:3001");
    });

    it("returns localhost with default port 3000", () => {
      delete process.env.VERCEL_URL;
      delete process.env.PORT;
      expect(getBaseUrl()).toBe("http://localhost:3000");
    });
  });

  describe("integration: URL construction for different environments", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("production with ALB path routing: should include basePath", () => {
      process.env.NEXT_PUBLIC_BASE_PATH = "/apps/stripe";
      // Client-side: baseUrl is empty
      const basePath = getBasePath();
      const url = buildTrpcUrl("", basePath);
      expect(url).toBe("/apps/stripe/api/trpc");
    });

    it("local development: should use localhost without basePath", () => {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
      delete process.env.VERCEL_URL;
      process.env.PORT = "3001";

      const basePath = getBasePath();
      const baseUrl = getBaseUrl();
      const url = buildTrpcUrl(baseUrl, basePath);
      expect(url).toBe("http://localhost:3001/api/trpc");
    });

    it("Vercel deployment: should use Vercel URL without basePath", () => {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
      process.env.VERCEL_URL = "my-app.vercel.app";

      const basePath = getBasePath();
      const baseUrl = getBaseUrl();
      const url = buildTrpcUrl(baseUrl, basePath);
      expect(url).toBe("https://my-app.vercel.app/api/trpc");
    });
  });
});
