import { JobType } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";
import { PrismaQueueService } from "@/modules/jobs";

import { auditSet, saveAuditResult } from "./audit-service";

export const auditRouter = router({
  /**
   * List all set audits
   */
  list: protectedClientProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).optional().default(50),
        offset: z.number().min(0).optional().default(0),
        onlyIncomplete: z.boolean().optional().default(false),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const where = {
        installationId: ctx.installationId,
        ...(input?.onlyIncomplete && { sellableTimestamp: null }),
      };

      const audits = await ctx.prisma.setAudit.findMany({
        where,
        orderBy: { auditedAt: "desc" },
        take: input?.limit ?? 50,
        skip: input?.offset ?? 0,
        select: {
          id: true,
          setCode: true,
          setName: true,
          scryfallCardCount: true,
          saleorProductCount: true,
          saleorVariantCount: true,
          pricedCount: true,
          indexedCount: true,
          sellableTimestamp: true,
          auditedAt: true,
        },
      });

      const total = await ctx.prisma.setAudit.count({ where });

      return { audits, total };
    }),

  /**
   * Get a specific audit by set code
   */
  getBySetCode: protectedClientProcedure
    .input(z.object({ setCode: z.string().min(1).max(10) }))
    .query(async ({ ctx, input }) => {
      const audit = await ctx.prisma.setAudit.findUnique({
        where: {
          installationId_setCode: {
            installationId: ctx.installationId,
            setCode: input.setCode,
          },
        },
      });

      if (!audit) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Audit not found for this set",
        });
      }

      return audit;
    }),

  /**
   * Run an audit for a specific set
   */
  runSetAudit: protectedClientProcedure
    .input(z.object({ setCode: z.string().min(1).max(10) }))
    .mutation(async ({ ctx, input }) => {
      // Run the audit
      const result = await auditSet(
        ctx.installationId,
        input.setCode,
        ctx.prisma,
        ctx.apiClient!
      );

      // Save the result
      const auditId = await saveAuditResult(ctx.installationId, result, ctx.prisma);

      return {
        auditId,
        result,
      };
    }),

  /**
   * Create a remediation job from audit results
   */
  createRemediationJob: protectedClientProcedure
    .input(
      z.object({
        setCode: z.string().min(1).max(10),
        fixMissingCards: z.boolean().optional().default(true),
        fixMissingVariants: z.boolean().optional().default(true),
        fixPricingGaps: z.boolean().optional().default(false),
        priority: z.number().min(0).max(10).optional().default(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get the audit
      const audit = await ctx.prisma.setAudit.findUnique({
        where: {
          installationId_setCode: {
            installationId: ctx.installationId,
            setCode: input.setCode,
          },
        },
      });

      if (!audit) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No audit found for this set. Run an audit first.",
        });
      }

      const queueService = new PrismaQueueService(ctx.prisma);

      const jobId = await queueService.createJob({
        installationId: ctx.installationId,
        jobType: JobType.REMEDIATION,
        priority: input.priority,
        config: {
          auditId: audit.id,
          setCode: input.setCode,
          fixMissingCards: input.fixMissingCards,
          fixMissingVariants: input.fixMissingVariants,
          fixPricingGaps: input.fixPricingGaps,
        },
      });

      return { jobId };
    }),

  /**
   * Get audit summary statistics
   */
  summary: protectedClientProcedure.query(async ({ ctx }) => {
    const audits = await ctx.prisma.setAudit.findMany({
      where: { installationId: ctx.installationId },
      select: {
        scryfallCardCount: true,
        saleorProductCount: true,
        saleorVariantCount: true,
        pricedCount: true,
        indexedCount: true,
        sellableTimestamp: true,
        missingCards: true,
      },
    });

    const totalSets = audits.length;
    const sellableSets = audits.filter((a) => a.sellableTimestamp !== null).length;
    const totalScryfallCards = audits.reduce((sum, a) => sum + a.scryfallCardCount, 0);
    const totalSaleorProducts = audits.reduce((sum, a) => sum + a.saleorProductCount, 0);
    const totalMissingCards = audits.reduce(
      (sum, a) => sum + (Array.isArray(a.missingCards) ? a.missingCards.length : 0),
      0
    );

    const completionRate = totalScryfallCards > 0
      ? ((totalSaleorProducts / totalScryfallCards) * 100).toFixed(1)
      : "0.0";

    return {
      totalSets,
      sellableSets,
      totalScryfallCards,
      totalSaleorProducts,
      totalMissingCards,
      completionRate: parseFloat(completionRate),
    };
  }),
});
