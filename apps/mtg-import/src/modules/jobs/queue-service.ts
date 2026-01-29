import { JobStatus, JobType } from "@prisma/client";

/**
 * Job configuration for different job types
 */
export interface JobConfig {
  // For NEW_SET jobs
  setCode?: string;
  setName?: string;

  // For BULK_IMPORT jobs
  fromCheckpoint?: boolean;

  // For AUDIT jobs
  auditType?: "set" | "collection" | "attribute" | "variant";
  auditQuery?: string;

  // For REMEDIATION jobs
  auditId?: string;
  fixMissingCards?: boolean;
  fixMissingVariants?: boolean;
  fixPricingGaps?: boolean;
}

/**
 * Job checkpoint data for resume capability
 */
export interface JobCheckpoint {
  lastProcessedIndex?: number;
  lastProcessedSetCode?: string;
  lastProcessedScryfallId?: string;
  processedCount?: number;
  errorCount?: number;
  lastError?: string;
}

/**
 * Job log entry
 */
export interface JobLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Job creation input
 */
export interface CreateJobInput {
  installationId: string;
  jobType: JobType;
  priority?: number;
  totalItems?: number;
  config?: JobConfig;
}

/**
 * Job update input
 */
export interface UpdateJobInput {
  status?: JobStatus;
  progress?: number;
  totalItems?: number;
  checkpoint?: JobCheckpoint;
  error?: string;
  errorCount?: number;
}

/**
 * Queue Service Interface
 * Allows future swap to BullMQ without changing consumer code
 */
export interface QueueService {
  /**
   * Create a new job
   */
  createJob(input: CreateJobInput): Promise<string>;

  /**
   * Get the next pending job (respects priority)
   */
  getNextPendingJob(installationId: string): Promise<string | null>;

  /**
   * Claim a job (mark as RUNNING)
   */
  claimJob(jobId: string): Promise<boolean>;

  /**
   * Update job progress and checkpoint
   */
  updateJob(jobId: string, input: UpdateJobInput): Promise<void>;

  /**
   * Complete a job successfully
   */
  completeJob(jobId: string): Promise<void>;

  /**
   * Fail a job with error
   */
  failJob(jobId: string, error: string): Promise<void>;

  /**
   * Cancel a pending job
   */
  cancelJob(jobId: string): Promise<void>;

  /**
   * Add a log entry to a job
   */
  addJobLog(jobId: string, entry: JobLogEntry): Promise<void>;

  /**
   * Get job by ID
   */
  getJob(jobId: string): Promise<{
    id: string;
    jobType: JobType;
    status: JobStatus;
    priority: number;
    progress: number;
    totalItems: number | null;
    checkpoint: JobCheckpoint | null;
    config: JobConfig | null;
    error: string | null;
    errorCount: number;
    logs: JobLogEntry[];
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  } | null>;

  /**
   * List jobs for an installation
   */
  listJobs(
    installationId: string,
    options?: {
      status?: JobStatus;
      jobType?: JobType;
      limit?: number;
      offset?: number;
    }
  ): Promise<Array<{
    id: string;
    jobType: JobType;
    status: JobStatus;
    priority: number;
    progress: number;
    totalItems: number | null;
    error: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }>>;
}
