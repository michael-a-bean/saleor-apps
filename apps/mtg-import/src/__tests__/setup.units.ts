import { vi } from "vitest";

// Mock environment variables for tests
vi.mock("@/lib/env", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    SECRET_KEY: "test-secret-key-must-be-32-chars-long",
    NODE_ENV: "test",
    ENV: "local",
    APP_LOG_LEVEL: "debug",
    MANIFEST_APP_ID: "saleor.app.mtg-import",
    APP_NAME: "MTG Import",
    PORT: 3005,
  },
}));

// Mock Prisma client
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appInstallation: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    importJob: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    importedProduct: {
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(),
    },
    setAudit: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));
