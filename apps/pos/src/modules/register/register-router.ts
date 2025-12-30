import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createLogger } from "@/lib/logger";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

const logger = createLogger("register-router");

/**
 * Denomination breakdown schema for cash counting
 * All fields are counts (not dollar amounts)
 */
const denominationBreakdownSchema = z.object({
  // Bills
  hundreds: z.number().int().min(0).default(0),
  fifties: z.number().int().min(0).default(0),
  twenties: z.number().int().min(0).default(0),
  tens: z.number().int().min(0).default(0),
  fives: z.number().int().min(0).default(0),
  ones: z.number().int().min(0).default(0),
  // Coins
  quarters: z.number().int().min(0).default(0),
  dimes: z.number().int().min(0).default(0),
  nickels: z.number().int().min(0).default(0),
  pennies: z.number().int().min(0).default(0),
});

type DenominationBreakdown = z.infer<typeof denominationBreakdownSchema>;

/**
 * Calculate total from denomination breakdown
 */
function calculateDenominationTotal(breakdown: DenominationBreakdown): number {
  return (
    breakdown.hundreds * 100 +
    breakdown.fifties * 50 +
    breakdown.twenties * 20 +
    breakdown.tens * 10 +
    breakdown.fives * 5 +
    breakdown.ones * 1 +
    breakdown.quarters * 0.25 +
    breakdown.dimes * 0.1 +
    breakdown.nickels * 0.05 +
    breakdown.pennies * 0.01
  );
}

const openSessionSchema = z.object({
  registerCode: z.string().min(1).max(50).default("REG-1"),
  saleorWarehouseId: z.string().min(1),
  openingFloat: denominationBreakdownSchema,
  currency: z.string().length(3).default("USD"),
  notes: z.string().max(500).optional().nullable(),
});

const closeSessionSchema = z.object({
  sessionId: z.string().uuid(),
  closingCount: denominationBreakdownSchema,
  notes: z.string().max(500).optional().nullable(),
});

const listSessionsSchema = z.object({
  status: z.enum(["OPEN", "SUSPENDED", "CLOSED"]).optional(),
  limit: z.number().min(1).max(100).optional().default(50),
  offset: z.number().min(0).optional().default(0),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

/**
 * Generate session number for the day
 */
async function generateSessionNumber(
  prisma: typeof import("@prisma/client").PrismaClient.prototype,
  installationId: string
): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const count = await prisma.registerSession.count({
    where: {
      installationId,
      openedAt: { gte: today },
    },
  });

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${dateStr}-${String(count + 1).padStart(3, "0")}`;
}

/**
 * Register Session Router
 * Manages register open/close cycles and cash tracking
 */
export const registerRouter = router({
  /**
   * Get current open session (if any)
   */
  current: protectedClientProcedure.query(async ({ ctx }) => {
    const session = await ctx.prisma.registerSession.findFirst({
      where: {
        installationId: ctx.installationId,
        status: { in: ["OPEN", "SUSPENDED"] },
      },
      orderBy: { openedAt: "desc" },
      include: {
        _count: {
          select: { transactions: true, cashMovements: true },
        },
      },
    });

    return session;
  }),

  /**
   * Open a new register session
   */
  open: protectedClientProcedure.input(openSessionSchema).mutation(async ({ ctx, input }) => {
    // Check if there's already an open session
    const existingOpen = await ctx.prisma.registerSession.findFirst({
      where: {
        installationId: ctx.installationId,
        status: { in: ["OPEN", "SUSPENDED"] },
      },
    });

    if (existingOpen) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A register session is already open. Close it before opening a new one.",
      });
    }

    const openingAmount = calculateDenominationTotal(input.openingFloat);
    const sessionNumber = await generateSessionNumber(ctx.prisma, ctx.installationId);

    // Create the session
    const session = await ctx.prisma.registerSession.create({
      data: {
        installationId: ctx.installationId,
        registerCode: input.registerCode,
        sessionNumber,
        saleorWarehouseId: input.saleorWarehouseId,
        status: "OPEN",
        openingFloat: openingAmount,
        openingDenominations: input.openingFloat,
        openedBy: ctx.token ?? "unknown",
        currency: input.currency,
        notes: input.notes,
      },
    });

    // Create the opening float cash movement
    await ctx.prisma.cashMovement.create({
      data: {
        registerSessionId: session.id,
        movementType: "OPENING_FLOAT",
        amount: openingAmount,
        currency: input.currency,
        denominations: input.openingFloat,
        performedBy: ctx.token ?? "unknown",
        notes: "Opening float",
      },
    });

    // Create audit event
    await ctx.prisma.posAuditEvent.create({
      data: {
        installationId: ctx.installationId,
        entityType: "RegisterSession",
        entityId: session.id,
        action: "OPENED",
        userId: ctx.token ?? null,
        metadata: {
          openingFloat: openingAmount,
          denominations: input.openingFloat,
          registerCode: input.registerCode,
        },
      },
    });

    logger.info("Register session opened", {
      sessionId: session.id,
      registerCode: session.registerCode,
      openingFloat: openingAmount,
    });

    return session;
  }),

  /**
   * Close a register session
   */
  close: protectedClientProcedure.input(closeSessionSchema).mutation(async ({ ctx, input }) => {
    const session = await ctx.prisma.registerSession.findFirst({
      where: {
        id: input.sessionId,
        installationId: ctx.installationId,
      },
      include: {
        cashMovements: true,
        transactions: {
          where: { status: "COMPLETED" },
          include: { payments: true },
        },
      },
    });

    if (!session) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Register session not found",
      });
    }

    if (session.status === "CLOSED") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This register session is already closed",
      });
    }

    // Check for pending transactions
    const pendingTx = await ctx.prisma.posTransaction.findFirst({
      where: {
        registerSessionId: session.id,
        status: { in: ["DRAFT", "SUSPENDED"] },
      },
    });

    if (pendingTx) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot close register with pending transactions. Complete or void them first.",
      });
    }

    const closingCash = calculateDenominationTotal(input.closingCount);

    // Calculate expected cash: opening + cash sales - cash returns - drops - payouts
    let expectedCash = session.openingFloat.toNumber();

    for (const movement of session.cashMovements) {
      switch (movement.movementType) {
        case "SALE_CASH":
        case "PAID_IN":
          expectedCash += movement.amount.toNumber();
          break;
        case "RETURN_CASH":
        case "CASH_DROP":
        case "PAYOUT":
          expectedCash -= Math.abs(movement.amount.toNumber());
          break;
        // OPENING_FLOAT is already counted
        // CLOSING_COUNT is what we're calculating variance against
      }
    }

    const variance = closingCash - expectedCash;

    // Update the session
    const updatedSession = await ctx.prisma.registerSession.update({
      where: { id: session.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closingCash,
        closingDenominations: input.closingCount,
        expectedCash,
        variance,
        closedBy: ctx.token ?? null,
        notes: input.notes
          ? session.notes
            ? `${session.notes}\n---\nClose notes: ${input.notes}`
            : `Close notes: ${input.notes}`
          : session.notes,
      },
    });

    // Create closing count cash movement
    await ctx.prisma.cashMovement.create({
      data: {
        registerSessionId: session.id,
        movementType: "CLOSING_COUNT",
        amount: closingCash,
        currency: session.currency,
        denominations: input.closingCount,
        performedBy: ctx.token ?? "unknown",
        notes: `Expected: ${expectedCash.toFixed(2)}, Variance: ${variance.toFixed(2)}`,
      },
    });

    // Create audit event
    await ctx.prisma.posAuditEvent.create({
      data: {
        installationId: ctx.installationId,
        entityType: "RegisterSession",
        entityId: session.id,
        action: "CLOSED",
        userId: ctx.token ?? null,
        metadata: {
          closingCash,
          expectedCash,
          variance,
          denominations: input.closingCount,
        },
      },
    });

    logger.info("Register session closed", {
      sessionId: session.id,
      closingCash,
      expectedCash,
      variance,
    });

    return {
      session: updatedSession,
      summary: {
        openingFloat: session.openingFloat.toNumber(),
        closingCash,
        expectedCash,
        variance,
        transactionCount: session.transactions.length,
      },
    };
  }),

  /**
   * Suspend a register session (e.g., for shift change)
   */
  suspend: protectedClientProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.registerSession.findFirst({
        where: {
          id: input.sessionId,
          installationId: ctx.installationId,
        },
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Register session not found",
        });
      }

      if (session.status !== "OPEN") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot suspend a ${session.status.toLowerCase()} session`,
        });
      }

      const updatedSession = await ctx.prisma.registerSession.update({
        where: { id: session.id },
        data: { status: "SUSPENDED" },
      });

      await ctx.prisma.posAuditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "RegisterSession",
          entityId: session.id,
          action: "SUSPENDED",
          userId: ctx.token ?? null,
          metadata: { reason: input.reason },
        },
      });

      return updatedSession;
    }),

  /**
   * Resume a suspended register session
   */
  resume: protectedClientProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.registerSession.findFirst({
        where: {
          id: input.sessionId,
          installationId: ctx.installationId,
        },
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Register session not found",
        });
      }

      if (session.status !== "SUSPENDED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot resume a ${session.status.toLowerCase()} session`,
        });
      }

      const updatedSession = await ctx.prisma.registerSession.update({
        where: { id: session.id },
        data: { status: "OPEN" },
      });

      await ctx.prisma.posAuditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "RegisterSession",
          entityId: session.id,
          action: "RESUMED",
          userId: ctx.token ?? null,
        },
      });

      return updatedSession;
    }),

  /**
   * Get a session by ID with full details
   */
  getById: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.prisma.registerSession.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
        include: {
          cashMovements: {
            orderBy: { performedAt: "asc" },
          },
          transactions: {
            orderBy: { startedAt: "desc" },
            take: 100, // Limit to last 100 transactions
            include: {
              payments: true,
              _count: {
                select: { lines: true },
              },
            },
          },
          _count: {
            select: { transactions: true, cashMovements: true },
          },
        },
      });

      if (!session) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Register session not found",
        });
      }

      return session;
    }),

  /**
   * List register sessions
   */
  list: protectedClientProcedure.input(listSessionsSchema.optional()).query(async ({ ctx, input }) => {
    const where = {
      installationId: ctx.installationId,
      ...(input?.status && { status: input.status }),
      ...(input?.startDate && { openedAt: { gte: input.startDate } }),
      ...(input?.endDate && { openedAt: { lte: input.endDate } }),
    };

    const [sessions, total] = await Promise.all([
      ctx.prisma.registerSession.findMany({
        where,
        orderBy: { openedAt: "desc" },
        take: input?.limit ?? 50,
        skip: input?.offset ?? 0,
        include: {
          _count: {
            select: { transactions: true },
          },
        },
      }),
      ctx.prisma.registerSession.count({ where }),
    ]);

    return {
      sessions,
      total,
      hasMore: (input?.offset ?? 0) + sessions.length < total,
    };
  }),

  /**
   * Get cash summary for current session
   */
  cashSummary: protectedClientProcedure.query(async ({ ctx }) => {
    const session = await ctx.prisma.registerSession.findFirst({
      where: {
        installationId: ctx.installationId,
        status: { in: ["OPEN", "SUSPENDED"] },
      },
      include: {
        cashMovements: true,
      },
    });

    if (!session) {
      return null;
    }

    let currentCash = session.openingFloat.toNumber();
    let totalSales = 0;
    let totalReturns = 0;
    let totalDrops = 0;
    let totalPayouts = 0;
    let totalPaidIn = 0;

    for (const movement of session.cashMovements) {
      const amount = Math.abs(movement.amount.toNumber());

      switch (movement.movementType) {
        case "SALE_CASH":
          currentCash += amount;
          totalSales += amount;
          break;
        case "RETURN_CASH":
          currentCash -= amount;
          totalReturns += amount;
          break;
        case "CASH_DROP":
          currentCash -= amount;
          totalDrops += amount;
          break;
        case "PAYOUT":
          currentCash -= amount;
          totalPayouts += amount;
          break;
        case "PAID_IN":
          currentCash += amount;
          totalPaidIn += amount;
          break;
      }
    }

    return {
      sessionId: session.id,
      openingFloat: session.openingFloat.toNumber(),
      currentCash,
      totalSales,
      totalReturns,
      totalDrops,
      totalPayouts,
      totalPaidIn,
      movementCount: session.cashMovements.length,
    };
  }),
});
