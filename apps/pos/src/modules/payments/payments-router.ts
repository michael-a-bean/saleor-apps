import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createLogger } from "@/lib/logger";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

const logger = createLogger("payments-router");

/**
 * Payment schema for recording a payment
 */
const recordPaymentSchema = z.object({
  transactionId: z.string().uuid(),
  methodType: z.enum(["CASH", "CARD_PRESENT", "CARD_MANUAL", "GIFT_CARD", "STORE_CREDIT", "CHECK", "OTHER"]),
  amount: z.number().positive(),
  tipAmount: z.number().min(0).default(0),
  // Cash-specific
  amountTendered: z.number().positive().optional(), // For calculating change
  // Card-specific (will be used in Phase 2)
  cardLastFour: z.string().length(4).optional(),
  cardBrand: z.string().max(20).optional(),
  authCode: z.string().optional(),
  externalPaymentId: z.string().optional(), // Stripe PI, etc.
  paymentGateway: z.string().optional(), // "stripe", "square", etc.
  // Gift card / store credit
  giftCardNumber: z.string().optional(),
});

/**
 * Complete transaction schema
 */
const completeTransactionSchema = z.object({
  transactionId: z.string().uuid(),
  completedByName: z.string().min(1).max(255),
});

/**
 * Payments Router
 * Handles payment recording and transaction completion
 */
export const paymentsRouter = router({
  /**
   * Record a payment against a transaction
   */
  recordPayment: protectedClientProcedure.input(recordPaymentSchema).mutation(async ({ ctx, input }) => {
    const transaction = await ctx.prisma.posTransaction.findFirst({
      where: {
        id: input.transactionId,
        installationId: ctx.installationId,
      },
      include: {
        payments: true,
        lines: true,
        registerSession: true,
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
        message: `Cannot add payment to a ${transaction.status.toLowerCase()} transaction`,
      });
    }

    if (transaction.lines.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot add payment to an empty transaction",
      });
    }

    // Calculate remaining balance
    const existingPayments = transaction.payments.reduce((sum, p) => sum + p.totalAmount.toNumber(), 0);
    const transactionTotal = transaction.grandTotal.toNumber();
    const remainingBalance = transactionTotal - existingPayments;

    const totalAmount = input.amount + input.tipAmount;
    if (totalAmount > remainingBalance + 0.01) {
      // Allow small rounding
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Payment amount ($${totalAmount.toFixed(2)}) exceeds remaining balance ($${remainingBalance.toFixed(2)})`,
      });
    }

    // Calculate change for cash payments
    let changeGiven: number | null = null;

    if (input.methodType === "CASH" && input.amountTendered) {
      if (input.amountTendered < totalAmount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Amount tendered is less than payment amount",
        });
      }
      changeGiven = input.amountTendered - totalAmount;
    }

    // Get next payment number
    const paymentNumber = transaction.payments.length + 1;

    // Create the payment record
    const payment = await ctx.prisma.posPayment.create({
      data: {
        transactionId: transaction.id,
        paymentNumber,
        methodType: input.methodType,
        status: "COMPLETED", // Cash payments complete immediately
        amount: input.amount,
        tipAmount: input.tipAmount,
        totalAmount,
        currency: transaction.currency,
        amountTendered: input.amountTendered ?? null,
        changeGiven: changeGiven ?? null,
        cardLastFour: input.cardLastFour,
        cardBrand: input.cardBrand,
        authCode: input.authCode,
        externalPaymentId: input.externalPaymentId,
        paymentGateway: input.paymentGateway,
        giftCardNumber: input.giftCardNumber,
      },
    });

    // Record cash movement for cash payments
    if (input.methodType === "CASH") {
      await ctx.prisma.cashMovement.create({
        data: {
          registerSessionId: transaction.registerSession.id,
          movementType: transaction.transactionType === "RETURN" ? "RETURN_CASH" : "SALE_CASH",
          amount: input.amount,
          currency: transaction.currency,
          posTransactionId: transaction.id,
          performedBy: ctx.token ?? "unknown",
          notes: `Payment for ${transaction.transactionNumber}`,
        },
      });
    }

    logger.info("Payment recorded", {
      transactionId: transaction.id,
      paymentId: payment.id,
      method: input.methodType,
      amount: input.amount,
      changeGiven,
    });

    // Check if transaction is fully paid
    const totalPaid = existingPayments + totalAmount;
    const isFullyPaid = totalPaid >= transactionTotal - 0.01; // Allow small rounding

    return {
      payment,
      changeGiven: changeGiven ?? 0,
      totalPaid,
      remainingBalance: Math.max(0, transactionTotal - totalPaid),
      isFullyPaid,
    };
  }),

  /**
   * Complete a fully-paid transaction
   * Creates the Saleor order and marks transaction as completed
   */
  complete: protectedClientProcedure.input(completeTransactionSchema).mutation(async ({ ctx, input }) => {
    const transaction = await ctx.prisma.posTransaction.findFirst({
      where: {
        id: input.transactionId,
        installationId: ctx.installationId,
      },
      include: {
        payments: true,
        lines: true,
        registerSession: true,
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
        message: `Cannot complete a ${transaction.status.toLowerCase()} transaction`,
      });
    }

    if (transaction.lines.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot complete an empty transaction",
      });
    }

    // Verify full payment
    const totalPaid = transaction.payments.reduce((sum, p) => sum + p.totalAmount.toNumber(), 0);
    const transactionTotal = transaction.grandTotal.toNumber();

    if (totalPaid < transactionTotal - 0.01) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Transaction is not fully paid. Paid: $${totalPaid.toFixed(2)}, Total: $${transactionTotal.toFixed(2)}`,
      });
    }

    // Create Saleor order via draft order flow
    let saleorOrderId: string | null = null;

    try {
      // Create draft order
      const createOrderResult = await ctx.apiClient!.mutation(
        `
        mutation CreateDraftOrder($input: DraftOrderCreateInput!) {
          draftOrderCreate(input: $input) {
            order {
              id
              number
            }
            errors {
              field
              message
            }
          }
        }
      `,
        {
          input: {
            channelId: transaction.saleorChannelId,
            lines: transaction.lines.map((line) => ({
              variantId: line.saleorVariantId,
              quantity: line.quantity,
              ...(line.priceOverride && {
                price: line.unitPrice.toNumber(),
              }),
            })),
            // TODO: Add customer if attached
            // TODO: Add shipping address for POS location
          },
        }
      );

      if (createOrderResult.data?.draftOrderCreate?.errors?.length > 0) {
        throw new Error(createOrderResult.data.draftOrderCreate.errors[0].message);
      }

      const draftOrderId = createOrderResult.data?.draftOrderCreate?.order?.id;

      if (!draftOrderId) {
        throw new Error("Failed to create draft order");
      }

      // Complete the draft order
      const completeOrderResult = await ctx.apiClient!.mutation(
        `
        mutation CompleteDraftOrder($id: ID!) {
          draftOrderComplete(id: $id) {
            order {
              id
              number
            }
            errors {
              field
              message
            }
          }
        }
      `,
        { id: draftOrderId }
      );

      if (completeOrderResult.data?.draftOrderComplete?.errors?.length > 0) {
        throw new Error(completeOrderResult.data.draftOrderComplete.errors[0].message);
      }

      saleorOrderId = completeOrderResult.data?.draftOrderComplete?.order?.id;

      // Mark order as paid
      if (saleorOrderId) {
        await ctx.apiClient!.mutation(
          `
          mutation MarkOrderAsPaid($id: ID!) {
            orderMarkAsPaid(id: $id) {
              order {
                id
                isPaid
              }
              errors {
                field
                message
              }
            }
          }
        `,
          { id: saleorOrderId }
        );
      }
    } catch (error) {
      logger.error("Failed to create Saleor order", {
        transactionId: transaction.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue - we can still complete the POS transaction even if Saleor sync fails
      // The order can be synced later via offline queue
    }

    // Update transaction status
    const completedTransaction = await ctx.prisma.posTransaction.update({
      where: { id: transaction.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        saleorOrderId,
        completedBy: ctx.token ?? input.completedByName,
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
        action: "COMPLETED",
        userId: ctx.token ?? null,
        metadata: {
          total: transactionTotal,
          paymentCount: transaction.payments.length,
          saleorOrderId,
          completedByName: input.completedByName,
        },
      },
    });

    logger.info("Transaction completed", {
      transactionId: transaction.id,
      transactionNumber: transaction.transactionNumber,
      total: transactionTotal,
      saleorOrderId,
    });

    return completedTransaction;
  }),

  /**
   * Get payment summary for a transaction
   */
  getSummary: protectedClientProcedure
    .input(z.object({ transactionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const transaction = await ctx.prisma.posTransaction.findFirst({
        where: {
          id: input.transactionId,
          installationId: ctx.installationId,
        },
        include: {
          payments: true,
          lines: true,
        },
      });

      if (!transaction) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transaction not found",
        });
      }

      const subtotal = transaction.subtotal.toNumber();
      const discountTotal = transaction.totalDiscount.toNumber();
      const taxTotal = transaction.totalTax.toNumber();
      const total = transaction.grandTotal.toNumber();
      const totalPaid = transaction.payments.reduce((sum, p) => sum + p.totalAmount.toNumber(), 0);
      const remainingBalance = Math.max(0, total - totalPaid);
      const changeGiven = transaction.payments.reduce((sum, p) => sum + (p.changeGiven?.toNumber() ?? 0), 0);

      const paymentBreakdown = transaction.payments.reduce(
        (acc, p) => {
          const method = p.methodType;

          if (!acc[method]) {
            acc[method] = 0;
          }
          acc[method] += p.totalAmount.toNumber();

          return acc;
        },
        {} as Record<string, number>
      );

      return {
        subtotal,
        discountTotal,
        taxTotal,
        total,
        totalPaid,
        remainingBalance,
        changeGiven,
        isFullyPaid: totalPaid >= total - 0.01,
        paymentBreakdown,
        payments: transaction.payments,
      };
    }),

  /**
   * Void a payment (before transaction completion)
   */
  voidPayment: protectedClientProcedure
    .input(
      z.object({
        paymentId: z.string().uuid(),
        reason: z.string().min(1).max(500),
        voidedByName: z.string().min(1).max(255),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const payment = await ctx.prisma.posPayment.findFirst({
        where: { id: input.paymentId },
        include: {
          transaction: {
            include: { registerSession: true },
          },
        },
      });

      if (!payment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Payment not found",
        });
      }

      if (payment.transaction.installationId !== ctx.installationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Payment not found",
        });
      }

      if (payment.transaction.status !== "DRAFT") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot void payment on a completed transaction",
        });
      }

      if (payment.status === "VOIDED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Payment is already voided",
        });
      }

      // Void the payment
      const voidedPayment = await ctx.prisma.posPayment.update({
        where: { id: payment.id },
        data: {
          status: "VOIDED",
        },
      });

      // Reverse cash movement if it was cash
      if (payment.methodType === "CASH") {
        // Create a reverse cash movement
        await ctx.prisma.cashMovement.create({
          data: {
            registerSessionId: payment.transaction.registerSession.id,
            posTransactionId: payment.transaction.id,
            movementType: "RETURN_CASH", // Reversing a sale
            amount: -payment.amount.toNumber(), // Negative to reverse
            currency: payment.currency,
            performedBy: ctx.token ?? "unknown",
            notes: `Voided payment: ${input.reason}`,
          },
        });
      }

      // Create audit event
      await ctx.prisma.posAuditEvent.create({
        data: {
          installationId: ctx.installationId,
          entityType: "PosPayment",
          entityId: payment.id,
          action: "VOIDED",
          userId: ctx.token ?? null,
          metadata: {
            transactionId: payment.transaction.id,
            method: payment.methodType,
            amount: payment.amount.toNumber(),
            reason: input.reason,
            voidedByName: input.voidedByName,
          },
        },
      });

      return voidedPayment;
    }),
});
