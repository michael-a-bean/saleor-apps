import { JobType } from "@prisma/client";
import { z } from "zod";

import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";
import { PrismaQueueService } from "@/modules/jobs";

export const importRouter = router({
  /**
   * Get import statistics
   */
  stats: protectedClientProcedure.query(async ({ ctx }) => {
    // Count imported products
    const totalProducts = await ctx.prisma.importedProduct.count({
      where: { installationId: ctx.installationId },
    });

    // Count by set
    const productsBySet = await ctx.prisma.importedProduct.groupBy({
      by: ["setCode"],
      where: { installationId: ctx.installationId },
      _count: { id: true },
    });

    // Count by attribute status
    const productsByStatus = await ctx.prisma.importedProduct.groupBy({
      by: ["attributeStatus"],
      where: { installationId: ctx.installationId },
      _count: { id: true },
    });

    // Get most recently imported
    const recentImports = await ctx.prisma.importedProduct.findMany({
      where: { installationId: ctx.installationId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        cardName: true,
        setCode: true,
        createdAt: true,
      },
    });

    return {
      totalProducts,
      setCount: productsBySet.length,
      productsBySet: productsBySet.map((s) => ({
        setCode: s.setCode,
        count: s._count.id,
      })),
      productsByStatus: productsByStatus.map((s) => ({
        status: s.attributeStatus,
        count: s._count.id,
      })),
      recentImports,
    };
  }),

  /**
   * Start a bulk import job
   */
  startBulkImport: protectedClientProcedure
    .input(
      z.object({
        priority: z.number().min(0).max(10).optional().default(2),  // Default to backfill priority
      }).optional()
    )
    .mutation(async ({ ctx, input }) => {
      const queueService = new PrismaQueueService(ctx.prisma);

      const jobId = await queueService.createJob({
        installationId: ctx.installationId,
        jobType: JobType.BULK_IMPORT,
        priority: input?.priority ?? 2,
      });

      return { jobId };
    }),

  /**
   * Start a new set import job
   */
  startSetImport: protectedClientProcedure
    .input(
      z.object({
        setCode: z.string().min(1).max(10),
        setName: z.string().optional(),
        priority: z.number().min(0).max(10).optional().default(0),  // Default to prerelease priority
      })
    )
    .mutation(async ({ ctx, input }) => {
      const queueService = new PrismaQueueService(ctx.prisma);

      const jobId = await queueService.createJob({
        installationId: ctx.installationId,
        jobType: JobType.NEW_SET,
        priority: input.priority,
        config: {
          setCode: input.setCode,
          setName: input.setName,
        },
      });

      return { jobId };
    }),

  /**
   * Get products for a specific set
   */
  getSetProducts: protectedClientProcedure
    .input(
      z.object({
        setCode: z.string().min(1).max(10),
        limit: z.number().min(1).max(100).optional().default(50),
        offset: z.number().min(0).optional().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const products = await ctx.prisma.importedProduct.findMany({
        where: {
          installationId: ctx.installationId,
          setCode: input.setCode,
        },
        orderBy: { collectorNumber: "asc" },
        take: input.limit,
        skip: input.offset,
      });

      const total = await ctx.prisma.importedProduct.count({
        where: {
          installationId: ctx.installationId,
          setCode: input.setCode,
        },
      });

      return { products, total };
    }),

  /**
   * Search imported products
   */
  search: protectedClientProcedure
    .input(
      z.object({
        query: z.string().min(1).max(100),
        limit: z.number().min(1).max(100).optional().default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      const products = await ctx.prisma.importedProduct.findMany({
        where: {
          installationId: ctx.installationId,
          cardName: {
            contains: input.query,
            mode: "insensitive",
          },
        },
        orderBy: { cardName: "asc" },
        take: input.limit,
      });

      return { products };
    }),
});
