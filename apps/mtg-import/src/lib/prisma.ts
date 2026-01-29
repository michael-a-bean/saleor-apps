import { PrismaClient } from "@prisma/client";

// Lazy initialization to avoid Prisma client instantiation during Next.js build
// The Prisma client should only be created at runtime when actually needed

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  // Skip during build/SSG - check various build indicators
  if (
    process.env.SKIP_ENV_VALIDATION === "true" ||
    process.env.NEXT_PHASE === "phase-production-build"
  ) {
    // Return a proxy that throws on access during build
    // This prevents accidental usage during static generation
    return new Proxy({} as PrismaClient, {
      get() {
        throw new Error(
          "Prisma client is not available during build. This code path should not be reached during SSG."
        );
      },
    });
  }

  const nodeEnv = process.env.NODE_ENV ?? "development";

  return new PrismaClient({
    log: nodeEnv === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

/**
 * Get the Prisma client instance.
 * Uses a singleton pattern for connection reuse.
 */
export function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

// For backwards compatibility, export a lazy getter
// Don't instantiate at module load time
let _prisma: PrismaClient | null = null;

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (_prisma === null) {
      _prisma = getPrismaClient();
    }
    return Reflect.get(_prisma, prop);
  },
});

export type { PrismaClient };
