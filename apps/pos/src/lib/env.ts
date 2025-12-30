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
  // Next.js sets this during build
  process.env.NEXT_PHASE === "phase-production-build";

export const env = createEnv({
  client: {
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  },
  server: {
    // Database - optional during build (shared with inventory-ops)
    DATABASE_URL: isBuilding ? z.string().optional() : z.string().url(),

    // App configuration
    ALLOWED_DOMAIN_PATTERN: z.string().optional(),
    APL: z.enum(["saleor-cloud", "file"]).optional().default("file"),
    APP_API_BASE_URL: z.string().optional(),
    APP_IFRAME_BASE_URL: z.string().optional(),
    APP_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    MANIFEST_APP_ID: z.string().optional().default("saleor.app.pos"),
    APP_NAME: z.string().optional().default("POS"),

    // Security - optional during build
    SECRET_KEY: isBuilding ? z.string().optional() : z.string().min(32),

    // Stripe Terminal (Phase 2)
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_TERMINAL_LOCATION_ID: z.string().optional(),

    // Observability
    OTEL_ACCESS_TOKEN: z.string().optional(),
    OTEL_ENABLED: booleanSchema.optional().default("false"),
    OTEL_SERVICE_NAME: z.string().optional().default("saleor-app-pos"),

    // Server
    PORT: z.coerce.number().optional().default(3004),
    REPOSITORY_URL: z.string().optional(),

    // Vercel
    VERCEL_ENV: z.string().optional(),
    VERCEL_GIT_COMMIT_SHA: z.string().optional(),

    // Business logic defaults
    DEFAULT_CURRENCY: z.string().length(3).optional().default("USD"),
    DEFAULT_TAX_RATE: z.coerce.number().optional().default(0),
    REQUIRE_MANAGER_FOR_DISCOUNT_ABOVE: z.coerce.number().optional().default(20), // Percent
    REQUIRE_MANAGER_FOR_VOID: booleanSchema.optional().default("true"),
    ALLOW_NO_RECEIPT_RETURNS: booleanSchema.optional().default("true"),
  },
  shared: {
    NODE_ENV: z.enum(["development", "production", "test"]).optional().default("development"),
    ENV: z.enum(["local", "development", "staging", "production"]).optional().default("local"),
  },
  runtimeEnv: {
    // Database
    DATABASE_URL: process.env.DATABASE_URL,

    // App configuration
    ALLOWED_DOMAIN_PATTERN: process.env.ALLOWED_DOMAIN_PATTERN,
    APL: process.env.APL,
    APP_API_BASE_URL: process.env.APP_API_BASE_URL,
    APP_IFRAME_BASE_URL: process.env.APP_IFRAME_BASE_URL,
    APP_LOG_LEVEL: process.env.APP_LOG_LEVEL,
    MANIFEST_APP_ID: process.env.MANIFEST_APP_ID,
    APP_NAME: process.env.APP_NAME,

    // Security
    SECRET_KEY: process.env.SECRET_KEY,

    // Stripe Terminal
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_TERMINAL_LOCATION_ID: process.env.STRIPE_TERMINAL_LOCATION_ID,

    // Observability
    OTEL_ACCESS_TOKEN: process.env.OTEL_ACCESS_TOKEN,
    OTEL_ENABLED: process.env.OTEL_ENABLED,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,

    // Server
    PORT: process.env.PORT,
    REPOSITORY_URL: process.env.REPOSITORY_URL,

    // Vercel
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,

    // Shared
    NODE_ENV: process.env.NODE_ENV,
    ENV: process.env.ENV,

    // Client
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Business logic
    DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY,
    DEFAULT_TAX_RATE: process.env.DEFAULT_TAX_RATE,
    REQUIRE_MANAGER_FOR_DISCOUNT_ABOVE: process.env.REQUIRE_MANAGER_FOR_DISCOUNT_ABOVE,
    REQUIRE_MANAGER_FOR_VOID: process.env.REQUIRE_MANAGER_FOR_VOID,
    ALLOW_NO_RECEIPT_RETURNS: process.env.ALLOW_NO_RECEIPT_RETURNS,
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
