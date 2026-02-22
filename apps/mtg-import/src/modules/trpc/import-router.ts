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
import type { ImportJobStatus, ImportJobType } from "@/generated/prisma";

import { createLogger } from "@/lib/logger";
import { env } from "@/lib/env";
import { ScryfallClient, BulkDataManager, retailPaperFilter } from "../scryfall";
import { JobProcessor } from "../import/job-processor";
import { ATTRIBUTE_DEFS } from "../import/attribute-map";
import { SaleorImportClient } from "../saleor";
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
      // Validate: SET type requires setCode; BACKFILL is optional (omit = full scan)
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

      // Pre-flight validation: ensure Saleor is configured with current settings
      const settings = await ctx.prisma.importSettings.findUnique({
        where: { installationId: ctx.installationId },
      });
      const saleor = new SaleorImportClient(ctx.apiClient!);
      try {
        await saleor.resolveImportContext(
          settings?.channelSlugs ?? ["webstore", "singles-builder"],
          settings?.productTypeSlug ?? "mtg-card",
          settings?.categorySlug ?? "mtg-singles",
          settings?.warehouseSlugs ?? [],
        );
      } catch (err) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Saleor is not properly configured for imports: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Get card count for SET/BACKFILL imports (also validates the set code)
      let cardsTotal = 0;
      if ((input.type === "SET" || input.type === "BACKFILL") && input.setCode) {
        try {
          const set = await getScryfallClient().getSet(input.setCode.toLowerCase());
          cardsTotal = set.card_count;
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Set "${input.setCode}" not found on Scryfall`,
          });
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

  /** Create batch backfill jobs for multiple sets */
  createBatch: protectedClientProcedure
    .input(
      z.object({
        setCodes: z.array(z.string().min(2).max(10)).min(1).max(50),
        priority: z.number().min(0).max(2).default(2),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const jobs = [];
      for (const code of input.setCodes) {
        const setCode = code.toLowerCase();

        // Skip if already running/pending
        const existing = await ctx.prisma.importJob.findFirst({
          where: {
            installationId: ctx.installationId,
            status: { in: ["PENDING", "RUNNING"] },
            setCode,
          },
        });
        if (existing) continue;

        let cardsTotal = 0;
        try {
          const set = await getScryfallClient().getSet(setCode);
          cardsTotal = set.card_count;
        } catch {
          // continue with 0
        }

        const job = await ctx.prisma.importJob.create({
          data: {
            installationId: ctx.installationId,
            type: "BACKFILL" as ImportJobType,
            status: "PENDING",
            priority: input.priority,
            setCode,
            cardsTotal,
          },
        });

        void startJobProcessing(job.id, ctx.prisma, ctx.apiClient!);
        jobs.push(job);
      }

      logger.info("Batch jobs created", { count: jobs.length, setCodes: input.setCodes });
      return { created: jobs.length, jobs };
    }),
});

// --- Sets Router ---

const setsRouter = router({
  /** List available sets from Scryfall (filtered by configured set types) */
  list: protectedClientProcedure.query(async ({ ctx }) => {
    const defaultSetTypes = ["core", "expansion", "masters", "draft_innovation", "commander", "starter", "funny"];

    // Load importable set types from settings (if configured)
    const settings = await ctx.prisma.importSettings.findUnique({
      where: { installationId: ctx.installationId },
      select: { importableSetTypes: true },
    });
    const setTypes = settings?.importableSetTypes?.length ? settings.importableSetTypes : defaultSetTypes;

    const sets = await getScryfallClient().listSets();
    const importable = sets
      .filter((s) => !s.digital)
      .filter((s) => setTypes.includes(s.set_type))
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
  /** Scan a set for missing/failed cards vs Scryfall */
  scan: protectedClientProcedure
    .input(z.object({ setCode: z.string().min(2).max(10) }))
    .query(async ({ ctx, input }) => {
      const setCode = input.setCode.toLowerCase();
      logger.info("Scan started", { setCode });

      // Get set metadata from Scryfall
      let setName = setCode.toUpperCase();
      try {
        const scryfallSet = await getScryfallClient().getSet(setCode);
        setName = scryfallSet.name;
      } catch {
        // Will still scan via search API
      }

      // Get all ImportedProduct records for this set
      const imported = await ctx.prisma.importedProduct.findMany({
        where: { setCode },
        select: {
          scryfallId: true,
          success: true,
          errorMessage: true,
          cardName: true,
          collectorNumber: true,
          rarity: true,
        },
      });

      const successfulIds = new Set<string>();
      const failedCards: Array<{
        scryfallId: string;
        name: string;
        collectorNumber: string;
        rarity: string;
        errorMessage: string | null;
      }> = [];

      for (const record of imported) {
        if (record.success) {
          successfulIds.add(record.scryfallId);
        } else {
          failedCards.push({
            scryfallId: record.scryfallId,
            name: record.cardName,
            collectorNumber: record.collectorNumber,
            rarity: record.rarity,
            errorMessage: record.errorMessage,
          });
        }
      }

      // Search Scryfall for all cards in this set (paginated API, much faster than bulk data)
      const client = getScryfallClient();
      const missingCards: Array<{
        scryfallId: string;
        name: string;
        collectorNumber: string;
        rarity: string;
      }> = [];
      let scryfallTotal = 0;

      try {
        for await (const card of client.searchAll(`set:${setCode}`, { unique: "prints" })) {
          if (!retailPaperFilter(card)) continue;
          scryfallTotal++;

          if (!successfulIds.has(card.id)) {
            // Check if it's already in the failed list
            const alreadyFailed = failedCards.some((f) => f.scryfallId === card.id);
            if (!alreadyFailed) {
              missingCards.push({
                scryfallId: card.id,
                name: card.name,
                collectorNumber: card.collector_number,
                rarity: card.rarity,
              });
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Unable to scan: Scryfall API unavailable. ${msg}`,
        });
      }

      logger.info("Scan complete", {
        setCode,
        scryfallTotal,
        importedCount: successfulIds.size,
        missingCount: missingCards.length,
        failedCount: failedCards.length,
      });

      return {
        setCode,
        setName,
        scannedAt: new Date().toISOString(),
        scryfallTotal,
        importedCount: successfulIds.size,
        missingCount: missingCards.length,
        failedCount: failedCards.length,
        missingCards,
        failedCards,
      };
    }),

  /** Audit product attributes against expected attribute definitions */
  auditAttributes: protectedClientProcedure
    .input(z.object({ setCode: z.string().min(2).max(10) }))
    .query(async ({ ctx, input }) => {
      const setCode = input.setCode.toLowerCase();
      const saleor = new SaleorImportClient(ctx.apiClient!);

      const products = await saleor.getProductsBySetCode(setCode);
      const expectedSlugs = ATTRIBUTE_DEFS.map((d) => d.slug);

      const attributeIssues: Array<{
        saleorProductId: string;
        cardName: string;
        missingAttributes: string[];
        staleAttributes: string[];
        imageStale: boolean;
      }> = [];

      let productsMissingAttributes = 0;
      let productsStaleAttributes = 0;
      let productsStaleImages = 0;

      for (const product of products) {
        const existingSlugs = new Set(product.attributes.map((a) => a.attribute.slug));

        const missing = expectedSlugs.filter((slug) => !existingSlugs.has(slug));
        const stale = product.attributes
          .filter((a) => expectedSlugs.includes(a.attribute.slug))
          .filter((a) => a.values.length === 0 || a.values.every((v) => !v.name && !v.plainText))
          .map((a) => a.attribute.slug);

        const imageStale = product.media.length === 0;

        if (missing.length > 0) productsMissingAttributes++;
        if (stale.length > 0) productsStaleAttributes++;
        if (imageStale) productsStaleImages++;

        if (missing.length > 0 || stale.length > 0 || imageStale) {
          attributeIssues.push({
            saleorProductId: product.id,
            cardName: product.name,
            missingAttributes: missing,
            staleAttributes: stale,
            imageStale,
          });
        }
      }

      return {
        productsAudited: products.length,
        summary: {
          totalIssues: attributeIssues.length,
          productsMissingAttributes,
          productsStaleAttributes,
          productsStaleImages,
        },
        attributeIssues,
      };
    }),

  /** Repair missing attributes by triggering a backfill job */
  repairAttributes: protectedClientProcedure
    .input(z.object({ setCode: z.string().min(2).max(10) }))
    .mutation(async ({ ctx, input }) => {
      const setCode = input.setCode.toLowerCase();

      // Check for existing running/pending backfill
      const existing = await ctx.prisma.importJob.findFirst({
        where: {
          installationId: ctx.installationId,
          status: { in: ["PENDING", "RUNNING"] },
          type: "BACKFILL",
          setCode,
        },
      });

      if (existing) {
        return { repaired: 0, failed: 0, message: "A backfill job is already running for this set" };
      }

      let cardsTotal = 0;
      try {
        const set = await getScryfallClient().getSet(setCode);
        cardsTotal = set.card_count;
      } catch {
        // continue with 0
      }

      const job = await ctx.prisma.importJob.create({
        data: {
          installationId: ctx.installationId,
          type: "BACKFILL" as ImportJobType,
          status: "PENDING",
          priority: 1,
          setCode,
          cardsTotal,
        },
      });

      void startJobProcessing(job.id, ctx.prisma, ctx.apiClient!);

      logger.info("Repair job created", { setCode, jobId: job.id });
      return { repaired: cardsTotal, failed: 0, jobId: job.id };
    }),

  /** Scan all imported sets for completeness summary */
  scanAll: protectedClientProcedure.query(async ({ ctx }) => {
    const audits = await ctx.prisma.setAudit.findMany({
      where: { installationId: ctx.installationId },
      orderBy: { lastImportedAt: "desc" },
    });

    const results = await Promise.all(
      audits.map(async (audit) => {
        let scryfallTotal = audit.totalCards;
        try {
          const set = await getScryfallClient().getSet(audit.setCode);
          scryfallTotal = set.card_count;
        } catch {
          // use stored total
        }

        return {
          setCode: audit.setCode,
          importedCards: audit.importedCards,
          scryfallTotal,
          completeness: scryfallTotal > 0
            ? Math.round((audit.importedCards / scryfallTotal) * 100)
            : 0,
          lastImportedAt: audit.lastImportedAt,
        };
      })
    );

    const incomplete = results.filter((r) => r.completeness < 100);
    return {
      totalSets: results.length,
      incompleteSets: incomplete.length,
      completeSets: results.length - incomplete.length,
      sets: results,
    };
  }),
});

// --- System Router ---

const systemRouter = router({
	/** Check system readiness for imports */
	readiness: protectedClientProcedure.query(async ({ ctx }) => {
		const checks: Array<{
			name: string;
			status: "pass" | "fail" | "warn";
			message: string;
			detail?: string;
		}> = [];

		// Check 1: Channels
		try {
			const saleor = new SaleorImportClient(ctx.apiClient!);
			const channels = await saleor.getChannels();
			if (channels.length === 0) {
				checks.push({
					name: "channels",
					status: "fail",
					message: "No channels found",
					detail: "Create at least one channel in Saleor Dashboard → Configuration → Channels",
				});
			} else {
				checks.push({
					name: "channels",
					status: "pass",
					message: `${channels.length} channel(s) found`,
				});
			}
		} catch (err) {
			checks.push({
				name: "channels",
				status: "fail",
				message: "Failed to fetch channels",
				detail: err instanceof Error ? err.message : String(err),
			});
		}

		// Check 2: Product type "mtg-card"
		let productType: any = null;
		try {
			const saleor = new SaleorImportClient(ctx.apiClient!);
			productType = await saleor.getProductType();
			checks.push({
				name: "product-type",
				status: "pass",
				message: `Product type "${productType.slug}" found`,
			});
		} catch (err) {
			checks.push({
				name: "product-type",
				status: "fail",
				message: 'Product type "mtg-card" not found',
				detail: err instanceof Error ? err.message : "Create a product type named 'mtg-card' in Saleor Dashboard → Configuration → Product Types",
			});
		}

		// Check 3: Attributes on product type
		if (productType) {
			const existingSlugs = new Set(
				productType.productAttributes.map((a: any) => a.slug),
			);
			const missingSlugs = ATTRIBUTE_DEFS.filter((d) => !existingSlugs.has(d.slug)).map(
				(d) => d.slug,
			);
			if (missingSlugs.length === 0) {
				checks.push({
					name: "attributes",
					status: "pass",
					message: `All ${ATTRIBUTE_DEFS.length} attributes configured`,
				});
			} else {
				checks.push({
					name: "attributes",
					status: "fail",
					message: `${missingSlugs.length} attribute(s) missing`,
					detail: `Missing: ${missingSlugs.join(", ")}`,
				});
			}
		} else {
			checks.push({
				name: "attributes",
				status: "fail",
				message: "Cannot check attributes without product type",
			});
		}

		// Check 4: Category "mtg-singles"
		try {
			const saleor = new SaleorImportClient(ctx.apiClient!);
			const category = await saleor.getCategory();
			checks.push({
				name: "category",
				status: "pass",
				message: `Category "${category.slug}" found`,
			});
		} catch {
			checks.push({
				name: "category",
				status: "fail",
				message: 'Category "mtg-singles" not found',
				detail: "Create a category named 'mtg-singles' in Saleor Dashboard → Catalog → Categories",
			});
		}

		// Check 5: Warehouse
		try {
			const saleor = new SaleorImportClient(ctx.apiClient!);
			const warehouse = await saleor.getWarehouse();
			checks.push({
				name: "warehouse",
				status: "pass",
				message: `Warehouse "${warehouse.name}" found`,
			});
		} catch {
			checks.push({
				name: "warehouse",
				status: "fail",
				message: "No warehouse found",
				detail: "Create a warehouse in Saleor Dashboard → Configuration → Warehouses",
			});
		}

		const allPass = checks.every((c) => c.status !== "fail");
		return { ready: allPass, checks };
	}),

	/** Create missing attributes and assign them to the mtg-card product type */
	setupAttributes: protectedClientProcedure.mutation(async ({ ctx }) => {
		const saleor = new SaleorImportClient(ctx.apiClient!);

		// Require the product type to exist first
		let productType;
		try {
			productType = await saleor.getProductType();
		} catch {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: 'Product type "mtg-card" must exist before creating attributes.',
			});
		}

		// Find missing attribute slugs
		const existingSlugs = new Set(
			productType.productAttributes.map((a) => a.slug),
		);
		const missingDefs = ATTRIBUTE_DEFS.filter((d) => !existingSlugs.has(d.slug));

		if (missingDefs.length === 0) {
			return {
				created: 0,
				assigned: 0,
				errors: [] as string[],
				message: "All attributes already exist",
			};
		}

		logger.info("Creating missing attributes", {
			count: missingDefs.length,
			slugs: missingDefs.map((d) => d.slug),
		});

		const result = await saleor.createMissingAttributes(missingDefs, productType.id);

		const message = result.errors.length > 0
			? `Created ${result.created}, assigned ${result.assigned}. Errors: ${result.errors.join("; ")}`
			: `Created ${result.created} attribute(s), assigned ${result.assigned} to product type`;

		return { ...result, message };
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

// --- Catalog Router ---

const catalogRouter = router({
  /** Get overall catalog health summary */
  summary: protectedClientProcedure.query(async ({ ctx }) => {
    const [audits, totalProducts, totalJobs, recentJobs] = await Promise.all([
      ctx.prisma.setAudit.findMany({
        where: { installationId: ctx.installationId },
      }),
      ctx.prisma.importedProduct.count({
        where: { success: true },
      }),
      ctx.prisma.importJob.count({
        where: { installationId: ctx.installationId },
      }),
      ctx.prisma.importJob.findMany({
        where: { installationId: ctx.installationId },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    const totalSets = audits.length;
    const totalCards = audits.reduce((sum, a) => sum + a.importedCards, 0);
    const totalExpected = audits.reduce((sum, a) => sum + a.totalCards, 0);
    const incompleteSets = audits.filter((a) => a.importedCards < a.totalCards).length;

    return {
      totalSets,
      completeSets: totalSets - incompleteSets,
      incompleteSets,
      totalCards,
      totalExpected,
      completenessPercent: totalExpected > 0 ? Math.round((totalCards / totalExpected) * 100) : 0,
      totalProducts,
      totalJobs,
      recentJobs,
    };
  }),
});

// Import PrismaClient and Client types
import type { PrismaClient } from "@/generated/prisma";
import type { Client } from "urql";

export { jobsRouter, setsRouter, systemRouter, catalogRouter };
