import { JobStatus, JobType, PrismaClient } from "@prisma/client";

import { createLogger } from "@/lib/logger";

import {
  CreateJobInput,
  JobCheckpoint,
  JobConfig,
  JobLogEntry,
  QueueService,
  UpdateJobInput,
} from "./queue-service";

const logger = createLogger("prisma-queue-service");

/**
 * Prisma-based implementation of QueueService
 * Uses PostgreSQL as the queue backend
 */
export class PrismaQueueService implements QueueService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async createJob(input: CreateJobInput): Promise<string> {
    logger.info("Creating job", {
      installationId: input.installationId,
      jobType: input.jobType,
      priority: input.priority,
    });

    const job = await this.prisma.importJob.create({
      data: {
        installationId: input.installationId,
        jobType: input.jobType,
        priority: input.priority ?? 1,
        totalItems: input.totalItems,
        config: input.config ? JSON.parse(JSON.stringify(input.config)) : undefined,
        status: JobStatus.PENDING,
      },
    });

    logger.info("Job created", { jobId: job.id });

    return job.id;
  }

  async getNextPendingJob(installationId: string): Promise<string | null> {
    // Get the next pending job with lowest priority number (0 = highest priority)
    const job = await this.prisma.importJob.findFirst({
      where: {
        installationId,
        status: JobStatus.PENDING,
      },
      orderBy: [
        { priority: "asc" },  // Lower priority number = higher priority
        { createdAt: "asc" }, // FIFO within same priority
      ],
      select: { id: true },
    });

    return job?.id ?? null;
  }

  async claimJob(jobId: string): Promise<boolean> {
    try {
      // Use optimistic locking - only update if still PENDING
      const result = await this.prisma.importJob.updateMany({
        where: {
          id: jobId,
          status: JobStatus.PENDING,
        },
        data: {
          status: JobStatus.RUNNING,
          startedAt: new Date(),
        },
      });

      const claimed = result.count > 0;

      if (claimed) {
        logger.info("Job claimed", { jobId });
      } else {
        logger.warn("Failed to claim job (already taken or not pending)", { jobId });
      }

      return claimed;
    } catch (error) {
      logger.error("Error claiming job", { jobId, error });
      return false;
    }
  }

  async updateJob(jobId: string, input: UpdateJobInput): Promise<void> {
    const updateData: Record<string, unknown> = {};

    if (input.status !== undefined) {
      updateData.status = input.status;
    }
    if (input.progress !== undefined) {
      updateData.progress = input.progress;
    }
    if (input.totalItems !== undefined) {
      updateData.totalItems = input.totalItems;
    }
    if (input.checkpoint !== undefined) {
      updateData.checkpoint = input.checkpoint;
    }
    if (input.error !== undefined) {
      updateData.error = input.error;
    }
    if (input.errorCount !== undefined) {
      updateData.errorCount = input.errorCount;
    }

    await this.prisma.importJob.update({
      where: { id: jobId },
      data: updateData,
    });
  }

  async completeJob(jobId: string): Promise<void> {
    logger.info("Completing job", { jobId });

    await this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: JobStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    logger.info("Job completed", { jobId });
  }

  async failJob(jobId: string, error: string): Promise<void> {
    logger.error("Failing job", { jobId, error });

    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
      select: { errorCount: true },
    });

    await this.prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: JobStatus.FAILED,
        error,
        errorCount: (job?.errorCount ?? 0) + 1,
        completedAt: new Date(),
      },
    });
  }

  async cancelJob(jobId: string): Promise<void> {
    logger.info("Cancelling job", { jobId });

    await this.prisma.importJob.updateMany({
      where: {
        id: jobId,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
      },
      data: {
        status: JobStatus.CANCELLED,
        completedAt: new Date(),
      },
    });
  }

  async addJobLog(jobId: string, entry: JobLogEntry): Promise<void> {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
      select: { logs: true },
    });

    const existingLogs = (job?.logs ?? []) as unknown as JobLogEntry[];
    const updatedLogs = [...existingLogs, entry];

    // Keep only last 1000 log entries to prevent unbounded growth
    const trimmedLogs = updatedLogs.slice(-1000);

    await this.prisma.importJob.update({
      where: { id: jobId },
      data: { logs: JSON.parse(JSON.stringify(trimmedLogs)) },
    });
  }

  async getJob(jobId: string) {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
    });

    if (!job) return null;

    return {
      id: job.id,
      jobType: job.jobType,
      status: job.status,
      priority: job.priority,
      progress: job.progress,
      totalItems: job.totalItems,
      checkpoint: job.checkpoint as JobCheckpoint | null,
      config: job.config as JobConfig | null,
      error: job.error,
      errorCount: job.errorCount,
      logs: (job.logs ?? []) as unknown as JobLogEntry[],
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  }

  async listJobs(
    installationId: string,
    options?: {
      status?: JobStatus;
      jobType?: JobType;
      limit?: number;
      offset?: number;
    }
  ) {
    const where: Record<string, unknown> = { installationId };

    if (options?.status) {
      where.status = options.status;
    }
    if (options?.jobType) {
      where.jobType = options.jobType;
    }

    const jobs = await this.prisma.importJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
      select: {
        id: true,
        jobType: true,
        status: true,
        priority: true,
        progress: true,
        totalItems: true,
        error: true,
        createdAt: true,
        completedAt: true,
      },
    });

    return jobs;
  }
}
