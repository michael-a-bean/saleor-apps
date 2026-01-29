import { AuthData } from "@saleor/app-sdk/APL";
import { FileAPL } from "@saleor/app-sdk/APL/file";

import { env } from "./env";
import { createLogger } from "./logger";

const logger = createLogger("NormalizedAPL");

/**
 * Parse URL aliases from environment configuration.
 *
 * Format: "alias1=canonical1,alias2=canonical2"
 * Example: "localhost:8000=api:8000,127.0.0.1:8000=api:8000"
 *
 * This handles Docker networking where:
 * - 'api:8000' is used inside Docker containers
 * - 'localhost:8000' is used from the browser
 */
const parseUrlAliases = (aliasConfig: string): [string, string][] => {
  if (!aliasConfig.trim()) {
    return [];
  }

  const aliases: [string, string][] = [];

  for (const pair of aliasConfig.split(",")) {
    const [alias, canonical] = pair.split("=").map((s) => s.trim());

    if (alias && canonical) {
      aliases.push([alias, canonical]);
    } else {
      logger.warn("Invalid URL alias format, skipping", { pair });
    }
  }

  return aliases;
};

/**
 * Default URL aliases for common Docker dev setups.
 * Used when SALEOR_URL_ALIASES env var is not set (e.g., during build).
 */
const DEFAULT_URL_ALIASES = "localhost:8000=api:8000,127.0.0.1:8000=api:8000";

/**
 * URL aliases loaded from SALEOR_URL_ALIASES environment variable.
 * Falls back to default for common Docker dev setups.
 */
const URL_ALIASES: [string, string][] = parseUrlAliases(
  env.SALEOR_URL_ALIASES ?? DEFAULT_URL_ALIASES
);

// Log configured aliases on startup for debugging
if (URL_ALIASES.length > 0) {
  logger.debug("Loaded URL aliases", {
    count: URL_ALIASES.length,
    aliases: URL_ALIASES.map(([alias, canonical]) => `${alias} → ${canonical}`),
  });
}

/**
 * Normalize a Saleor API URL to its canonical form.
 * This ensures consistent storage and lookup regardless of which alias is used.
 */
export const normalizeSaleorApiUrl = (url: string): string => {
  let normalized = url;

  for (const [alias, canonical] of URL_ALIASES) {
    if (normalized.includes(alias)) {
      normalized = normalized.replace(alias, canonical);
      logger.debug("Normalized Saleor API URL", {
        original: url,
        normalized,
      });
      break;
    }
  }

  return normalized;
};

/**
 * FileAPL subclass that normalizes URLs before storage and lookup.
 * This prevents auth mismatches when the same Saleor instance is accessed
 * via different hostnames (e.g., Docker internal vs localhost).
 */
export class NormalizedFileAPL extends FileAPL {
  async get(saleorApiUrl: string): Promise<AuthData | undefined> {
    const normalizedUrl = normalizeSaleorApiUrl(saleorApiUrl);

    return super.get(normalizedUrl);
  }

  async set(authData: AuthData): Promise<void> {
    const normalizedAuthData: AuthData = {
      ...authData,
      saleorApiUrl: normalizeSaleorApiUrl(authData.saleorApiUrl),
    };

    logger.info("Storing auth data with normalized URL", {
      originalUrl: authData.saleorApiUrl,
      normalizedUrl: normalizedAuthData.saleorApiUrl,
      appId: authData.appId,
    });

    return super.set(normalizedAuthData);
  }

  async delete(saleorApiUrl: string): Promise<void> {
    const normalizedUrl = normalizeSaleorApiUrl(saleorApiUrl);

    return super.delete(normalizedUrl);
  }
}
