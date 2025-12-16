import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

// Validation schemas
const supplierCreateSchema = z.object({
  code: z
    .string()
    .min(1, "Code is required")
    .max(50, "Code must be 50 characters or less")
    .regex(/^[A-Za-z0-9-_]+$/, "Code must be alphanumeric (hyphens and underscores allowed)"),
  name: z.string().min(1, "Name is required").max(255, "Name must be 255 characters or less"),
  contactName: z.string().max(255).optional().nullable(),
  contactEmail: z.string().email("Invalid email format").optional().nullable().or(z.literal("")),
  contactPhone: z.string().max(50).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

const supplierUpdateSchema = supplierCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const supplierSearchSchema = z.object({
  query: z.string().optional(),
  isActive: z.boolean().optional(),
  limit: z.number().min(1).max(100).optional().default(50),
  offset: z.number().min(0).optional().default(0),
});

/**
 * Suppliers Router - Full CRUD operations
 */
export const suppliersRouter = router({
  /**
   * List all suppliers with optional filtering
   */
  list: protectedClientProcedure.input(supplierSearchSchema.optional()).query(async ({ ctx, input }) => {
    const where = {
      installationId: ctx.installationId,
      ...(input?.isActive !== undefined && { isActive: input.isActive }),
      ...(input?.query && {
        OR: [
          { code: { contains: input.query, mode: "insensitive" as const } },
          { name: { contains: input.query, mode: "insensitive" as const } },
          { contactEmail: { contains: input.query, mode: "insensitive" as const } },
        ],
      }),
    };

    const [suppliers, total] = await Promise.all([
      ctx.prisma.supplier.findMany({
        where,
        orderBy: { name: "asc" },
        take: input?.limit ?? 50,
        skip: input?.offset ?? 0,
      }),
      ctx.prisma.supplier.count({ where }),
    ]);

    return {
      suppliers,
      total,
      hasMore: (input?.offset ?? 0) + suppliers.length < total,
    };
  }),

  /**
   * Get a single supplier by ID
   */
  getById: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const supplier = await ctx.prisma.supplier.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
        include: {
          _count: {
            select: { purchaseOrders: true },
          },
        },
      });

      if (!supplier) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Supplier not found",
        });
      }

      return supplier;
    }),

  /**
   * Create a new supplier
   */
  create: protectedClientProcedure.input(supplierCreateSchema).mutation(async ({ ctx, input }) => {
    // Check for duplicate code
    const existing = await ctx.prisma.supplier.findFirst({
      where: {
        installationId: ctx.installationId,
        code: input.code,
      },
    });

    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Supplier with code "${input.code}" already exists`,
      });
    }

    // Clean up empty strings to null
    const cleanedInput = {
      ...input,
      contactEmail: input.contactEmail || null,
      contactName: input.contactName || null,
      contactPhone: input.contactPhone || null,
      address: input.address || null,
      notes: input.notes || null,
    };

    const supplier = await ctx.prisma.supplier.create({
      data: {
        installationId: ctx.installationId,
        ...cleanedInput,
      },
    });

    // Create audit event
    await ctx.prisma.auditEvent.create({
      data: {
        installationId: ctx.installationId,
        entityType: "Supplier",
        entityId: supplier.id,
        action: "CREATED",
        userId: ctx.token ?? null,
        newState: JSON.parse(JSON.stringify(supplier)),
      },
    });

    return supplier;
  }),

  /**
   * Update an existing supplier
   */
  update: protectedClientProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: supplierUpdateSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get existing supplier
      const existing = await ctx.prisma.supplier.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Supplier not found",
        });
      }

      // If code is being changed, check for duplicates
      if (input.data.code && input.data.code !== existing.code) {
        const duplicate = await ctx.prisma.supplier.findFirst({
          where: {
            installationId: ctx.installationId,
            code: input.data.code,
            id: { not: input.id },
          },
        });

        if (duplicate) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Supplier with code "${input.data.code}" already exists`,
          });
        }
      }

      // Clean up empty strings to null
      const cleanedData = {
        ...input.data,
        contactEmail: input.data.contactEmail === "" ? null : input.data.contactEmail,
        contactName: input.data.contactName === "" ? null : input.data.contactName,
        contactPhone: input.data.contactPhone === "" ? null : input.data.contactPhone,
        address: input.data.address === "" ? null : input.data.address,
        notes: input.data.notes === "" ? null : input.data.notes,
      };

      const supplier = await ctx.prisma.supplier.update({
        where: { id: input.id },
        data: cleanedData,
      });

      // Create audit event
      await ctx.prisma.auditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "Supplier",
          entityId: supplier.id,
          action: "UPDATED",
          userId: ctx.token ?? null,
          previousState: JSON.parse(JSON.stringify(existing)),
          newState: JSON.parse(JSON.stringify(supplier)),
        },
      });

      return supplier;
    }),

  /**
   * Deactivate a supplier (soft delete)
   */
  deactivate: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.supplier.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
        include: {
          _count: {
            select: {
              purchaseOrders: {
                where: {
                  status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PARTIALLY_RECEIVED"] },
                },
              },
            },
          },
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Supplier not found",
        });
      }

      // Warn if there are active POs (but allow deactivation)
      const activePOCount = existing._count.purchaseOrders;

      const supplier = await ctx.prisma.supplier.update({
        where: { id: input.id },
        data: { isActive: false },
      });

      // Create audit event
      await ctx.prisma.auditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "Supplier",
          entityId: supplier.id,
          action: "DEACTIVATED",
          userId: ctx.token ?? null,
          metadata: JSON.parse(JSON.stringify({ activePOCount })),
        },
      });

      return { supplier, activePOCount };
    }),

  /**
   * Reactivate a supplier
   */
  reactivate: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.supplier.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Supplier not found",
        });
      }

      const supplier = await ctx.prisma.supplier.update({
        where: { id: input.id },
        data: { isActive: true },
      });

      // Create audit event
      await ctx.prisma.auditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "Supplier",
          entityId: supplier.id,
          action: "REACTIVATED",
          userId: ctx.token ?? null,
        },
      });

      return supplier;
    }),

  /**
   * Search suppliers (for autocomplete)
   */
  search: protectedClientProcedure
    .input(
      z.object({
        query: z.string().min(1),
        limit: z.number().min(1).max(20).optional().default(10),
        activeOnly: z.boolean().optional().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      const suppliers = await ctx.prisma.supplier.findMany({
        where: {
          installationId: ctx.installationId,
          ...(input.activeOnly && { isActive: true }),
          OR: [
            { code: { contains: input.query, mode: "insensitive" } },
            { name: { contains: input.query, mode: "insensitive" } },
          ],
        },
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
        },
        orderBy: { name: "asc" },
        take: input.limit,
      });

      return suppliers;
    }),
});
