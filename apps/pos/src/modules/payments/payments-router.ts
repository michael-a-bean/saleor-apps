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
  paymentMethod: z.enum(["CASH", "CARD_PRESENT", "CARD_MANUAL", "GIFT_CARD", "STORE_CREDIT", "CHECK", "OTHER"]),
  amount: z.number().positive(),
  // Cash-specific
  amountTendered: z.number().positive().optional(), // For calculating change
  // Card-specific (will be used in Phase 2)
  cardLast4: z.string().length(4).optional(),
  cardBrand: z.string().max(20).optional(),
  stripePaymentIntentId: z.string().optional(),
  // Store credit specific
  customerCreditId: z.string().uuid().optional(),
  // Other
  reference: z.string().max(255).optional(), // External reference (check #, gift card #)
  notes: z.string().max(500).optional(),
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
        session: true,
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
    const existingPayments = transaction.payments.reduce((sum, p) => sum + p.amount.toNumber(), 0);
    const transactionTotal = transaction.total.toNumber();
    const remainingBalance = transactionTotal - existingPayments;

    if (input.amount > remainingBalance + 0.01) {
      // Allow small rounding
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Payment amount ($${input.amount.toFixed(2)}) exceeds remaining balance ($${remainingBalance.toFixed(2)})`,
      });
    }

    // Calculate change for cash payments
    let changeGiven = 0;

    if (input.paymentMethod === "CASH" && input.amountTendered) {
      if (input.amountTendered < input.amount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Amount tendered is less than payment amount",
        });
      }
      changeGiven = input.amountTendered - input.amount;
    }

    // Validate store credit if used
    if (input.paymentMethod === "STORE_CREDIT") {
      if (!input.customerCreditId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Customer credit ID is required for store credit payments",
        });
      }

      const credit = await ctx.prisma.customerCredit.findFirst({
        where: {
          id: input.customerCreditId,
          installationId: { in: ctx.allInstallationIds }, // Can use credits from any related app
        },
      });

      if (!credit) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Customer credit account not found",
        });
      }

      if (credit.balance.toNumber() < input.amount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient store credit balance. Available: $${credit.balance.toNumber().toFixed(2)}`,
        });
      }
    }

    // Create the payment record
    const payment = await ctx.prisma.posPayment.create({
      data: {
        transactionId: transaction.id,
        paymentMethod: input.paymentMethod,
        amount: input.amount,
        amountTendered: input.amountTendered ?? input.amount,
        changeGiven,
        status: "COMPLETED", // Cash payments complete immediately
        cardLast4: input.cardLast4,
        cardBrand: input.cardBrand,
        stripePaymentIntentId: input.stripePaymentIntentId,
        customerCreditId: input.customerCreditId,
        reference: input.reference,
        notes: input.notes,
      },
    });

    // Record cash movement for cash payments
    if (input.paymentMethod === "CASH") {
      await ctx.prisma.cashMovement.create({
        data: {
          sessionId: transaction.session.id,
          transactionId: transaction.id,
          movementType: transaction.type === "RETURN" ? "RETURN_CASH" : "SALE_CASH",
          amount: input.amount,
          performedBy: ctx.token ?? null,
          notes: `Payment for ${transaction.transactionNumber}`,
        },
      });
    }

    // Debit store credit if used
    if (input.paymentMethod === "STORE_CREDIT" && input.customerCreditId) {
      // Update credit balance
      await ctx.prisma.customerCredit.update({
        where: { id: input.customerCreditId },
        data: {
          balance: {
            decrement: input.amount,
          },
        },
      });

      // Create credit transaction record
      await ctx.prisma.creditTransaction.create({
        data: {
          creditAccountId: input.customerCreditId,
          transactionType: "POS_PAYMENT",
          amount: -input.amount, // Negative for debit
          sourcePosTransactionId: transaction.id,
          note: `POS payment for ${transaction.transactionNumber}`,
        },
      });
    }

    logger.info("Payment recorded", {
      transactionId: transaction.id,
      paymentId: payment.id,
      method: input.paymentMethod,
      amount: input.amount,
      changeGiven,
    });

    // Check if transaction is fully paid
    const totalPaid = existingPayments + input.amount;
    const isFullyPaid = totalPaid >= transactionTotal - 0.01; // Allow small rounding

    return {
      payment,
      changeGiven,
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
        session: true,
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
    const totalPaid = transaction.payments.reduce((sum, p) => sum + p.amount.toNumber(), 0);
    const transactionTotal = transaction.total.toNumber();

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
            lines: transaction.lines.map((line) => ({
              variantId: line.saleorVariantId,
              quantity: line.quantity,
              ...(line.priceOverride && {
                price: line.priceOverride.toNumber(),
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
        completedByName: input.completedByName,
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
        sessionId: transaction.session.id,
        eventType: "TRANSACTION_COMPLETED",
        performedBy: ctx.token ?? null,
        performedByName: input.completedByName,
        details: {
          total: transactionTotal,
          paymentCount: transaction.payments.length,
          saleorOrderId,
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
      const discountTotal = transaction.discountTotal.toNumber();
      const taxTotal = transaction.taxTotal.toNumber();
      const total = transaction.total.toNumber();
      const totalPaid = transaction.payments.reduce((sum, p) => sum + p.amount.toNumber(), 0);
      const remainingBalance = Math.max(0, total - totalPaid);
      const changeGiven = transaction.payments.reduce((sum, p) => sum + p.changeGiven.toNumber(), 0);

      const paymentBreakdown = transaction.payments.reduce(
        (acc, p) => {
          const method = p.paymentMethod;

          if (!acc[method]) {
            acc[method] = 0;
          }
          acc[method] += p.amount.toNumber();

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
            include: { session: true },
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
      if (payment.paymentMethod === "CASH") {
        // Create a reverse cash movement
        await ctx.prisma.cashMovement.create({
          data: {
            sessionId: payment.transaction.session.id,
            transactionId: payment.transaction.id,
            movementType: "RETURN_CASH", // Reversing a sale
            amount: -payment.amount.toNumber(), // Negative to reverse
            performedBy: ctx.token ?? null,
            performedByName: input.voidedByName,
            notes: `Voided payment: ${input.reason}`,
          },
        });
      }

      // Restore store credit if it was used
      if (payment.paymentMethod === "STORE_CREDIT" && payment.customerCreditId) {
        await ctx.prisma.customerCredit.update({
          where: { id: payment.customerCreditId },
          data: {
            balance: {
              increment: payment.amount.toNumber(),
            },
          },
        });

        await ctx.prisma.creditTransaction.create({
          data: {
            creditAccountId: payment.customerCreditId,
            transactionType: "POS_REFUND",
            amount: payment.amount.toNumber(), // Positive for credit
            sourcePosTransactionId: payment.transaction.id,
            note: `Voided payment on ${payment.transaction.transactionNumber}: ${input.reason}`,
          },
        });
      }

      // Create audit event
      await ctx.prisma.posAuditEvent.create({
        data: {
          installationId: ctx.installationId,
          transactionId: payment.transaction.id,
          eventType: "PAYMENT_VOIDED",
          performedBy: ctx.token ?? null,
          performedByName: input.voidedByName,
          details: {
            paymentId: payment.id,
            method: payment.paymentMethod,
            amount: payment.amount.toNumber(),
            reason: input.reason,
          },
        },
      });

      return voidedPayment;
    }),
});
