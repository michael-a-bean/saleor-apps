import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { fromError } from "zod-validation-error";

import { BaseError } from "@/lib/errors";

const booleanSchema = z
  .string()
  .refine((s) => s === "true" || s === "false")
  .transform((s) => s === "true");

// Check if we're in a build environment (CI, Docker build, etc.)
const isBuilding = process.env.SKIP_ENV_VALIDATION === "true" ||
  process.env.CI === "true" ||
  process.env.DOCKER_BUILD === "true" ||
  process.env.NEXT_PHASE === "phase-production-build";

export const env = createEnv({
  client: {
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  },
  server: {
    // Database - optional during build
    DATABASE_URL: isBuilding ? z.string().optional() : z.string().url(),

    // App configuration
    ALLOWED_DOMAIN_PATTERN: z.string().optional(),
    APL: z.enum(["saleor-cloud", "file", "redis"]).optional().default("file"),
    REDIS_URL: z.string().url().optional(),
    APP_API_BASE_URL: z.string().optional(),
    APP_IFRAME_BASE_URL: z.string().optional(),
    APP_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    MANIFEST_APP_ID: z.string().optional().default("saleor.app.mtg-import"),
    APP_NAME: z.string().optional().default("MTG Import"),

    // Scryfall
    SCRYFALL_CONTACT_EMAIL: z.string().email().optional(),

    // Security - optional during build
    SECRET_KEY: isBuilding ? z.string().optional() : z.string().min(32),
    CRON_SECRET: z.string().optional(),

    // Import tuning (scale with RDS capacity)
    IMPORT_BATCH_SIZE: z.coerce.number().optional().default(25),
    IMPORT_CONCURRENCY: z.coerce.number().optional().default(3),

    // Circuit breaker (protects against sustained API failures during long imports)
    CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().optional().default(5),
    CIRCUIT_BREAKER_COOLDOWN_MS: z.coerce.number().optional().default(30000),
    CIRCUIT_BREAKER_MAX_RETRIES: z.coerce.number().optional().default(3),

    // Orphan recovery
    ORPHAN_JOB_THRESHOLD_MINUTES: z.coerce.number().optional().default(10),

    // Observability
    OTEL_ACCESS_TOKEN: z.string().optional(),
    OTEL_ENABLED: booleanSchema.optional().default("false"),
    OTEL_SERVICE_NAME: z.string().optional().default("saleor-app-mtg-import"),

    // Server
    PORT: z.coerce.number().optional().default(3005),
    REPOSITORY_URL: z.string().optional(),

    // Vercel
    VERCEL_ENV: z.string().optional(),
    VERCEL_GIT_COMMIT_SHA: z.string().optional(),

    /*
     * Docker networking - URL aliases for APL normalization
     * Format: "alias1=canonical1,alias2=canonical2"
     */
    SALEOR_URL_ALIASES: z
      .string()
      .optional()
      .default("localhost:8000=api:8000,127.0.0.1:8000=api:8000"),
  },
  shared: {
    NODE_ENV: z.enum(["development", "production", "test"]).optional().default("development"),
    ENV: z.enum(["local", "development", "staging", "production"]).optional().default("local"),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    ALLOWED_DOMAIN_PATTERN: process.env.ALLOWED_DOMAIN_PATTERN,
    APL: process.env.APL,
    REDIS_URL: process.env.REDIS_URL,
    APP_API_BASE_URL: process.env.APP_API_BASE_URL,
    APP_IFRAME_BASE_URL: process.env.APP_IFRAME_BASE_URL,
    APP_LOG_LEVEL: process.env.APP_LOG_LEVEL,
    MANIFEST_APP_ID: process.env.MANIFEST_APP_ID,
    APP_NAME: process.env.APP_NAME,
    SCRYFALL_CONTACT_EMAIL: process.env.SCRYFALL_CONTACT_EMAIL,
    SECRET_KEY: process.env.SECRET_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    IMPORT_BATCH_SIZE: process.env.IMPORT_BATCH_SIZE,
    IMPORT_CONCURRENCY: process.env.IMPORT_CONCURRENCY,
    CIRCUIT_BREAKER_THRESHOLD: process.env.CIRCUIT_BREAKER_THRESHOLD,
    CIRCUIT_BREAKER_COOLDOWN_MS: process.env.CIRCUIT_BREAKER_COOLDOWN_MS,
    CIRCUIT_BREAKER_MAX_RETRIES: process.env.CIRCUIT_BREAKER_MAX_RETRIES,
    ORPHAN_JOB_THRESHOLD_MINUTES: process.env.ORPHAN_JOB_THRESHOLD_MINUTES,
    OTEL_ACCESS_TOKEN: process.env.OTEL_ACCESS_TOKEN,
    OTEL_ENABLED: process.env.OTEL_ENABLED,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    PORT: process.env.PORT,
    REPOSITORY_URL: process.env.REPOSITORY_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    NODE_ENV: process.env.NODE_ENV,
    ENV: process.env.ENV,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    SALEOR_URL_ALIASES: process.env.SALEOR_URL_ALIASES,
  },
  isServer: typeof window === "undefined" || process.env.NODE_ENV === "test",
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  onValidationError(issues) {
    const validationError = fromError(issues);
    const EnvValidationError = BaseError.subclass("EnvValidationError");

    throw new EnvValidationError(validationError.toString(), {
      cause: issues,
    });
  },
});
