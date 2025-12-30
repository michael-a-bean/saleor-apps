import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";

import { trpcClient } from "@/modules/trpc/trpc-client";

const TransactionDetailPage: NextPage = () => {
  const router = useRouter();
  const { id } = router.query;
  const utils = trpcClient.useUtils();

  const { data: transaction, isLoading } = trpcClient.transactions.getById.useQuery(
    { id: id as string },
    { enabled: !!id }
  );

  const { data: paymentSummary } = trpcClient.payments.getSummary.useQuery(
    { transactionId: id as string },
    { enabled: !!id }
  );

  const printReceipt = async () => {
    if (!transaction) return;

    try {
      const { html } = await utils.receipts.getReceiptHtml.fetch({ transactionId: transaction.id });

      const printWindow = window.open("", "_blank", "width=400,height=600");

      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
      }
    } catch (error) {
      console.error("Failed to print receipt:", error);
    }
  };

  if (isLoading || !transaction) {
    return (
      <Box>
        <Text>Loading transaction...</Text>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Box display="flex" alignItems="center" gap={4}>
          <Button variant="tertiary" onClick={() => router.push("/transactions")}>
            &larr; Back
          </Button>
          <Box>
            <Text size={8} fontWeight="bold">
              {transaction.transactionNumber}
            </Text>
            <Text size={3} color="default2">
              {formatType(transaction.transactionType)} - {transaction.status}
            </Text>
          </Box>
        </Box>
        {transaction.status === "COMPLETED" && (
          <Button variant="secondary" onClick={printReceipt}>
            Print Receipt
          </Button>
        )}
      </Box>

      <Box display="grid" __gridTemplateColumns="2fr 1fr" gap={6}>
        {/* Left Column - Lines */}
        <Box display="flex" flexDirection="column" gap={4}>
          {/* Transaction Info */}
          <Box
            padding={4}
            borderRadius={4}
            borderWidth={1}
            borderStyle="solid"
            borderColor="default1"
          >
            <Text size={5} fontWeight="bold" marginBottom={3}>
              Transaction Details
            </Text>
            <Box display="grid" __gridTemplateColumns="repeat(3, 1fr)" gap={4}>
              <Box>
                <Text size={2} color="default2">
                  Created
                </Text>
                <Text size={3}>{new Date(transaction.createdAt).toLocaleString()}</Text>
              </Box>
              {transaction.completedAt && (
                <Box>
                  <Text size={2} color="default2">
                    Completed
                  </Text>
                  <Text size={3}>{new Date(transaction.completedAt).toLocaleString()}</Text>
                </Box>
              )}
              <Box>
                <Text size={2} color="default2">
                  Register
                </Text>
                <Text size={3}>{transaction.registerSession?.registerCode ?? "Unknown"}</Text>
              </Box>
              {transaction.completedBy && (
                <Box>
                  <Text size={2} color="default2">
                    Completed By
                  </Text>
                  <Text size={3}>{transaction.completedBy}</Text>
                </Box>
              )}
              {transaction.saleorOrderId && (
                <Box>
                  <Text size={2} color="default2">
                    Saleor Order
                  </Text>
                  <Text size={3}>{transaction.saleorOrderId}</Text>
                </Box>
              )}
            </Box>
          </Box>

          {/* Line Items */}
          <Box
            padding={4}
            borderRadius={4}
            borderWidth={1}
            borderStyle="solid"
            borderColor="default1"
          >
            <Text size={5} fontWeight="bold" marginBottom={3}>
              Items ({transaction.lines.length})
            </Text>

            <Box>
              {/* Header */}
              <Box
                display="grid"
                __gridTemplateColumns="2fr 80px 100px 100px"
                gap={3}
                padding={2}
                backgroundColor="default1"
                borderRadius={2}
                marginBottom={2}
              >
                <Text size={2} fontWeight="bold">
                  Item
                </Text>
                <Text size={2} fontWeight="bold" textAlign="center">
                  Qty
                </Text>
                <Text size={2} fontWeight="bold" textAlign="right">
                  Price
                </Text>
                <Text size={2} fontWeight="bold" textAlign="right">
                  Total
                </Text>
              </Box>

              {/* Lines */}
              {transaction.lines.map((line) => (
                <Box
                  key={line.id}
                  display="grid"
                  __gridTemplateColumns="2fr 80px 100px 100px"
                  gap={3}
                  padding={2}
                  borderBottomWidth={1}
                  borderBottomStyle="solid"
                  borderColor="default1"
                >
                  <Box>
                    <Text size={3}>{line.saleorVariantName ?? "Unknown Item"}</Text>
                    <Text size={2} color="default2">
                      {line.saleorVariantSku && `SKU: ${line.saleorVariantSku}`}
                    </Text>
                    {Number(line.lineDiscountAmount) > 0 && (
                      <Text size={1} color="success1">
                        Discount: -${Number(line.lineDiscountAmount).toFixed(2)}
                      </Text>
                    )}
                  </Box>
                  <Text size={3} textAlign="center">
                    {line.quantity}
                  </Text>
                  <Text size={3} textAlign="right">
                    ${Number(line.unitPrice).toFixed(2)}
                  </Text>
                  <Text size={3} textAlign="right" fontWeight="bold">
                    ${Number(line.lineTotal).toFixed(2)}
                  </Text>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>

        {/* Right Column - Totals & Payments */}
        <Box display="flex" flexDirection="column" gap={4}>
          {/* Totals */}
          <Box
            padding={4}
            borderRadius={4}
            borderWidth={1}
            borderStyle="solid"
            borderColor="default1"
          >
            <Text size={5} fontWeight="bold" marginBottom={3}>
              Totals
            </Text>

            <Box display="flex" flexDirection="column" gap={2}>
              <Box display="flex" justifyContent="space-between">
                <Text size={3}>Subtotal</Text>
                <Text size={3}>${Number(transaction.subtotal).toFixed(2)}</Text>
              </Box>
              {Number(transaction.totalDiscount) > 0 && (
                <Box display="flex" justifyContent="space-between">
                  <Text size={3}>Discount</Text>
                  <Text size={3} color="success1">
                    -${Number(transaction.totalDiscount).toFixed(2)}
                  </Text>
                </Box>
              )}
              <Box display="flex" justifyContent="space-between">
                <Text size={3}>Tax</Text>
                <Text size={3}>${Number(transaction.totalTax).toFixed(2)}</Text>
              </Box>
              <Box
                display="flex"
                justifyContent="space-between"
                paddingTop={2}
                borderTopWidth={1}
                borderTopStyle="solid"
                borderColor="default1"
              >
                <Text size={5} fontWeight="bold">
                  Total
                </Text>
                <Text size={5} fontWeight="bold">
                  ${Number(transaction.grandTotal).toFixed(2)}
                </Text>
              </Box>
            </Box>
          </Box>

          {/* Payments */}
          {paymentSummary && paymentSummary.payments.length > 0 && (
            <Box
              padding={4}
              borderRadius={4}
              borderWidth={1}
              borderStyle="solid"
              borderColor="default1"
            >
              <Text size={5} fontWeight="bold" marginBottom={3}>
                Payments
              </Text>

              <Box display="flex" flexDirection="column" gap={2}>
                {paymentSummary.payments.map((payment) => (
                  <Box
                    key={payment.id}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <Box>
                      <Text size={3}>{formatPaymentMethod(payment.methodType)}</Text>
                      {payment.referenceNumber && (
                        <Text size={1} color="default2">
                          Ref: {payment.referenceNumber}
                        </Text>
                      )}
                    </Box>
                    <Text size={3}>${Number(payment.amount).toFixed(2)}</Text>
                  </Box>
                ))}

                {paymentSummary.changeGiven > 0 && (
                  <Box
                    display="flex"
                    justifyContent="space-between"
                    paddingTop={2}
                    borderTopWidth={1}
                    borderTopStyle="solid"
                    borderColor="default1"
                  >
                    <Text size={3}>Change Given</Text>
                    <Text size={3}>${paymentSummary.changeGiven.toFixed(2)}</Text>
                  </Box>
                )}
              </Box>
            </Box>
          )}

          {/* Void Info */}
          {transaction.status === "VOIDED" && transaction.voidReason && (
            <Box padding={4} borderRadius={4} backgroundColor="critical1">
              <Text size={4} fontWeight="bold" marginBottom={2}>
                Voided
              </Text>
              <Text size={2}>{transaction.voidReason}</Text>
              {transaction.voidedAt && (
                <Text size={1} marginTop={2}>
                  {new Date(transaction.voidedAt).toLocaleString()}
                </Text>
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};

function formatType(type: string): string {
  const types: Record<string, string> = {
    SALE: "Sale",
    RETURN: "Return",
    EXCHANGE: "Exchange",
    NO_SALE: "No Sale",
  };

  return types[type] ?? type;
}

function formatPaymentMethod(method: string): string {
  const methods: Record<string, string> = {
    CASH: "Cash",
    CARD_PRESENT: "Card",
    CARD_MANUAL: "Card (Manual)",
    GIFT_CARD: "Gift Card",
    STORE_CREDIT: "Store Credit",
    CHECK: "Check",
    OTHER: "Other",
  };

  return methods[method] ?? method;
}

export default TransactionDetailPage;
