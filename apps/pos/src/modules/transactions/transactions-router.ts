import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createLogger } from "@/lib/logger";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

const logger = createLogger("transactions-router");

/**
 * Transaction line add schema
 */
const addLineSchema = z.object({
  transactionId: z.string().uuid(),
  // One of these must be provided
  variantId: z.string().optional(),
  barcode: z.string().optional(),
  sku: z.string().optional(),
  // Quantity and optional overrides
  quantity: z.number().int().positive().default(1),
  priceOverride: z.number().positive().optional(),
  discountAmount: z.number().min(0).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  discountReason: z.string().max(255).optional(),
  notes: z.string().max(500).optional(),
});

/**
 * Transaction line update schema
 */
const updateLineSchema = z.object({
  lineId: z.string().uuid(),
  quantity: z.number().int().positive().optional(),
  priceOverride: z.number().positive().optional().nullable(),
  discountAmount: z.number().min(0).optional().nullable(),
  discountPercent: z.number().min(0).max(100).optional().nullable(),
  discountReason: z.string().max(255).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

/**
 * Product lookup schema
 */
const lookupProductSchema = z.object({
  query: z.string().min(1), // barcode, SKU, or name
  limit: z.number().min(1).max(50).optional().default(10),
});

/**
 * List transactions schema
 */
const listTransactionsSchema = z.object({
  sessionId: z.string().uuid().optional(),
  status: z.enum(["DRAFT", "SUSPENDED", "COMPLETED", "VOIDED"]).optional(),
  type: z.enum(["SALE", "RETURN", "EXCHANGE", "NO_SALE"]).optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  limit: z.number().min(1).max(100).optional().default(50),
  offset: z.number().min(0).optional().default(0),
});

/**
 * Transactions Router
 * Manages cart/transaction lifecycle
 */
export const transactionsRouter = router({
  /**
   * Create a new draft transaction
   */
  create: protectedClientProcedure
    .input(
      z.object({
        type: z.enum(["SALE", "RETURN", "EXCHANGE", "NO_SALE"]).default("SALE"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get current open session
      const session = await ctx.prisma.registerSession.findFirst({
        where: {
          installationId: ctx.installationId,
          status: "OPEN",
        },
      });

      if (!session) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No open register session. Please open a register first.",
        });
      }

      // Check if there's already a draft transaction
      const existingDraft = await ctx.prisma.posTransaction.findFirst({
        where: {
          sessionId: session.id,
          status: "DRAFT",
        },
      });

      if (existingDraft) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A draft transaction already exists. Complete or void it first.",
        });
      }

      // Generate transaction number (formatted: POS-YYYYMMDD-XXXX)
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
      const count = await ctx.prisma.posTransaction.count({
        where: {
          installationId: ctx.installationId,
          createdAt: {
            gte: new Date(today.setHours(0, 0, 0, 0)),
          },
        },
      });
      const transactionNumber = `POS-${dateStr}-${String(count + 1).padStart(4, "0")}`;

      const transaction = await ctx.prisma.posTransaction.create({
        data: {
          installationId: ctx.installationId,
          sessionId: session.id,
          transactionNumber,
          type: input.type,
          status: "DRAFT",
          subtotal: 0,
          discountTotal: 0,
          taxTotal: 0,
          total: 0,
        },
        include: {
          lines: true,
          payments: true,
        },
      });

      logger.info("Transaction created", {
        transactionId: transaction.id,
        transactionNumber,
        type: input.type,
      });

      return transaction;
    }),

  /**
   * Get current draft transaction (creates one if none exists)
   */
  getCurrent: protectedClientProcedure.query(async ({ ctx }) => {
    // Get current open session
    const session = await ctx.prisma.registerSession.findFirst({
      where: {
        installationId: ctx.installationId,
        status: "OPEN",
      },
    });

    if (!session) {
      return null;
    }

    const transaction = await ctx.prisma.posTransaction.findFirst({
      where: {
        sessionId: session.id,
        status: "DRAFT",
      },
      include: {
        lines: {
          orderBy: { createdAt: "asc" },
        },
        payments: true,
      },
    });

    return transaction;
  }),

  /**
   * Get transaction by ID
   */
  getById: protectedClientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const transaction = await ctx.prisma.posTransaction.findFirst({
        where: {
          id: input.id,
          installationId: ctx.installationId,
        },
        include: {
          lines: {
            orderBy: { createdAt: "asc" },
          },
          payments: true,
          session: {
            select: {
              id: true,
              registerName: true,
              openedByName: true,
            },
          },
        },
      });

      if (!transaction) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transaction not found",
        });
      }

      return transaction;
    }),

  /**
   * Lookup product by barcode/SKU/name for adding to cart
   * This queries Saleor GraphQL API
   */
  lookupProduct: protectedClientProcedure.input(lookupProductSchema).query(async ({ ctx, input }) => {
    // Query Saleor for product variants
    // We search by SKU first (exact match), then by name (partial match)
    const query = `
      query SearchVariants($first: Int!, $filter: ProductVariantFilterInput) {
        productVariants(first: $first, filter: $filter) {
          edges {
            node {
              id
              name
              sku
              product {
                id
                name
                thumbnail {
                  url
                }
              }
              pricing {
                price {
                  gross {
                    amount
                    currency
                  }
                }
              }
              stocks {
                quantity
                quantityAllocated
                warehouse {
                  id
                  name
                }
              }
              metadata {
                key
                value
              }
            }
          }
        }
      }
    `;

    // Try SKU exact match first
    const skuResult = await ctx.apiClient!.query(query, {
      first: input.limit,
      filter: {
        sku: [input.query],
      },
    });

    if (skuResult.data?.productVariants?.edges?.length > 0) {
      return skuResult.data.productVariants.edges.map((edge: { node: Record<string, unknown> }) => edge.node);
    }

    // Try name search (contains)
    const nameResult = await ctx.apiClient!.query(query, {
      first: input.limit,
      filter: {
        search: input.query,
      },
    });

    return nameResult.data?.productVariants?.edges?.map((edge: { node: Record<string, unknown> }) => edge.node) ?? [];
  }),

  /**
   * Add a line to the transaction
   */
  addLine: protectedClientProcedure.input(addLineSchema).mutation(async ({ ctx, input }) => {
    // Validate we have at least one identifier
    if (!input.variantId && !input.barcode && !input.sku) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Must provide variantId, barcode, or sku",
      });
    }

    // Get the transaction
    const transaction = await ctx.prisma.posTransaction.findFirst({
      where: {
        id: input.transactionId,
        installationId: ctx.installationId,
      },
    });

    if (!transaction) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Transaction not found",
      });
    }

    if (transaction.status !== "DRAFT") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cannot add lines to a ${transaction.status.toLowerCase()} transaction`,
      });
    }

    // Resolve variant from Saleor
    let variantId = input.variantId;
    let variantData: Record<string, unknown> | null = null;

    if (!variantId && (input.barcode || input.sku)) {
      const searchValue = input.barcode || input.sku;
      const searchResult = await ctx.apiClient!.query(
        `
        query GetVariantBySku($sku: String!) {
          productVariant(sku: $sku) {
            id
            name
            sku
            product {
              id
              name
            }
            pricing {
              price {
                gross {
                  amount
                  currency
                }
              }
            }
          }
        }
      `,
        { sku: searchValue }
      );

      if (!searchResult.data?.productVariant) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Product not found: ${searchValue}`,
        });
      }

      variantData = searchResult.data.productVariant;
      variantId = variantData.id as string;
    } else if (variantId) {
      // Fetch variant data by ID
      const variantResult = await ctx.apiClient!.query(
        `
        query GetVariant($id: ID!) {
          productVariant(id: $id) {
            id
            name
            sku
            product {
              id
              name
            }
            pricing {
              price {
                gross {
                  amount
                  currency
                }
              }
            }
          }
        }
      `,
        { id: variantId }
      );

      if (!variantResult.data?.productVariant) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Product variant not found",
        });
      }

      variantData = variantResult.data.productVariant;
    }

    if (!variantData || !variantId) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Could not resolve product variant",
      });
    }

    // Extract pricing
    const pricing = variantData.pricing as { price?: { gross?: { amount: number; currency: string } } };
    const unitPrice = input.priceOverride ?? pricing?.price?.gross?.amount ?? 0;
    const currency = pricing?.price?.gross?.currency ?? "USD";
    const product = variantData.product as { id: string; name: string };

    // Calculate line totals
    const lineSubtotal = unitPrice * input.quantity;
    let lineDiscount = 0;

    if (input.discountAmount) {
      lineDiscount = input.discountAmount;
    } else if (input.discountPercent) {
      lineDiscount = lineSubtotal * (input.discountPercent / 100);
    }

    const lineTotal = lineSubtotal - lineDiscount;

    // Check if this variant already exists in the transaction
    const existingLine = await ctx.prisma.posTransactionLine.findFirst({
      where: {
        transactionId: transaction.id,
        saleorVariantId: variantId,
        priceOverride: input.priceOverride ?? null,
      },
    });

    let line;

    if (existingLine && !input.priceOverride && !input.discountAmount && !input.discountPercent) {
      // Update quantity of existing line
      const newQuantity = existingLine.quantity + input.quantity;
      const newSubtotal = existingLine.unitPrice.toNumber() * newQuantity;
      const newTotal = newSubtotal - existingLine.discountAmount.toNumber();

      line = await ctx.prisma.posTransactionLine.update({
        where: { id: existingLine.id },
        data: {
          quantity: newQuantity,
          lineSubtotal: newSubtotal,
          lineTotal: newTotal,
        },
      });
    } else {
      // Create new line
      line = await ctx.prisma.posTransactionLine.create({
        data: {
          transactionId: transaction.id,
          saleorVariantId: variantId,
          saleorProductId: product.id,
          productName: product.name,
          variantName: variantData.name as string,
          sku: (variantData.sku as string) ?? null,
          quantity: input.quantity,
          unitPrice,
          currency,
          priceOverride: input.priceOverride ?? null,
          discountAmount: lineDiscount,
          discountPercent: input.discountPercent ?? null,
          discountReason: input.discountReason ?? null,
          lineSubtotal,
          lineTotal,
          notes: input.notes ?? null,
        },
      });

      // Create audit event if price override or discount
      if (input.priceOverride || input.discountAmount || input.discountPercent) {
        await ctx.prisma.posAuditEvent.create({
          data: {
            installationId: ctx.installationId,
            transactionId: transaction.id,
            transactionLineId: line.id,
            eventType: input.priceOverride ? "PRICE_OVERRIDE" : "DISCOUNT_APPLIED",
            performedBy: ctx.token ?? null,
            details: {
              originalPrice: pricing?.price?.gross?.amount,
              newPrice: unitPrice,
              discountAmount: lineDiscount,
              discountPercent: input.discountPercent,
              reason: input.discountReason,
            },
          },
        });
      }
    }

    // Recalculate transaction totals
    const updatedTransaction = await recalculateTransactionTotals(ctx.prisma, transaction.id);

    logger.debug("Line added to transaction", {
      transactionId: transaction.id,
      lineId: line.id,
      variantId,
      quantity: input.quantity,
    });

    return {
      line,
      transaction: updatedTransaction,
    };
  }),

  /**
   * Update a transaction line
   */
  updateLine: protectedClientProcedure.input(updateLineSchema).mutation(async ({ ctx, input }) => {
    const line = await ctx.prisma.posTransactionLine.findFirst({
      where: { id: input.lineId },
      include: {
        transaction: true,
      },
    });

    if (!line) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Transaction line not found",
      });
    }

    if (line.transaction.installationId !== ctx.installationId) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Transaction line not found",
      });
    }

    if (line.transaction.status !== "DRAFT") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cannot update lines on a ${line.transaction.status.toLowerCase()} transaction`,
      });
    }

    // Calculate new values
    const quantity = input.quantity ?? line.quantity;
    const unitPrice = input.priceOverride ?? line.priceOverride?.toNumber() ?? line.unitPrice.toNumber();
    const lineSubtotal = unitPrice * quantity;

    let discountAmount = 0;

    if (input.discountAmount !== undefined) {
      discountAmount = input.discountAmount ?? 0;
    } else if (input.discountPercent !== undefined) {
      discountAmount = input.discountPercent ? lineSubtotal * (input.discountPercent / 100) : 0;
    } else {
      discountAmount = line.discountAmount.toNumber();
    }

    const lineTotal = lineSubtotal - discountAmount;

    // Track if price/discount changed for audit
    const priceChanged = input.priceOverride !== undefined && input.priceOverride !== line.priceOverride?.toNumber();
    const discountChanged =
      input.discountAmount !== undefined || (input.discountPercent !== undefined && input.discountPercent !== line.discountPercent?.toNumber());

    const updatedLine = await ctx.prisma.posTransactionLine.update({
      where: { id: line.id },
      data: {
        quantity,
        priceOverride: input.priceOverride,
        discountAmount,
        discountPercent: input.discountPercent,
        discountReason: input.discountReason,
        lineSubtotal,
        lineTotal,
        notes: input.notes,
      },
    });

    // Create audit event if price or discount changed
    if (priceChanged || discountChanged) {
      await ctx.prisma.posAuditEvent.create({
        data: {
          installationId: ctx.installationId,
          transactionId: line.transaction.id,
          transactionLineId: line.id,
          eventType: priceChanged ? "PRICE_OVERRIDE" : "DISCOUNT_APPLIED",
          performedBy: ctx.token ?? null,
          details: {
            previousPrice: line.unitPrice.toNumber(),
            newPrice: unitPrice,
            previousDiscount: line.discountAmount.toNumber(),
            newDiscount: discountAmount,
            reason: input.discountReason,
          },
        },
      });
    }

    // Recalculate transaction totals
    const updatedTransaction = await recalculateTransactionTotals(ctx.prisma, line.transaction.id);

    return {
      line: updatedLine,
      transaction: updatedTransaction,
    };
  }),

  /**
   * Remove a line from the transaction
   */
  removeLine: protectedClientProcedure
    .input(z.object({ lineId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const line = await ctx.prisma.posTransactionLine.findFirst({
        where: { id: input.lineId },
        include: {
          transaction: true,
        },
      });

      if (!line) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transaction line not found",
        });
      }

      if (line.transaction.installationId !== ctx.installationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transaction line not found",
        });
      }

      if (line.transaction.status !== "DRAFT") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot remove lines from a ${line.transaction.status.toLowerCase()} transaction`,
        });
      }

      await ctx.prisma.posTransactionLine.delete({
        where: { id: line.id },
      });

      // Recalculate transaction totals
      const updatedTransaction = await recalculateTransactionTotals(ctx.prisma, line.transaction.id);

      return updatedTransaction;
    }),

  /**
   * Apply transaction-level discount
   */
  applyDiscount: protectedClientProcedure
    .input(
      z.object({
        transactionId: z.string().uuid(),
        discountAmount: z.number().min(0).optional(),
        discountPercent: z.number().min(0).max(100).optional(),
        discountReason: z.string().max(255),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const transaction = await ctx.prisma.posTransaction.findFirst({
        where: {
          id: input.transactionId,
          installationId: ctx.installationId,
        },
        include: {
          lines: true,
        },
      });

      if (!transaction) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transaction not found",
        });
      }

      if (transaction.status !== "DRAFT") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot apply discount to a ${transaction.status.toLowerCase()} transaction`,
        });
      }

      // Calculate discount
      const subtotal = transaction.lines.reduce((sum, line) => sum + line.lineSubtotal.toNumber(), 0);
      let discountTotal = 0;

      if (input.discountAmount) {
        discountTotal = input.discountAmount;
      } else if (input.discountPercent) {
        discountTotal = subtotal * (input.discountPercent / 100);
      }

      // Line-level discounts
      const lineDiscounts = transaction.lines.reduce((sum, line) => sum + line.discountAmount.toNumber(), 0);

      const total = subtotal - lineDiscounts - discountTotal + transaction.taxTotal.toNumber();

      const updatedTransaction = await ctx.prisma.posTransaction.update({
        where: { id: transaction.id },
        data: {
          discountTotal,
          discountReason: input.discountReason,
          total,
        },
        include: {
          lines: true,
          payments: true,
        },
      });

      // Create audit event
      await ctx.prisma.posAuditEvent.create({
        data: {
          installationId: ctx.installationId,
          transactionId: transaction.id,
          eventType: "DISCOUNT_APPLIED",
          performedBy: ctx.token ?? null,
          details: {
            subtotal,
            discountAmount: discountTotal,
            discountPercent: input.discountPercent,
            reason: input.discountReason,
          },
        },
      });

      return updatedTransaction;
    }),

  /**
   * Suspend a transaction
   */
  suspend: protectedClientProcedure
    .input(
      z.object({
        transactionId: z.string().uuid(),
        suspendNote: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const transaction = await ctx.prisma.posTransaction.findFirst({
        where: {
          id: input.transactionId,
          installationId: ctx.installationId,
        },
      });

      if (!transaction) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transaction not found",
        });
      }

      if (transaction.status !== "DRAFT") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot suspend a ${transaction.status.toLowerCase()} transaction`,
        });
      }

      const updatedTransaction = await ctx.prisma.posTransaction.update({
        where: { id: transaction.id },
        data: {
          status: "SUSPENDED",
          notes: input.suspendNote
            ? transaction.notes
              ? `${transaction.notes}\nSuspended: ${input.suspendNote}`
              : `Suspended: ${input.suspendNote}`
            : transaction.notes,
        },
        include: {
          lines: true,
          payments: true,
        },
      });

      return updatedTransaction;
    }),

  /**
   * Resume a suspended transaction
   */
  resume: protectedClientProcedure
    .input(z.object({ transactionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Check for existing draft
      const session = await ctx.prisma.registerSession.findFirst({
        where: {
          installationId: ctx.installationId,
          status: "OPEN",
        },
      });

      if (!session) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No open register session",
        });
      }

      const existingDraft = await ctx.prisma.posTransaction.findFirst({
        where: {
          sessionId: session.id,
          status: "DRAFT",
        },
      });

      if (existingDraft) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Cannot resume: a draft transaction already exists",
        });
      }

      const transaction = await ctx.prisma.posTransaction.findFirst({
        where: {
          id: input.transactionId,
          installationId: ctx.installationId,
        },
      });

      if (!transaction) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transaction not found",
        });
      }

      if (transaction.status !== "SUSPENDED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot resume a ${transaction.status.toLowerCase()} transaction`,
        });
      }

      const updatedTransaction = await ctx.prisma.posTransaction.update({
        where: { id: transaction.id },
        data: { status: "DRAFT" },
        include: {
          lines: true,
          payments: true,
        },
      });

      return updatedTransaction;
    }),

  /**
   * Void a transaction
   */
  void: protectedClientProcedure
    .input(
      z.object({
        transactionId: z.string().uuid(),
        voidReason: z.string().min(1).max(500),
        voidedByName: z.string().min(1).max(255),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const transaction = await ctx.prisma.posTransaction.findFirst({
        where: {
          id: input.transactionId,
          installationId: ctx.installationId,
        },
      });

      if (!transaction) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transaction not found",
        });
      }

      if (transaction.status === "VOIDED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Transaction is already voided",
        });
      }

      if (transaction.status === "COMPLETED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot void a completed transaction. Use returns instead.",
        });
      }

      const updatedTransaction = await ctx.prisma.posTransaction.update({
        where: { id: transaction.id },
        data: {
          status: "VOIDED",
          voidedAt: new Date(),
          voidReason: input.voidReason,
        },
        include: {
          lines: true,
          payments: true,
        },
      });

      // Create audit event
      await ctx.prisma.posAuditEvent.create({
        data: {
          installationId: ctx.installationId,
          transactionId: transaction.id,
          eventType: "TRANSACTION_VOIDED",
          performedBy: ctx.token ?? null,
          performedByName: input.voidedByName,
          details: {
            reason: input.voidReason,
            total: transaction.total.toNumber(),
            lineCount: transaction.total,
          },
        },
      });

      return updatedTransaction;
    }),

  /**
   * List transactions
   */
  list: protectedClientProcedure.input(listTransactionsSchema.optional()).query(async ({ ctx, input }) => {
    const where = {
      installationId: ctx.installationId,
      ...(input?.sessionId && { sessionId: input.sessionId }),
      ...(input?.status && { status: input.status }),
      ...(input?.type && { type: input.type }),
      ...(input?.startDate && { createdAt: { gte: input.startDate } }),
      ...(input?.endDate && { createdAt: { lte: input.endDate } }),
    };

    const [transactions, total] = await Promise.all([
      ctx.prisma.posTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: input?.limit ?? 50,
        skip: input?.offset ?? 0,
        include: {
          _count: {
            select: { lines: true, payments: true },
          },
        },
      }),
      ctx.prisma.posTransaction.count({ where }),
    ]);

    return {
      transactions,
      total,
      hasMore: (input?.offset ?? 0) + transactions.length < total,
    };
  }),

  /**
   * List suspended transactions
   */
  listSuspended: protectedClientProcedure.query(async ({ ctx }) => {
    const transactions = await ctx.prisma.posTransaction.findMany({
      where: {
        installationId: ctx.installationId,
        status: "SUSPENDED",
      },
      orderBy: { createdAt: "desc" },
      include: {
        lines: true,
        _count: {
          select: { lines: true },
        },
      },
    });

    return transactions;
  }),
});

/**
 * Helper to recalculate transaction totals
 */
async function recalculateTransactionTotals(
  prisma: typeof import("@prisma/client").PrismaClient.prototype,
  transactionId: string
) {
  const transaction = await prisma.posTransaction.findUnique({
    where: { id: transactionId },
    include: { lines: true },
  });

  if (!transaction) {
    throw new Error("Transaction not found");
  }

  const subtotal = transaction.lines.reduce((sum, line) => sum + line.lineSubtotal.toNumber(), 0);
  const lineDiscounts = transaction.lines.reduce((sum, line) => sum + line.discountAmount.toNumber(), 0);
  const transactionDiscount = transaction.discountTotal.toNumber();

  // TODO: Calculate tax based on store location and tax-exempt status
  const taxTotal = 0;

  const total = subtotal - lineDiscounts - transactionDiscount + taxTotal;

  return prisma.posTransaction.update({
    where: { id: transactionId },
    data: {
      subtotal,
      taxTotal,
      total,
    },
    include: {
      lines: {
        orderBy: { createdAt: "asc" },
      },
      payments: true,
    },
  });
}
