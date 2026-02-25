import { describe, expect, it, vi, beforeEach } from "vitest";

import { recoverOrphanedJobs } from "@/modules/import/orphan-recovery";

const mockPrisma = {
  importJob: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
} as any;

describe("recoverOrphanedJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty result when no orphaned jobs exist", async () => {
    mockPrisma.importJob.findMany.mockResolvedValue([]);

    const result = await recoverOrphanedJobs(mockPrisma, 10);

    expect(result).toEqual({ recovered: [], count: 0 });
    expect(mockPrisma.importJob.updateMany).not.toHaveBeenCalled();
  });

  it("marks a single stale RUNNING job as FAILED", async () => {
    const staleJob = {
      id: "job-1",
      setCode: "mh3",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    mockPrisma.importJob.findMany.mockResolvedValue([staleJob]);
    mockPrisma.importJob.updateMany.mockResolvedValue({ count: 1 });

    const result = await recoverOrphanedJobs(mockPrisma, 10);

    expect(result.count).toBe(1);
    expect(result.recovered[0].id).toBe("job-1");
    expect(result.recovered[0].setCode).toBe("mh3");

    expect(mockPrisma.importJob.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["job-1"] } },
      data: {
        status: "FAILED",
        errorMessage: expect.stringContaining("Orphaned"),
      },
    });
  });

  it("marks multiple stale jobs as FAILED in a single updateMany", async () => {
    const staleJobs = [
      { id: "job-1", setCode: "mh3", updatedAt: new Date("2026-01-01") },
      { id: "job-2", setCode: null, updatedAt: new Date("2026-01-01") },
      { id: "job-3", setCode: "dsk", updatedAt: new Date("2026-01-01") },
    ];
    mockPrisma.importJob.findMany.mockResolvedValue(staleJobs);
    mockPrisma.importJob.updateMany.mockResolvedValue({ count: 3 });

    const result = await recoverOrphanedJobs(mockPrisma, 10);

    expect(result.count).toBe(3);
    expect(mockPrisma.importJob.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["job-1", "job-2", "job-3"] } },
      data: expect.objectContaining({ status: "FAILED" }),
    });
  });

  it("queries with correct threshold cutoff", async () => {
    mockPrisma.importJob.findMany.mockResolvedValue([]);

    const before = Date.now();
    await recoverOrphanedJobs(mockPrisma, 15);
    const after = Date.now();

    const call = mockPrisma.importJob.findMany.mock.calls[0][0];
    expect(call.where.status).toBe("RUNNING");

    const cutoff = call.where.updatedAt.lt.getTime();
    // cutoff should be ~15 minutes before now
    const expectedMin = before - 15 * 60 * 1000 - 100; // small tolerance
    const expectedMax = after - 15 * 60 * 1000 + 100;
    expect(cutoff).toBeGreaterThanOrEqual(expectedMin);
    expect(cutoff).toBeLessThanOrEqual(expectedMax);
  });

  it("error message mentions threshold and checkpoint preservation", async () => {
    const staleJob = {
      id: "job-1",
      setCode: "mh3",
      updatedAt: new Date("2026-01-01"),
    };
    mockPrisma.importJob.findMany.mockResolvedValue([staleJob]);
    mockPrisma.importJob.updateMany.mockResolvedValue({ count: 1 });

    await recoverOrphanedJobs(mockPrisma, 10);

    const errorMessage = mockPrisma.importJob.updateMany.mock.calls[0][0].data.errorMessage;
    expect(errorMessage).toContain("10+ minutes");
    expect(errorMessage).toContain("Checkpoint preserved");
  });
});
