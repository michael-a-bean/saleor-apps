import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Tests for the import tRPC router.
 *
 * Strategy: We test the router logic (validation, prisma calls, state machine)
 * by directly calling the router procedures with mocked context,
 * bypassing the authentication middleware.
 *
 * This tests business logic, not auth — auth is tested separately.
 */

const TEST_UUID_1 = "00000000-0000-4000-8000-000000000001";
const TEST_UUID_2 = "00000000-0000-4000-8000-000000000002";
const TEST_UUID_3 = "00000000-0000-4000-8000-000000000003";

// Mock the auth/APL layer so middleware passes through
vi.mock("@/lib/saleor-app", () => ({
  saleorApp: {
    apl: {
      get: vi.fn().mockResolvedValue({
        token: "test-app-token",
        saleorApiUrl: "https://api.test.saleor.cloud/graphql/",
        appId: "app-1",
      }),
    },
  },
}));

vi.mock("@saleor/app-sdk/auth", () => ({
  verifyJWT: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/graphql-client", () => ({
  createInstrumentedGraphqlClient: vi.fn().mockReturnValue({}),
}));

vi.mock("@sentry/nextjs", () => ({
  setTag: vi.fn(),
}));

// Mock the Saleor import client (pre-flight validation)
vi.mock("@/modules/saleor", () => ({
  SaleorImportClient: vi.fn().mockImplementation(() => ({
    resolveImportContext: vi.fn().mockResolvedValue({
      channelId: "ch-1",
      productTypeId: "pt-1",
      categoryId: "cat-1",
      warehouseId: "wh-1",
    }),
  })),
}));

// Mock the Scryfall module before importing the router
vi.mock("@/modules/scryfall", () => ({
  ScryfallClient: vi.fn().mockImplementation(() => ({
    listSets: vi.fn().mockResolvedValue([
      { object: "set", code: "m11", name: "Magic 2011", set_type: "core", card_count: 249, digital: false, released_at: "2010-07-16", icon_svg_uri: "", search_uri: "", scryfall_uri: "", uri: "", id: "set-1" },
      { object: "set", code: "lea", name: "Alpha", set_type: "expansion", card_count: 295, digital: false, released_at: "1993-08-05", icon_svg_uri: "", search_uri: "", scryfall_uri: "", uri: "", id: "set-2" },
      { object: "set", code: "ydmu", name: "Digital Set", set_type: "core", card_count: 100, digital: true, released_at: "2023-01-01", icon_svg_uri: "", search_uri: "", scryfall_uri: "", uri: "", id: "set-3" },
      { object: "set", code: "tmem", name: "Memorabilia", set_type: "memorabilia", card_count: 50, digital: false, released_at: "2020-01-01", icon_svg_uri: "", search_uri: "", scryfall_uri: "", uri: "", id: "set-4" },
    ]),
    getSet: vi.fn().mockResolvedValue({ card_count: 249 }),
  })),
  BulkDataManager: vi.fn(),
  retailPaperFilter: vi.fn(),
}));

// Mock the job processor
vi.mock("@/modules/import/job-processor", () => ({
  JobProcessor: vi.fn().mockImplementation(() => ({
    processJob: vi.fn().mockResolvedValue({ cardsProcessed: 10, variantsCreated: 50, errors: 0, errorLog: [] }),
    cancel: vi.fn(),
  })),
}));

// Import after mocks
import { jobsRouter, setsRouter } from "@/modules/trpc/import-router";

// --- Helper to call router procedures directly ---

function createMockContext(overrides: Record<string, any> = {}) {
  return {
    installationId: "inst-1",
    saleorApiUrl: "https://api.test.saleor.cloud/graphql/",
    appToken: "test-app-token",
    appId: "app-1",
    token: "mock-jwt-token",
    apiClient: {} as any,
    prisma: {
      appInstallation: {
        findUnique: vi.fn().mockResolvedValue({
          id: "inst-1",
          saleorApiUrl: "https://api.test.saleor.cloud/graphql/",
          appId: "app-1",
        }),
      },
      importJob: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation((args: any) => Promise.resolve({
          id: "new-job-id",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        update: vi.fn().mockResolvedValue({}),
      },
      importedProduct: {
        create: vi.fn(),
      },
      setAudit: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
    ...overrides,
  };
}

describe("jobsRouter", () => {
  describe("jobs.list", () => {
    it("returns paginated jobs", async () => {
      const mockJobs = [
        { id: TEST_UUID_1, type: "SET", status: "COMPLETED", setCode: "m11" },
        { id: TEST_UUID_2, type: "BULK", status: "RUNNING", setCode: null },
      ];
      const ctx = createMockContext();
      ctx.prisma.importJob.findMany.mockResolvedValue(mockJobs);

      const result = await jobsRouter.createCaller(ctx as any).list({ limit: 20 });

      expect(result.jobs).toHaveLength(2);
      expect(ctx.prisma.importJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ installationId: "inst-1" }),
          take: 20,
        })
      );
    });

    it("filters by status when provided", async () => {
      const ctx = createMockContext();
      ctx.prisma.importJob.findMany.mockResolvedValue([]);

      await jobsRouter.createCaller(ctx as any).list({ status: "RUNNING", limit: 10 });

      expect(ctx.prisma.importJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "RUNNING" }),
        })
      );
    });
  });

  describe("jobs.get", () => {
    it("returns job with imported products", async () => {
      const mockJob = {
        id: TEST_UUID_1,
        installationId: "inst-1",
        type: "SET",
        status: "COMPLETED",
        importedProducts: [{ id: "ip1", cardName: "Lightning Bolt" }],
        _count: { importedProducts: 1 },
      };
      const ctx = createMockContext();
      ctx.prisma.importJob.findFirst.mockResolvedValue(mockJob);

      const result = await jobsRouter.createCaller(ctx as any).get({ id: TEST_UUID_1 });

      expect(result.id).toBe(TEST_UUID_1);
      expect(result.importedProducts).toHaveLength(1);
    });

    it("throws NOT_FOUND for missing job", async () => {
      const ctx = createMockContext();
      ctx.prisma.importJob.findFirst.mockResolvedValue(null);

      await expect(
        jobsRouter.createCaller(ctx as any).get({ id: TEST_UUID_1 })
      ).rejects.toThrow("Import job not found");
    });
  });

  describe("jobs.create", () => {
    it("requires setCode for SET type", async () => {
      const ctx = createMockContext();

      await expect(
        jobsRouter.createCaller(ctx as any).create({ type: "SET", priority: 2 })
      ).rejects.toThrow("setCode is required");
    });

    it("creates job with lowercase setCode", async () => {
      const ctx = createMockContext();
      ctx.prisma.importJob.findFirst.mockResolvedValue(null); // No duplicates

      await jobsRouter.createCaller(ctx as any).create({
        type: "SET",
        setCode: "M11",
        priority: 2,
      });

      expect(ctx.prisma.importJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ setCode: "m11" }),
        })
      );
    });

    it("rejects duplicate running job", async () => {
      const ctx = createMockContext();
      ctx.prisma.importJob.findFirst.mockResolvedValue({
        id: "existing",
        status: "RUNNING",
        type: "SET",
        setCode: "m11",
      });

      await expect(
        jobsRouter.createCaller(ctx as any).create({ type: "SET", setCode: "m11", priority: 2 })
      ).rejects.toThrow("already");
    });

    it("allows creating job when no duplicates", async () => {
      const ctx = createMockContext();
      ctx.prisma.importJob.findFirst.mockResolvedValue(null);

      await jobsRouter.createCaller(ctx as any).create({
        type: "BULK",
        priority: 1,
      });

      expect(ctx.prisma.importJob.create).toHaveBeenCalled();
    });
  });

  describe("jobs.cancel", () => {
    it("cancels a running job", async () => {
      const ctx = createMockContext();
      ctx.prisma.importJob.findFirst.mockResolvedValue({
        id: TEST_UUID_1,
        installationId: "inst-1",
        status: "RUNNING",
      });

      const result = await jobsRouter.createCaller(ctx as any).cancel({ id: TEST_UUID_1 });

      expect(result.success).toBe(true);
      expect(ctx.prisma.importJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "CANCELLED" },
        })
      );
    });

    it("rejects cancelling a completed job", async () => {
      const ctx = createMockContext();
      ctx.prisma.importJob.findFirst.mockResolvedValue({
        id: TEST_UUID_1,
        installationId: "inst-1",
        status: "COMPLETED",
      });

      await expect(
        jobsRouter.createCaller(ctx as any).cancel({ id: TEST_UUID_1 })
      ).rejects.toThrow("Cannot cancel");
    });

    it("throws NOT_FOUND for missing job", async () => {
      const ctx = createMockContext();
      ctx.prisma.importJob.findFirst.mockResolvedValue(null);

      await expect(
        jobsRouter.createCaller(ctx as any).cancel({ id: TEST_UUID_1 })
      ).rejects.toThrow("Import job not found");
    });
  });

  describe("jobs.retry", () => {
    it("creates new job from failed job with checkpoint", async () => {
      const ctx = createMockContext();
      ctx.prisma.importJob.findFirst.mockResolvedValue({
        id: TEST_UUID_1,
        installationId: "inst-1",
        type: "SET",
        status: "FAILED",
        priority: 1,
        setCode: "m11",
        cardsTotal: 249,
        lastCheckpoint: "150",
      });

      await jobsRouter.createCaller(ctx as any).retry({ id: TEST_UUID_1 });

      expect(ctx.prisma.importJob.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "SET",
            status: "PENDING",
            setCode: "m11",
            lastCheckpoint: "150",
          }),
        })
      );
    });

    it("rejects retrying a running job", async () => {
      const ctx = createMockContext();
      ctx.prisma.importJob.findFirst.mockResolvedValue({
        id: TEST_UUID_1,
        installationId: "inst-1",
        status: "RUNNING",
      });

      await expect(
        jobsRouter.createCaller(ctx as any).retry({ id: TEST_UUID_1 })
      ).rejects.toThrow("Can only retry");
    });
  });
});

describe("setsRouter", () => {
  describe("sets.list", () => {
    it("returns filtered non-digital importable sets", async () => {
      const ctx = createMockContext();

      const result = await setsRouter.createCaller(ctx as any).list();

      // Should exclude digital set (ydmu) and memorabilia set (tmem)
      expect(result.every((s: any) => !s.digital)).toBe(true);
      expect(result.every((s: any) => ["core", "expansion", "masters", "draft_innovation", "commander", "starter", "funny"].includes(s.set_type))).toBe(true);
    });

    it("sorts by release date descending", async () => {
      const ctx = createMockContext();

      const result = await setsRouter.createCaller(ctx as any).list();

      // m11 (2010) should come before lea (1993)
      const codes = result.map((s: any) => s.code);
      const m11Idx = codes.indexOf("m11");
      const leaIdx = codes.indexOf("lea");
      expect(m11Idx).toBeLessThan(leaIdx);
    });
  });

  describe("sets.importStatus", () => {
    it("returns set audit data", async () => {
      const mockAudits = [
        { id: "a1", setCode: "m11", totalCards: 249, importedCards: 249, lastImportedAt: new Date() },
      ];
      const ctx = createMockContext();
      ctx.prisma.setAudit.findMany.mockResolvedValue(mockAudits);

      const result = await setsRouter.createCaller(ctx as any).importStatus();

      expect(result).toHaveLength(1);
      expect(result[0].setCode).toBe("m11");
    });
  });
});
