import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createLogger } from "@/lib/logger";
import { protectedClientProcedure } from "@/modules/trpc/protected-client-procedure";
import { router } from "@/modules/trpc/trpc-server";

const logger = createLogger("receipts-router");

/**
 * Receipt line item
 */
interface ReceiptLineItem {
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
}

/**
 * Receipt payment item
 */
interface ReceiptPayment {
  method: string;
  amount: number;
  reference?: string;
}

/**
 * Receipt data structure for rendering
 */
export interface ReceiptData {
  // Header
  storeName: string;
  storeAddress?: string;
  storePhone?: string;

  // Transaction info
  transactionNumber: string;
  transactionType: string;
  date: string;
  time: string;
  register: string;
  cashier: string;

  // Line items
  items: ReceiptLineItem[];

  // Totals
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;

  // Payments
  payments: ReceiptPayment[];
  amountTendered: number;
  changeGiven: number;

  // Customer
  customerName?: string;
  customerEmail?: string;

  // Footer
  returnPolicy?: string;
  thankYouMessage?: string;

  // For lookup/returns
  receiptBarcode: string; // Transaction number as barcode
}

/**
 * Receipts Router
 * Generates receipt data for printing/emailing
 */
export const receiptsRouter = router({
  /**
   * Get receipt data for a transaction
   */
  getReceiptData: protectedClientProcedure
    .input(z.object({ transactionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const transaction = await ctx.prisma.posTransaction.findFirst({
        where: {
          id: input.transactionId,
          installationId: ctx.installationId,
        },
        include: {
          lines: {
            orderBy: { createdAt: "asc" },
          },
          payments: {
            where: { status: "COMPLETED" },
          },
          session: true,
        },
      });

      if (!transaction) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transaction not found",
        });
      }

      // Format line items
      const items: ReceiptLineItem[] = transaction.lines.map((line) => ({
        name: `${line.productName} - ${line.variantName}`,
        sku: line.sku,
        quantity: line.quantity,
        unitPrice: line.unitPrice.toNumber(),
        discount: line.discountAmount.toNumber(),
        lineTotal: line.lineTotal.toNumber(),
      }));

      // Format payments
      const payments: ReceiptPayment[] = transaction.payments.map((p) => ({
        method: formatPaymentMethod(p.paymentMethod),
        amount: p.amount.toNumber(),
        reference: p.reference ?? undefined,
      }));

      // Calculate tendered and change
      const amountTendered = transaction.payments.reduce((sum, p) => sum + p.amountTendered.toNumber(), 0);
      const changeGiven = transaction.payments.reduce((sum, p) => sum + p.changeGiven.toNumber(), 0);

      // Format date and time
      const txDate = transaction.completedAt ?? transaction.createdAt;
      const date = txDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const time = txDate.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const receiptData: ReceiptData = {
        // Header - TODO: Get from app settings
        storeName: "Hobby Gaming Store",
        storeAddress: "123 Main Street\nAnytown, ST 12345",
        storePhone: "(555) 123-4567",

        // Transaction info
        transactionNumber: transaction.transactionNumber,
        transactionType: formatTransactionType(transaction.type),
        date,
        time,
        register: transaction.session.registerName,
        cashier: transaction.completedByName ?? transaction.session.openedByName ?? "Unknown",

        // Line items
        items,

        // Totals
        subtotal: transaction.subtotal.toNumber(),
        discountTotal: transaction.discountTotal.toNumber(),
        taxTotal: transaction.taxTotal.toNumber(),
        total: transaction.total.toNumber(),

        // Payments
        payments,
        amountTendered,
        changeGiven,

        // Customer - TODO: Add when customer attachment is implemented
        customerName: undefined,
        customerEmail: undefined,

        // Footer
        returnPolicy: "Returns accepted within 30 days with receipt.",
        thankYouMessage: "Thank you for your business!",

        // Barcode for lookup
        receiptBarcode: transaction.transactionNumber,
      };

      logger.debug("Receipt data generated", {
        transactionId: transaction.id,
        transactionNumber: transaction.transactionNumber,
      });

      return receiptData;
    }),

  /**
   * Generate and return receipt HTML for browser printing
   */
  getReceiptHtml: protectedClientProcedure
    .input(z.object({ transactionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Get receipt data first
      const transaction = await ctx.prisma.posTransaction.findFirst({
        where: {
          id: input.transactionId,
          installationId: ctx.installationId,
        },
        include: {
          lines: {
            orderBy: { createdAt: "asc" },
          },
          payments: {
            where: { status: "COMPLETED" },
          },
          session: true,
        },
      });

      if (!transaction) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transaction not found",
        });
      }

      // Generate receipt HTML
      const html = generateReceiptHtml(transaction);

      return { html };
    }),

  /**
   * Record that a receipt was printed (for audit)
   */
  recordPrint: protectedClientProcedure
    .input(
      z.object({
        transactionId: z.string().uuid(),
        printedByName: z.string().min(1).max(255),
        isReprint: z.boolean().default(false),
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

      // Create audit event
      await ctx.prisma.posAuditEvent.create({
        data: {
          installationId: ctx.installationId,
          transactionId: transaction.id,
          eventType: input.isReprint ? "RECEIPT_REPRINTED" : "RECEIPT_PRINTED",
          performedBy: ctx.token ?? null,
          performedByName: input.printedByName,
        },
      });

      return { success: true };
    }),
});

/**
 * Format payment method for display
 */
function formatPaymentMethod(method: string): string {
  const methodMap: Record<string, string> = {
    CASH: "Cash",
    CARD_PRESENT: "Card",
    CARD_MANUAL: "Card (Manual)",
    GIFT_CARD: "Gift Card",
    STORE_CREDIT: "Store Credit",
    CHECK: "Check",
    OTHER: "Other",
  };

  return methodMap[method] ?? method;
}

/**
 * Format transaction type for display
 */
function formatTransactionType(type: string): string {
  const typeMap: Record<string, string> = {
    SALE: "Sale",
    RETURN: "Return",
    EXCHANGE: "Exchange",
    NO_SALE: "No Sale",
  };

  return typeMap[type] ?? type;
}

/**
 * Generate receipt HTML for browser printing
 * Uses a simple, printer-friendly layout
 */
function generateReceiptHtml(transaction: {
  transactionNumber: string;
  type: string;
  completedAt: Date | null;
  createdAt: Date;
  subtotal: { toNumber: () => number };
  discountTotal: { toNumber: () => number };
  taxTotal: { toNumber: () => number };
  total: { toNumber: () => number };
  completedByName: string | null;
  lines: Array<{
    productName: string;
    variantName: string;
    sku: string | null;
    quantity: number;
    unitPrice: { toNumber: () => number };
    discountAmount: { toNumber: () => number };
    lineTotal: { toNumber: () => number };
  }>;
  payments: Array<{
    paymentMethod: string;
    amount: { toNumber: () => number };
    amountTendered: { toNumber: () => number };
    changeGiven: { toNumber: () => number };
  }>;
  session: {
    registerName: string;
    openedByName: string | null;
  };
}): string {
  const txDate = transaction.completedAt ?? transaction.createdAt;
  const dateStr = txDate.toLocaleDateString("en-US");
  const timeStr = txDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;

  const linesHtml = transaction.lines
    .map(
      (line) => `
      <tr>
        <td class="item-name">
          ${line.productName}<br>
          <small>${line.variantName}${line.sku ? ` (${line.sku})` : ""}</small>
        </td>
        <td class="item-qty">${line.quantity}</td>
        <td class="item-price">${formatCurrency(line.unitPrice.toNumber())}</td>
        <td class="item-total">${formatCurrency(line.lineTotal.toNumber())}</td>
      </tr>
      ${
        line.discountAmount.toNumber() > 0
          ? `<tr class="discount-row"><td colspan="3">Discount</td><td>-${formatCurrency(line.discountAmount.toNumber())}</td></tr>`
          : ""
      }
    `
    )
    .join("");

  const paymentsHtml = transaction.payments
    .map(
      (p) => `
      <tr>
        <td>${formatPaymentMethod(p.paymentMethod)}</td>
        <td class="amount">${formatCurrency(p.amount.toNumber())}</td>
      </tr>
    `
    )
    .join("");

  const totalChange = transaction.payments.reduce((sum, p) => sum + p.changeGiven.toNumber(), 0);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt - ${transaction.transactionNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      font-size: 12px;
      width: 80mm;
      margin: 0 auto;
      padding: 5mm;
    }
    .header { text-align: center; margin-bottom: 10px; }
    .store-name { font-size: 16px; font-weight: bold; }
    .store-info { font-size: 10px; }
    .divider { border-top: 1px dashed #000; margin: 8px 0; }
    .tx-info { margin-bottom: 10px; }
    .tx-info td { padding: 2px 0; }
    .items { width: 100%; border-collapse: collapse; }
    .items th { text-align: left; border-bottom: 1px solid #000; padding: 4px 0; }
    .items td { padding: 4px 0; vertical-align: top; }
    .item-name { width: 40%; }
    .item-qty { width: 15%; text-align: center; }
    .item-price { width: 20%; text-align: right; }
    .item-total { width: 25%; text-align: right; }
    .discount-row { color: #666; font-size: 10px; }
    .totals { width: 100%; margin-top: 10px; }
    .totals td { padding: 2px 0; }
    .totals .label { text-align: right; padding-right: 10px; }
    .totals .amount { text-align: right; }
    .total-row { font-weight: bold; font-size: 14px; border-top: 1px solid #000; }
    .payments { width: 100%; margin-top: 10px; }
    .payments td { padding: 2px 0; }
    .payments .amount { text-align: right; }
    .change-row { font-weight: bold; }
    .footer { text-align: center; margin-top: 15px; font-size: 10px; }
    .barcode { font-family: 'Libre Barcode 39', cursive; font-size: 40px; margin: 10px 0; }
    @media print {
      body { width: 100%; padding: 0; }
      @page { margin: 0; size: 80mm auto; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="store-name">Hobby Gaming Store</div>
    <div class="store-info">
      123 Main Street<br>
      Anytown, ST 12345<br>
      (555) 123-4567
    </div>
  </div>

  <div class="divider"></div>

  <table class="tx-info">
    <tr><td>Transaction:</td><td>${transaction.transactionNumber}</td></tr>
    <tr><td>Type:</td><td>${formatTransactionType(transaction.type)}</td></tr>
    <tr><td>Date:</td><td>${dateStr} ${timeStr}</td></tr>
    <tr><td>Register:</td><td>${transaction.session.registerName}</td></tr>
    <tr><td>Cashier:</td><td>${transaction.completedByName ?? transaction.session.openedByName ?? "Unknown"}</td></tr>
  </table>

  <div class="divider"></div>

  <table class="items">
    <thead>
      <tr>
        <th>Item</th>
        <th class="item-qty">Qty</th>
        <th class="item-price">Price</th>
        <th class="item-total">Total</th>
      </tr>
    </thead>
    <tbody>
      ${linesHtml}
    </tbody>
  </table>

  <div class="divider"></div>

  <table class="totals">
    <tr>
      <td class="label">Subtotal:</td>
      <td class="amount">${formatCurrency(transaction.subtotal.toNumber())}</td>
    </tr>
    ${
      transaction.discountTotal.toNumber() > 0
        ? `<tr><td class="label">Discount:</td><td class="amount">-${formatCurrency(transaction.discountTotal.toNumber())}</td></tr>`
        : ""
    }
    ${
      transaction.taxTotal.toNumber() > 0
        ? `<tr><td class="label">Tax:</td><td class="amount">${formatCurrency(transaction.taxTotal.toNumber())}</td></tr>`
        : ""
    }
    <tr class="total-row">
      <td class="label">TOTAL:</td>
      <td class="amount">${formatCurrency(transaction.total.toNumber())}</td>
    </tr>
  </table>

  <div class="divider"></div>

  <table class="payments">
    ${paymentsHtml}
    ${totalChange > 0 ? `<tr class="change-row"><td>Change:</td><td class="amount">${formatCurrency(totalChange)}</td></tr>` : ""}
  </table>

  <div class="divider"></div>

  <div class="footer">
    <p>Returns accepted within 30 days with receipt.</p>
    <p>Thank you for your business!</p>
    <div class="barcode">*${transaction.transactionNumber}*</div>
    <p>${transaction.transactionNumber}</p>
  </div>
</body>
</html>
  `.trim();
}
