import { AuthData } from "@saleor/app-sdk/APL";
import { FileAPL } from "@saleor/app-sdk/APL/file";

import { env } from "./env";
import { createLogger } from "./logger";

const logger = createLogger("NormalizedAPL");

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

const DEFAULT_URL_ALIASES = "localhost:8000=api:8000,127.0.0.1:8000=api:8000";

const URL_ALIASES: [string, string][] = parseUrlAliases(
  env.SALEOR_URL_ALIASES ?? DEFAULT_URL_ALIASES
);

if (URL_ALIASES.length > 0) {
  logger.debug("Loaded URL aliases", {
    count: URL_ALIASES.length,
    aliases: URL_ALIASES.map(([alias, canonical]) => `${alias} → ${canonical}`),
  });
}

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
