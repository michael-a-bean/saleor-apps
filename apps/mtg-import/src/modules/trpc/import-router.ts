/**
 * tRPC router for import job management.
 *
 * Endpoints:
 * - jobs.list — List jobs with pagination and filtering
 * - jobs.get — Get a single job by ID
 * - jobs.create — Create a new import job (set import or bulk)
 * - jobs.cancel — Cancel a running job
 * - jobs.retry — Retry a failed job
 * - sets.list — List available sets from Scryfall
 * - sets.importStatus — Get import status for sets
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { ImportJobStatus, ImportJobType } from "@prisma/client";

import { createLogger } from "@/lib/logger";
import { env } from "@/lib/env";
import { ScryfallClient, BulkDataManager } from "../scryfall";
import { JobProcessor } from "../import/job-processor";
import { MtgjsonBulkDataManager } from "../mtgjson";
import { protectedClientProcedure } from "./protected-client-procedure";
import { router } from "./trpc-server";

const logger = createLogger("ImportRouter");

// Shared Scryfall client (singleton per process)
let scryfallClient: ScryfallClient | null = null;
function getScryfallClient(): ScryfallClient {
  if (!scryfallClient) {
    scryfallClient = new ScryfallClient({
      contactEmail: env.SCRYFALL_CONTACT_EMAIL,
    });
  }
  return scryfallClient;
}

// Active processors (for cancellation)
const activeProcessors = new Map<string, JobProcessor>();

// --- Jobs Router ---

const jobsRouter = router({
  /** List import jobs with optional filtering */
  list: protectedClientProcedure
    .input(
      z.object({
        status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]).optional(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const where = {
        installationId: ctx.installationId,
        ...(input?.status && { status: input.status }),
      };

      const jobs = await ctx.prisma.importJob.findMany({
        where,
        orderBy: [
          { status: "asc" },
          { priority: "asc" },
          { createdAt: "desc" },
        ],
        take: input?.limit ?? 20,
        ...(input?.cursor && {
          skip: 1,
          cursor: { id: input.cursor },
        }),
      });

      return {
        jobs,
        nextCursor: jobs.length > 0 ? jobs[jobs.length - 1].id : undefined,
      };
    }),

  /** Get a single job with its imported products */
  get: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const job = await ctx.prisma.importJob.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
        include: {
          importedProducts: {
            take: 50,
            orderBy: { createdAt: "desc" },
          },
          _count: {
            select: { importedProducts: true },
          },
        },
      });

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Import job not found" });
      }

      return job;
    }),

  /** Create a new import job */
  create: protectedClientProcedure
    .input(
      z.object({
        type: z.enum(["SET", "BULK", "BACKFILL"]),
        setCode: z.string().min(2).max(10).optional(),
        priority: z.number().min(0).max(2).default(2),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Validate: SET type requires setCode
      if (input.type === "SET" && !input.setCode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "setCode is required for SET import type",
        });
      }

      // Check for existing running/pending jobs with same parameters
      const existing = await ctx.prisma.importJob.findFirst({
        where: {
          installationId: ctx.installationId,
          status: { in: ["PENDING", "RUNNING"] },
          type: input.type as ImportJobType,
          ...(input.setCode && { setCode: input.setCode.toLowerCase() }),
        },
      });

      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A ${input.type} job for ${input.setCode ?? "all sets"} is already ${existing.status.toLowerCase()}`,
        });
      }

      // Get card count for SET imports
      let cardsTotal = 0;
      if (input.type === "SET" && input.setCode) {
        try {
          const set = await getScryfallClient().getSet(input.setCode.toLowerCase());
          cardsTotal = set.card_count;
        } catch {
          // Non-fatal: we'll discover the count during processing
        }
      }

      const job = await ctx.prisma.importJob.create({
        data: {
          installationId: ctx.installationId,
          type: input.type as ImportJobType,
          status: "PENDING",
          priority: input.priority,
          setCode: input.setCode?.toLowerCase() ?? null,
          cardsTotal,
        },
      });

      logger.info("Import job created", {
        jobId: job.id,
        type: job.type,
        setCode: job.setCode,
        priority: job.priority,
      });

      // Start processing asynchronously (fire and forget)
      void startJobProcessing(job.id, ctx.prisma, ctx.apiClient!);

      return job;
    }),

  /** Cancel a running job */
  cancel: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.prisma.importJob.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
      });

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Import job not found" });
      }

      if (job.status !== "RUNNING" && job.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot cancel a ${job.status.toLowerCase()} job`,
        });
      }

      // Signal abort to active processor
      const processor = activeProcessors.get(job.id);
      if (processor) {
        processor.cancel();
        activeProcessors.delete(job.id);
      }

      await ctx.prisma.importJob.update({
        where: { id: job.id },
        data: { status: "CANCELLED" },
      });

      logger.info("Import job cancelled", { jobId: job.id });
      return { success: true };
    }),

  /** Retry a failed job (creates a new job with resume from checkpoint) */
  retry: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const originalJob = await ctx.prisma.importJob.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
      });

      if (!originalJob) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Import job not found" });
      }

      if (originalJob.status !== "FAILED" && originalJob.status !== "CANCELLED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Can only retry failed or cancelled jobs`,
        });
      }

      // Create new job resuming from the original's checkpoint
      const retryJob = await ctx.prisma.importJob.create({
        data: {
          installationId: ctx.installationId,
          type: originalJob.type,
          status: "PENDING",
          priority: originalJob.priority,
          setCode: originalJob.setCode,
          cardsTotal: originalJob.cardsTotal,
          lastCheckpoint: originalJob.lastCheckpoint,
        },
      });

      logger.info("Import job retry created", {
        originalJobId: originalJob.id,
        retryJobId: retryJob.id,
        checkpoint: retryJob.lastCheckpoint,
      });

      void startJobProcessing(retryJob.id, ctx.prisma, ctx.apiClient!);

      return retryJob;
    }),
});

// --- Sets Router ---

const setsRouter = router({
  /** List available sets from Scryfall */
  list: protectedClientProcedure.query(async () => {
    const sets = await getScryfallClient().listSets();
    // Filter to relevant set types and sort by release date
    const importable = sets
      .filter((s) => !s.digital)
      .filter((s) =>
        ["core", "expansion", "masters", "draft_innovation", "commander", "starter", "funny"].includes(s.set_type)
      )
      .sort((a, b) => {
        const dateA = a.released_at ?? "";
        const dateB = b.released_at ?? "";
        return dateB.localeCompare(dateA);
      });

    return importable;
  }),

  /** Get import status for sets we've imported */
  importStatus: protectedClientProcedure.query(async ({ ctx }) => {
    const audits = await ctx.prisma.setAudit.findMany({
      where: { installationId: ctx.installationId },
      orderBy: { lastImportedAt: "desc" },
    });
    return audits;
  }),

  /** Verify a specific set's import completeness */
  verify: protectedClientProcedure
    .input(z.object({ setCode: z.string().min(2).max(10) }))
    .query(async ({ ctx, input }) => {
      const setCode = input.setCode.toLowerCase();

      // Get Scryfall set info for reference count
      let scryfallTotal = 0;
      let setName = setCode.toUpperCase();
      try {
        const scryfallSet = await getScryfallClient().getSet(setCode);
        scryfallTotal = scryfallSet.card_count;
        setName = scryfallSet.name;
      } catch {
        // If Scryfall unavailable, use our stored total
      }

      // Get our audit record
      const audit = await ctx.prisma.setAudit.findUnique({
        where: {
          installationId_setCode: {
            installationId: ctx.installationId,
            setCode,
          },
        },
      });

      // Count imported products by status
      const [successCount, duplicateCount, failedCount] = await Promise.all([
        ctx.prisma.importedProduct.count({
          where: { setCode, success: true, saleorProductId: { not: "existing" } },
        }),
        ctx.prisma.importedProduct.count({
          where: { setCode, success: true, saleorProductId: "existing" },
        }),
        ctx.prisma.importedProduct.count({
          where: { setCode, success: false },
        }),
      ]);

      const totalImported = successCount + duplicateCount;
      const totalFromScryfall = scryfallTotal || audit?.totalCards || 0;
      const completeness = totalFromScryfall > 0
        ? Math.round((totalImported / totalFromScryfall) * 100)
        : 0;

      return {
        setCode,
        setName,
        scryfallTotal: totalFromScryfall,
        imported: totalImported,
        newlyCreated: successCount,
        alreadyExisted: duplicateCount,
        failed: failedCount,
        completeness,
        lastImportedAt: audit?.lastImportedAt ?? null,
      };
    }),
});

// --- Background job processing ---

async function startJobProcessing(
  jobId: string,
  prisma: PrismaClient,
  gqlClient: Client
): Promise<void> {
  try {
    // Pick next job by priority (FIFO within same priority)
    const job = await prisma.importJob.findFirst({
      where: {
        id: jobId,
        status: "PENDING",
      },
    });

    if (!job) {
      logger.warn("Job not found or already started", { jobId });
      return;
    }

    const client = getScryfallClient();
    const bulkData = new BulkDataManager({ client });
    const mtgjsonBulk = new MtgjsonBulkDataManager();

    const processor = new JobProcessor({
      scryfallClient: client,
      bulkDataManager: bulkData,
      mtgjsonBulkManager: mtgjsonBulk,
      prisma,
      gqlClient,
    });

    activeProcessors.set(jobId, processor);

    try {
      await processor.processJob(job);
    } finally {
      activeProcessors.delete(jobId);
    }
  } catch (err) {
    logger.error("Failed to start job processing", {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Import PrismaClient and Client types
import type { PrismaClient } from "@prisma/client";
import type { Client } from "urql";

export { jobsRouter, setsRouter };
