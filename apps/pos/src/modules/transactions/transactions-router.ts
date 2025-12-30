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
 * Create transaction schema
 */
const createTransactionSchema = z.object({
  type: z.enum(["SALE", "RETURN", "EXCHANGE", "NO_SALE"]).default("SALE"),
  saleorChannelId: z.string().min(1),
  saleorWarehouseId: z.string().min(1),
  currency: z.string().length(3).default("USD"),
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
    .input(createTransactionSchema)
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
          registerSessionId: session.id,
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
          startedAt: {
            gte: new Date(today.setHours(0, 0, 0, 0)),
          },
        },
      });
      const transactionNumber = `POS-${dateStr}-${String(count + 1).padStart(4, "0")}`;

      const transaction = await ctx.prisma.posTransaction.create({
        data: {
          installationId: ctx.installationId,
          registerSessionId: session.id,
          transactionNumber,
          transactionType: input.type,
          status: "DRAFT",
          saleorChannelId: input.saleorChannelId,
          saleorWarehouseId: input.saleorWarehouseId,
          cashierId: ctx.token ?? "unknown",
          subtotal: 0,
          totalDiscount: 0,
          totalTax: 0,
          grandTotal: 0,
          currency: input.currency,
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
        registerSessionId: session.id,
        status: "DRAFT",
      },
      include: {
        lines: {
          orderBy: { lineNumber: "asc" },
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
            orderBy: { lineNumber: "asc" },
          },
          payments: true,
          registerSession: {
            select: {
              id: true,
              registerCode: true,
              openedBy: true,
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
      variantId = searchResult.data.productVariant.id as string;
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
    const originalUnitPrice = pricing?.price?.gross?.amount ?? 0;
    const unitPrice = input.priceOverride ?? originalUnitPrice;
    const currency = pricing?.price?.gross?.currency ?? transaction.currency;

    // Calculate line totals
    const lineSubtotal = unitPrice * input.quantity;
    let lineDiscountAmount = 0;

    if (input.discountAmount) {
      lineDiscountAmount = input.discountAmount;
    } else if (input.discountPercent) {
      lineDiscountAmount = lineSubtotal * (input.discountPercent / 100);
    }

    const lineTotal = lineSubtotal - lineDiscountAmount;

    // Check if this variant already exists in the transaction (without override)
    const existingLine = await ctx.prisma.posTransactionLine.findFirst({
      where: {
        transactionId: transaction.id,
        saleorVariantId: variantId,
        priceOverride: false,
      },
    });

    let line;

    if (existingLine && !input.priceOverride && !input.discountAmount && !input.discountPercent) {
      // Update quantity of existing line
      const newQuantity = existingLine.quantity + input.quantity;
      const newTotal = existingLine.unitPrice.toNumber() * newQuantity;

      line = await ctx.prisma.posTransactionLine.update({
        where: { id: existingLine.id },
        data: {
          quantity: newQuantity,
          lineTotal: newTotal,
        },
      });
    } else {
      // Get next line number
      const lineNumber = transaction.lines.length + 1;

      // Create new line
      line = await ctx.prisma.posTransactionLine.create({
        data: {
          transactionId: transaction.id,
          lineNumber,
          saleorVariantId: variantId,
          saleorVariantSku: (variantData.sku as string) ?? null,
          saleorVariantName: variantData.name as string,
          quantity: input.quantity,
          unitPrice,
          originalUnitPrice,
          priceOverride: input.priceOverride !== undefined,
          priceOverrideBy: input.priceOverride ? ctx.token ?? null : null,
          priceOverrideReason: input.priceOverride ? input.discountReason ?? null : null,
          lineDiscountAmount,
          lineDiscountPercent: input.discountPercent ?? 0,
          discountReason: input.discountReason ?? null,
          lineTotal,
          currency,
          notes: input.notes ?? null,
        },
      });

      // Create audit event if price override or discount
      if (input.priceOverride || input.discountAmount || input.discountPercent) {
        await ctx.prisma.posAuditEvent.create({
          data: {
            installationId: ctx.installationId,
            entityType: "PosTransactionLine",
            entityId: line.id,
            action: input.priceOverride ? "PRICE_OVERRIDE" : "DISCOUNT_APPLIED",
            userId: ctx.token ?? null,
            metadata: {
              transactionId: transaction.id,
              originalPrice: originalUnitPrice,
              newPrice: unitPrice,
              discountAmount: lineDiscountAmount,
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
    const unitPrice = input.priceOverride ?? line.unitPrice.toNumber();
    const lineSubtotal = unitPrice * quantity;

    let lineDiscountAmount = 0;

    if (input.discountAmount !== undefined) {
      lineDiscountAmount = input.discountAmount ?? 0;
    } else if (input.discountPercent !== undefined) {
      lineDiscountAmount = input.discountPercent ? lineSubtotal * (input.discountPercent / 100) : 0;
    } else {
      lineDiscountAmount = line.lineDiscountAmount.toNumber();
    }

    const lineTotal = lineSubtotal - lineDiscountAmount;

    // Track if price/discount changed for audit
    const priceChanged = input.priceOverride !== undefined && input.priceOverride !== line.unitPrice.toNumber();
    const discountChanged =
      input.discountAmount !== undefined || (input.discountPercent !== undefined && input.discountPercent !== line.lineDiscountPercent.toNumber());

    const updatedLine = await ctx.prisma.posTransactionLine.update({
      where: { id: line.id },
      data: {
        quantity,
        unitPrice: input.priceOverride ?? line.unitPrice,
        priceOverride: input.priceOverride !== undefined ? true : line.priceOverride,
        priceOverrideBy: input.priceOverride !== undefined ? ctx.token ?? null : line.priceOverrideBy,
        lineDiscountAmount,
        lineDiscountPercent: input.discountPercent ?? line.lineDiscountPercent,
        discountReason: input.discountReason ?? line.discountReason,
        lineTotal,
        notes: input.notes !== undefined ? input.notes : line.notes,
      },
    });

    // Create audit event if price or discount changed
    if (priceChanged || discountChanged) {
      await ctx.prisma.posAuditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "PosTransactionLine",
          entityId: line.id,
          action: priceChanged ? "PRICE_OVERRIDE" : "DISCOUNT_APPLIED",
          userId: ctx.token ?? null,
          previousState: {
            unitPrice: line.unitPrice.toNumber(),
            discount: line.lineDiscountAmount.toNumber(),
          },
          newState: {
            unitPrice,
            discount: lineDiscountAmount,
          },
          metadata: {
            transactionId: line.transaction.id,
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
      const subtotal = transaction.lines.reduce((sum, line) => sum + line.lineTotal.toNumber(), 0);
      let totalDiscount = 0;

      if (input.discountAmount) {
        totalDiscount = input.discountAmount;
      } else if (input.discountPercent) {
        totalDiscount = subtotal * (input.discountPercent / 100);
      }

      const grandTotal = subtotal - totalDiscount + transaction.totalTax.toNumber();

      const updatedTransaction = await ctx.prisma.posTransaction.update({
        where: { id: transaction.id },
        data: {
          totalDiscount,
          grandTotal,
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
          entityType: "PosTransaction",
          entityId: transaction.id,
          action: "DISCOUNT_APPLIED",
          userId: ctx.token ?? null,
          metadata: {
            subtotal,
            discountAmount: totalDiscount,
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
          registerSessionId: session.id,
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
          voidedBy: ctx.token ?? null,
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
          entityType: "PosTransaction",
          entityId: transaction.id,
          action: "VOIDED",
          userId: ctx.token ?? null,
          metadata: {
            reason: input.voidReason,
            total: transaction.grandTotal.toNumber(),
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
      ...(input?.sessionId && { registerSessionId: input.sessionId }),
      ...(input?.status && { status: input.status }),
      ...(input?.type && { transactionType: input.type }),
      ...(input?.startDate && { startedAt: { gte: input.startDate } }),
      ...(input?.endDate && { startedAt: { lte: input.endDate } }),
    };

    const [transactions, total] = await Promise.all([
      ctx.prisma.posTransaction.findMany({
        where,
        orderBy: { startedAt: "desc" },
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
      orderBy: { startedAt: "desc" },
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

  const subtotal = transaction.lines.reduce((sum, line) => sum + line.lineTotal.toNumber(), 0);
  const lineDiscounts = transaction.lines.reduce((sum, line) => sum + line.lineDiscountAmount.toNumber(), 0);
  const transactionDiscount = transaction.totalDiscount.toNumber();

  // TODO: Calculate tax based on store location and tax-exempt status
  const totalTax = 0;

  const grandTotal = subtotal - transactionDiscount + totalTax;

  return prisma.posTransaction.update({
    where: { id: transactionId },
    data: {
      subtotal: subtotal + lineDiscounts, // Subtotal before discounts
      totalTax,
      grandTotal,
    },
    include: {
      lines: {
        orderBy: { lineNumber: "asc" },
      },
      payments: true,
    },
  });
}
