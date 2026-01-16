import { AppBridge } from "@saleor/app-sdk/app-bridge";
import { SALEOR_API_URL_HEADER, SALEOR_AUTHORIZATION_BEARER_HEADER } from "@saleor/app-sdk/headers";
import { httpBatchLink } from "@trpc/client";

/**
 * Get the base URL for tRPC requests.
 *
 * On the server side, uses VERCEL_URL or falls back to localhost.
 * On the client side, returns empty string (relative URL) which is then
 * combined with the basePath.
 */
export function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  return `http://localhost:${process.env.PORT ?? 3000}`;
}

/**
 * Normalize a basePath to ensure:
 * - Empty string remains empty
 * - Non-empty paths start with /
 * - No trailing slashes
 * - No double slashes
 *
 * This prevents malformed URLs like "//api/trpc" or "/apps/stripe//api/trpc"
 */
export function normalizeBasePath(path: string | undefined | null): string {
  if (!path) return "";

  // Remove leading/trailing whitespace
  let normalized = path.trim();

  // Remove trailing slashes
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  // Ensure leading slash for non-empty paths
  if (normalized && !normalized.startsWith("/")) {
    normalized = "/" + normalized;
  }

  // Remove any double slashes
  normalized = normalized.replace(/\/+/g, "/");

  return normalized;
}

/**
 * Get the Next.js basePath from environment variable.
 *
 * This is crucial for apps deployed behind a path-based ALB router
 * (e.g., /apps/stripe). Without this, client-side requests would go
 * to /api/trpc instead of /apps/stripe/api/trpc, causing HTML responses
 * instead of JSON.
 *
 * @param options.requireBasePath - If true, logs a warning when running in
 *   production (NODE_ENV=production) and basePath is empty. Useful for
 *   debugging deployment issues.
 */
export function getBasePath(options?: { warnIfMissing?: boolean }): string {
  const raw = process.env.NEXT_PUBLIC_BASE_PATH;
  const normalized = normalizeBasePath(raw);

  // Warn if basePath appears to be missing in production
  if (options?.warnIfMissing && !normalized && process.env.NODE_ENV === "production") {
    console.warn(
      "[tRPC] NEXT_PUBLIC_BASE_PATH is not set in production build. " +
        "If this app is deployed behind a path-based router (e.g., ALB with /apps/stripe), " +
        "API requests will fail with HTML responses instead of JSON. " +
        "Ensure NEXT_PUBLIC_BASE_PATH is set at build time in the Dockerfile."
    );
  }

  return normalized;
}

/**
 * Construct the full tRPC URL from base URL and basePath.
 * Exported for testing.
 */
export function buildTrpcUrl(baseUrl: string, basePath: string): string {
  return `${baseUrl}${basePath}/api/trpc`;
}

export const createHttpBatchLink = (appBridgeInstance?: AppBridge) => {
  const basePath = getBasePath({ warnIfMissing: true });
  const url = buildTrpcUrl(getBaseUrl(), basePath);

  return httpBatchLink({
    url,
    headers() {
      const { token, saleorApiUrl } = appBridgeInstance?.getState() || {};

      if (!token || !saleorApiUrl) {
        throw new Error("Token and Saleor API URL unknown");
      }

      return {
        /**
         * Attach headers from app to client requests, so tRPC can add them to context
         */
        [SALEOR_AUTHORIZATION_BEARER_HEADER]: appBridgeInstance?.getState().token,
        [SALEOR_API_URL_HEADER]: appBridgeInstance?.getState().saleorApiUrl,
      };
    },
  });
};
