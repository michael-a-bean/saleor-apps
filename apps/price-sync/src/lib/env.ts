import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Installation ID - which app installation to sync prices for
  INSTALLATION_ID: z.string().uuid(),

  // Saleor channel for price lookups
  SALEOR_CHANNEL_ID: z.string().default("default-channel"),

  // Scryfall API
  SCRYFALL_API_BASE_URL: z.string().url().default("https://api.scryfall.com"),
  SCRYFALL_RATE_LIMIT_MS: z.coerce.number().min(50).default(100), // Scryfall requires 50-100ms between requests

  // TCGPlayer API (optional)
  TCGPLAYER_API_KEY: z.string().optional(),
  TCGPLAYER_API_SECRET: z.string().optional(),

  // Price provider preference
  PRICE_PROVIDER: z.enum(["scryfall", "tcgplayer"]).default("scryfall"),

  // Sync configuration
  BATCH_SIZE: z.coerce.number().min(1).max(1000).default(100),
  CONCURRENCY: z.coerce.number().min(1).max(10).default(1), // Keep low due to rate limits

  // Logging
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error("Environment validation failed:");
    console.error(parsed.error.format());
    process.exit(1);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
