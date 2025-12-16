import { vi } from "vitest";

// Mock environment variables for tests
vi.mock("@/lib/env", () => ({
  env: {
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    SECRET_KEY: "test-secret-key-must-be-32-chars-long",
    NODE_ENV: "test",
    ENV: "local",
    APP_LOG_LEVEL: "debug",
    DEFAULT_CURRENCY: "USD",
    ALLOW_NEGATIVE_STOCK: false,
    MANIFEST_APP_ID: "saleor.app.inventory-ops",
    APP_NAME: "Inventory Ops",
    PORT: 3002,
  },
}));

// Mock Prisma client
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appInstallation: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    supplier: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    purchaseOrder: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    goodsReceipt: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    costLayerEvent: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    saleorPostingRecord: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));
