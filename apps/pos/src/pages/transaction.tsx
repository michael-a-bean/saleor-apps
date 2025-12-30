import { Box, Button, Input, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const TransactionPage: NextPage = () => {
  const router = useRouter();
  const utils = trpcClient.useUtils();
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  const [barcodeInput, setBarcodeInput] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  // Check for open register
  const { data: currentSession, isLoading: sessionLoading } = trpcClient.register.current.useQuery();

  // Get or create current transaction
  const { data: currentTransaction, isLoading: txLoading } = trpcClient.transactions.getCurrent.useQuery(undefined, {
    enabled: !!currentSession,
  });

  // Mutations
  const createTransaction = trpcClient.transactions.create.useMutation({
    onSuccess: () => utils.transactions.getCurrent.invalidate(),
  });

  const addLine = trpcClient.transactions.addLine.useMutation({
    onSuccess: () => {
      utils.transactions.getCurrent.invalidate();
      setBarcodeInput("");
      barcodeInputRef.current?.focus();
    },
  });

  const updateLine = trpcClient.transactions.updateLine.useMutation({
    onSuccess: () => utils.transactions.getCurrent.invalidate(),
  });

  const removeLine = trpcClient.transactions.removeLine.useMutation({
    onSuccess: () => utils.transactions.getCurrent.invalidate(),
  });

  const recordPayment = trpcClient.payments.recordPayment.useMutation();

  const completeTransaction = trpcClient.payments.complete.useMutation({
    onSuccess: (data) => {
      // Print receipt
      printReceipt(data.id);
      // Reset for next transaction
      utils.transactions.getCurrent.invalidate();
      setShowPaymentModal(false);
      setCashAmount("");
    },
  });

  const voidTransaction = trpcClient.transactions.void.useMutation({
    onSuccess: () => {
      utils.transactions.getCurrent.invalidate();
    },
  });

  // Focus barcode input on mount
  useEffect(() => {
    if (currentSession && !txLoading) {
      barcodeInputRef.current?.focus();
    }
  }, [currentSession, txLoading]);

  // Handle barcode scan (Enter key)
  const handleBarcodeSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!barcodeInput.trim()) return;

      let txId = currentTransaction?.id;

      // Create transaction if none exists
      if (!txId) {
        const newTx = await createTransaction.mutateAsync({ type: "SALE" });

        txId = newTx.id;
      }

      // Add line by barcode/SKU
      addLine.mutate({
        transactionId: txId,
        sku: barcodeInput.trim(),
        quantity: 1,
      });
    },
    [barcodeInput, currentTransaction, createTransaction, addLine]
  );

  const handleQuantityChange = (lineId: string, newQty: number) => {
    if (newQty <= 0) {
      removeLine.mutate({ lineId });
    } else {
      updateLine.mutate({ lineId, quantity: newQty });
    }
  };

  const handleRemoveLine = (lineId: string) => {
    removeLine.mutate({ lineId });
  };

  const handleVoidTransaction = () => {
    if (!currentTransaction) return;

    const reason = prompt("Enter void reason:");

    if (reason) {
      voidTransaction.mutate({
        transactionId: currentTransaction.id,
        voidReason: reason,
        voidedByName: "Cashier", // TODO: Get from user context
      });
    }
  };

  const handleCashPayment = async () => {
    if (!currentTransaction) return;

    const amount = parseFloat(cashAmount);

    if (isNaN(amount) || amount <= 0) {
      alert("Please enter a valid amount");

      return;
    }

    const total = currentTransaction.total;

    // Record cash payment
    const result = await recordPayment.mutateAsync({
      transactionId: currentTransaction.id,
      paymentMethod: "CASH",
      amount: Math.min(amount, total),
      amountTendered: amount,
    });

    // If fully paid, complete the transaction
    if (result.isFullyPaid) {
      await completeTransaction.mutateAsync({
        transactionId: currentTransaction.id,
        completedByName: "Cashier", // TODO: Get from user context
      });
    } else {
      // Show remaining balance
      utils.transactions.getCurrent.invalidate();
      setCashAmount("");
      alert(`Payment recorded. Remaining: $${result.remainingBalance.toFixed(2)}`);
    }
  };

  const handleQuickCash = (amount: number) => {
    setCashAmount(amount.toString());
  };

  const printReceipt = async (transactionId: string) => {
    try {
      const { html } = await utils.receipts.getReceiptHtml.fetch({ transactionId });

      // Open in new window for printing
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

  // Loading states
  if (sessionLoading) {
    return (
      <Box>
        <Text>Loading...</Text>
      </Box>
    );
  }

  // No open register
  if (!currentSession) {
    return (
      <Box display="flex" flexDirection="column" gap={4} alignItems="center" paddingTop={10}>
        <Text size={6}>No register is currently open</Text>
        <Button onClick={() => router.push("/register/open")} variant="primary">
          Open Register
        </Button>
      </Box>
    );
  }

  const total = currentTransaction?.total ?? 0;
  const subtotal = currentTransaction?.subtotal ?? 0;
  const lineCount = currentTransaction?.lines?.length ?? 0;

  return (
    <Box display="flex" gap={6} __height="calc(100vh - 100px)">
      {/* Left Side - Item Entry and Cart */}
      <Box __flex="1" display="flex" flexDirection="column" gap={4}>
        {/* Barcode Input */}
        <Box
          padding={4}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
        >
          <form onSubmit={handleBarcodeSubmit}>
            <Box display="flex" gap={2}>
              <Box __flex="1">
                <Input
                  ref={barcodeInputRef}
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder="Scan barcode or enter SKU..."
                  size="large"
                  autoFocus
                />
              </Box>
              <Button type="submit" variant="primary" disabled={addLine.isPending}>
                {addLine.isPending ? "Adding..." : "Add"}
              </Button>
            </Box>
          </form>
          {addLine.error && (
            <Text size={2} color="critical1" marginTop={2}>
              {addLine.error.message}
            </Text>
          )}
        </Box>

        {/* Cart Lines */}
        <Box
          __flex="1"
          overflow="auto"
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
        >
          {lineCount === 0 ? (
            <Box padding={10} display="flex" alignItems="center" justifyContent="center">
              <Text size={5} color="default2">
                Scan an item to begin
              </Text>
            </Box>
          ) : (
            <Box>
              {/* Header */}
              <Box
                display="grid"
                __gridTemplateColumns="2fr 100px 100px 100px 50px"
                gap={2}
                padding={3}
                backgroundColor="default1"
                borderBottomWidth={1}
                borderBottomStyle="solid"
                borderBottomColor="default1"
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
                <Text size={2} fontWeight="bold" textAlign="center">
                  &nbsp;
                </Text>
              </Box>

              {/* Lines */}
              {currentTransaction?.lines?.map((line) => (
                <Box
                  key={line.id}
                  display="grid"
                  __gridTemplateColumns="2fr 100px 100px 100px 50px"
                  gap={2}
                  padding={3}
                  borderBottomWidth={1}
                  borderBottomStyle="solid"
                  borderBottomColor="default1"
                  alignItems="center"
                >
                  <Box>
                    <Text size={3}>{line.productName}</Text>
                    <Text size={2} color="default2">
                      {line.variantName}
                      {line.sku && ` (${line.sku})`}
                    </Text>
                  </Box>
                  <Box display="flex" alignItems="center" justifyContent="center" gap={1}>
                    <Button
                      variant="tertiary"
                      size="small"
                      onClick={() => handleQuantityChange(line.id, line.quantity - 1)}
                    >
                      -
                    </Button>
                    <Text size={3}>{line.quantity}</Text>
                    <Button
                      variant="tertiary"
                      size="small"
                      onClick={() => handleQuantityChange(line.id, line.quantity + 1)}
                    >
                      +
                    </Button>
                  </Box>
                  <Text size={3} textAlign="right">
                    ${line.unitPrice.toFixed(2)}
                  </Text>
                  <Text size={3} textAlign="right" fontWeight="bold">
                    ${line.lineTotal.toFixed(2)}
                  </Text>
                  <Box textAlign="center">
                    <Button
                      variant="tertiary"
                      size="small"
                      onClick={() => handleRemoveLine(line.id)}
                    >
                      X
                    </Button>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Box>

      {/* Right Side - Totals and Payment */}
      <Box __width="300px" display="flex" flexDirection="column" gap={4}>
        {/* Transaction Info */}
        {currentTransaction && (
          <Box padding={3} backgroundColor="default1" borderRadius={4}>
            <Text size={2} color="default2">
              {currentTransaction.transactionNumber}
            </Text>
          </Box>
        )}

        {/* Totals */}
        <Box
          padding={4}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
          __flex="1"
        >
          <Box display="flex" flexDirection="column" gap={2}>
            <Box display="flex" justifyContent="space-between">
              <Text size={3}>Subtotal</Text>
              <Text size={3}>${subtotal.toFixed(2)}</Text>
            </Box>
            <Box display="flex" justifyContent="space-between">
              <Text size={3}>Tax</Text>
              <Text size={3}>$0.00</Text>
            </Box>
            <Box
              display="flex"
              justifyContent="space-between"
              paddingTop={2}
              borderTopWidth={1}
              borderTopStyle="solid"
              borderTopColor="default1"
            >
              <Text size={6} fontWeight="bold">
                Total
              </Text>
              <Text size={6} fontWeight="bold">
                ${total.toFixed(2)}
              </Text>
            </Box>
            <Box paddingTop={2}>
              <Text size={2} color="default2">
                {lineCount} item{lineCount !== 1 ? "s" : ""}
              </Text>
            </Box>
          </Box>
        </Box>

        {/* Payment Buttons */}
        <Box display="flex" flexDirection="column" gap={2}>
          <Button
            variant="primary"
            size="large"
            onClick={() => setShowPaymentModal(true)}
            disabled={lineCount === 0}
          >
            Pay - ${total.toFixed(2)}
          </Button>

          {currentTransaction && (
            <Button variant="secondary" size="medium" onClick={handleVoidTransaction}>
              Void Transaction
            </Button>
          )}
        </Box>
      </Box>

      {/* Payment Modal */}
      {showPaymentModal && currentTransaction && (
        <Box
          position="fixed"
          __top="0"
          __left="0"
          __right="0"
          __bottom="0"
          backgroundColor="default1"
          __opacity="0.9"
          display="flex"
          alignItems="center"
          justifyContent="center"
          __zIndex="1000"
          onClick={() => setShowPaymentModal(false)}
        >
          <Box
            padding={6}
            backgroundColor="default1"
            borderRadius={4}
            __width="400px"
            onClick={(e) => e.stopPropagation()}
          >
            <Text size={6} fontWeight="bold" marginBottom={4}>
              Payment
            </Text>

            <Box marginBottom={4}>
              <Text size={3} color="default2">
                Amount Due
              </Text>
              <Text size={8} fontWeight="bold">
                ${total.toFixed(2)}
              </Text>
            </Box>

            {/* Quick Cash Buttons */}
            <Box display="grid" __gridTemplateColumns="repeat(3, 1fr)" gap={2} marginBottom={4}>
              {[1, 5, 10, 20, 50, 100].map((amount) => (
                <Button key={amount} variant="secondary" onClick={() => handleQuickCash(amount)}>
                  ${amount}
                </Button>
              ))}
            </Box>

            {/* Custom Amount */}
            <Box marginBottom={4}>
              <Text size={2} marginBottom={1}>
                Cash Amount
              </Text>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={cashAmount}
                onChange={(e) => setCashAmount(e.target.value)}
                placeholder="Enter amount..."
                size="large"
              />
              {cashAmount && parseFloat(cashAmount) > total && (
                <Text size={3} marginTop={2}>
                  Change: ${(parseFloat(cashAmount) - total).toFixed(2)}
                </Text>
              )}
            </Box>

            {/* Action Buttons */}
            <Box display="flex" gap={2}>
              <Button variant="tertiary" onClick={() => setShowPaymentModal(false)} __flex="1">
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleCashPayment}
                disabled={
                  recordPayment.isPending ||
                  completeTransaction.isPending ||
                  !cashAmount ||
                  parseFloat(cashAmount) <= 0
                }
                __flex="1"
              >
                {recordPayment.isPending || completeTransaction.isPending
                  ? "Processing..."
                  : "Complete Sale"}
              </Button>
            </Box>

            {(recordPayment.error || completeTransaction.error) && (
              <Text size={2} color="critical1" marginTop={2}>
                {recordPayment.error?.message || completeTransaction.error?.message}
              </Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default TransactionPage;
