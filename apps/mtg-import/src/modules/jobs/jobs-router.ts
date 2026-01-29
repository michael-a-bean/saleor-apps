import { JobStatus, JobType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

import { PrismaQueueService } from "./prisma-queue-service";
import { JobConfig } from "./queue-service";

export const jobsRouter = router({
  /**
   * List jobs with filtering
   */
  list: protectedClientProcedure
    .input(
      z.object({
        status: z.nativeEnum(JobStatus).optional(),
        jobType: z.nativeEnum(JobType).optional(),
        limit: z.number().min(1).max(100).optional().default(50),
        offset: z.number().min(0).optional().default(0),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const queueService = new PrismaQueueService(ctx.prisma);

      const jobs = await queueService.listJobs(ctx.installationId, {
        status: input?.status,
        jobType: input?.jobType,
        limit: input?.limit,
        offset: input?.offset,
      });

      const total = await ctx.prisma.importJob.count({
        where: {
          installationId: ctx.installationId,
          ...(input?.status && { status: input.status }),
          ...(input?.jobType && { jobType: input.jobType }),
        },
      });

      return { jobs, total };
    }),

  /**
   * Get a specific job by ID
   */
  getById: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const queueService = new PrismaQueueService(ctx.prisma);

      const job = await queueService.getJob(input.id);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      return job;
    }),

  /**
   * Create a new job
   */
  create: protectedClientProcedure
    .input(
      z.object({
        jobType: z.nativeEnum(JobType),
        priority: z.number().min(0).max(10).optional().default(1),
        config: z.object({
          setCode: z.string().optional(),
          setName: z.string().optional(),
          fromCheckpoint: z.boolean().optional(),
          auditType: z.enum(["set", "collection", "attribute", "variant"]).optional(),
          auditQuery: z.string().optional(),
          auditId: z.string().optional(),
          fixMissingCards: z.boolean().optional(),
          fixMissingVariants: z.boolean().optional(),
          fixPricingGaps: z.boolean().optional(),
        }).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const queueService = new PrismaQueueService(ctx.prisma);

      const jobId = await queueService.createJob({
        installationId: ctx.installationId,
        jobType: input.jobType,
        priority: input.priority,
        config: input.config as JobConfig,
      });

      return { jobId };
    }),

  /**
   * Cancel a pending or running job
   */
  cancel: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const queueService = new PrismaQueueService(ctx.prisma);

      const job = await queueService.getJob(input.id);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot cancel a completed or failed job",
        });
      }

      await queueService.cancelJob(input.id);

      return { success: true };
    }),

  /**
   * Get job statistics
   */
  stats: protectedClientProcedure.query(async ({ ctx }) => {
    const stats = await ctx.prisma.importJob.groupBy({
      by: ["status"],
      where: { installationId: ctx.installationId },
      _count: { id: true },
    });

    const result: Record<string, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const stat of stats) {
      result[stat.status.toLowerCase()] = stat._count.id;
    }

    return result;
  }),

  /**
   * Get recent job logs
   */
  getLogs: protectedClientProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        limit: z.number().min(1).max(500).optional().default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const queueService = new PrismaQueueService(ctx.prisma);

      const job = await queueService.getJob(input.id);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      // Return most recent logs
      const logs = job.logs.slice(-input.limit);

      return { logs };
    }),
});
