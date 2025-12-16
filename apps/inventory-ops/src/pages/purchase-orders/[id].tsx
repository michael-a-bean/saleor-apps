import { Layout } from "@saleor/apps-ui";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const statusColors: Record<string, string> = {
  DRAFT: "#6B7280",
  PENDING_APPROVAL: "#F59E0B",
  APPROVED: "#10B981",
  PARTIALLY_RECEIVED: "#3B82F6",
  FULLY_RECEIVED: "#059669",
  CANCELLED: "#EF4444",
};

const statusLabels: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  PARTIALLY_RECEIVED: "Partially Received",
  FULLY_RECEIVED: "Fully Received",
  CANCELLED: "Cancelled",
};

const formatCurrency = (amount: number | string, currency: string) => {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(num);
};

const formatDate = (date: string | Date | null) => {
  if (!date) return "-";

  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const PurchaseOrderDetailPage = () => {
  const router = useRouter();
  const { id } = router.query;
  const utils = trpcClient.useUtils();

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);

  const { data: po, isLoading, error } = trpcClient.purchaseOrders.getById.useQuery(
    { id: id as string },
    { enabled: !!id }
  );

  const submitMutation = trpcClient.purchaseOrders.submit.useMutation({
    onSuccess: () => {
      utils.purchaseOrders.getById.invalidate({ id: id as string });
      utils.purchaseOrders.list.invalidate();
    },
  });

  const approveMutation = trpcClient.purchaseOrders.approve.useMutation({
    onSuccess: () => {
      utils.purchaseOrders.getById.invalidate({ id: id as string });
      utils.purchaseOrders.list.invalidate();
    },
  });

  const rejectMutation = trpcClient.purchaseOrders.reject.useMutation({
    onSuccess: () => {
      utils.purchaseOrders.getById.invalidate({ id: id as string });
      utils.purchaseOrders.list.invalidate();
      setShowRejectConfirm(false);
    },
  });

  const cancelMutation = trpcClient.purchaseOrders.cancel.useMutation({
    onSuccess: () => {
      utils.purchaseOrders.getById.invalidate({ id: id as string });
      utils.purchaseOrders.list.invalidate();
      setShowCancelConfirm(false);
    },
  });

  const duplicateMutation = trpcClient.purchaseOrders.duplicate.useMutation({
    onSuccess: (newPO) => {
      utils.purchaseOrders.list.invalidate();
      router.push(`/purchase-orders/${newPO.id}`);
    },
  });

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" padding={10}>
        <Text>Loading...</Text>
      </Box>
    );
  }

  if (error || !po) {
    return (
      <Box>
        <Text color="critical1">Error: {error?.message || "Purchase order not found"}</Text>
        <Button onClick={() => router.push("/purchase-orders")} marginTop={4}>
          Back to Purchase Orders
        </Button>
      </Box>
    );
  }

  const totalValue = po.lines.reduce((sum, line) => {
    return sum + line.qtyOrdered * parseFloat(line.expectedUnitCost.toString());
  }, 0);

  const currency = po.lines[0]?.currency || "USD";

  return (
    <Box>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Box display="flex" alignItems="center" gap={4}>
          <Text as="h1" size={10} fontWeight="bold">
            {po.orderNumber}
          </Text>
          <Box
            paddingX={3}
            paddingY={1}
            borderRadius={4}
            style={{ backgroundColor: statusColors[po.status] }}
          >
            <Text size={2} color="buttonDefaultPrimary">
              {statusLabels[po.status]}
            </Text>
          </Box>
        </Box>
        <Box display="flex" gap={2}>
          <Button variant="secondary" onClick={() => router.push("/purchase-orders")}>
            Back
          </Button>
          {po.status === "DRAFT" && (
            <Button variant="primary" onClick={() => router.push(`/purchase-orders/${po.id}/edit`)}>
              Edit
            </Button>
          )}
        </Box>
      </Box>

      {/* PO Details */}
      <Layout.AppSection
        heading="Order Details"
        sideContent={
          <Box display="flex" flexDirection="column" gap={2}>
            <Text>Supplier: {po.supplier.name}</Text>
            <Text size={2} color="default2">
              Code: {po.supplier.code}
            </Text>
          </Box>
        }
      >
        <Layout.AppSectionCard>
          <Box padding={4}>
            <Box display="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: "24px" }}>
              <Box>
                <Text size={2} color="default2">
                  Warehouse
                </Text>
                <Text fontWeight="bold">{po.saleorWarehouseId}</Text>
              </Box>
              <Box>
                <Text size={2} color="default2">
                  Expected Delivery
                </Text>
                <Text fontWeight="bold">{formatDate(po.expectedDeliveryAt)}</Text>
              </Box>
              <Box>
                <Text size={2} color="default2">
                  Created
                </Text>
                <Text fontWeight="bold">{formatDate(po.createdAt)}</Text>
              </Box>
              {po.externalReference && (
                <Box>
                  <Text size={2} color="default2">
                    External Reference
                  </Text>
                  <Text fontWeight="bold">{po.externalReference}</Text>
                </Box>
              )}
              {po.submittedAt && (
                <Box>
                  <Text size={2} color="default2">
                    Submitted
                  </Text>
                  <Text fontWeight="bold">{formatDate(po.submittedAt)}</Text>
                </Box>
              )}
              {po.approvedAt && (
                <Box>
                  <Text size={2} color="default2">
                    Approved
                  </Text>
                  <Text fontWeight="bold">{formatDate(po.approvedAt)}</Text>
                </Box>
              )}
            </Box>
            {po.notes && (
              <Box marginTop={4}>
                <Text size={2} color="default2">
                  Notes
                </Text>
                <Text>{po.notes}</Text>
              </Box>
            )}
          </Box>
        </Layout.AppSectionCard>
      </Layout.AppSection>

      {/* Line Items */}
      <Layout.AppSection
        heading="Line Items"
        sideContent={
          <Box display="flex" flexDirection="column" gap={2}>
            <Text>{po.lines.length} item(s)</Text>
            <Text fontWeight="bold">{formatCurrency(totalValue, currency)}</Text>
          </Box>
        }
      >
        <Layout.AppSectionCard>
          {po.lines.length === 0 ? (
            <Box padding={6} display="flex" flexDirection="column" alignItems="center" gap={4}>
              <Text>No line items yet.</Text>
              {po.status === "DRAFT" && (
                <Button onClick={() => router.push(`/purchase-orders/${po.id}/edit`)}>
                  Add Items
                </Button>
              )}
            </Box>
          ) : (
            <Box as="table" width="100%">
              <Box as="thead">
                <Box as="tr" style={{ backgroundColor: "#f9fafb" }}>
                  <Box as="th" padding={3} textAlign="left">
                    <Text fontWeight="bold" size={2}>
                      #
                    </Text>
                  </Box>
                  <Box as="th" padding={3} textAlign="left">
                    <Text fontWeight="bold" size={2}>
                      SKU
                    </Text>
                  </Box>
                  <Box as="th" padding={3} textAlign="left">
                    <Text fontWeight="bold" size={2}>
                      Product
                    </Text>
                  </Box>
                  <Box as="th" padding={3} textAlign="right">
                    <Text fontWeight="bold" size={2}>
                      Qty Ordered
                    </Text>
                  </Box>
                  <Box as="th" padding={3} textAlign="right">
                    <Text fontWeight="bold" size={2}>
                      Qty Received
                    </Text>
                  </Box>
                  <Box as="th" padding={3} textAlign="right">
                    <Text fontWeight="bold" size={2}>
                      Unit Cost
                    </Text>
                  </Box>
                  <Box as="th" padding={3} textAlign="right">
                    <Text fontWeight="bold" size={2}>
                      Line Total
                    </Text>
                  </Box>
                </Box>
              </Box>
              <Box as="tbody">
                {po.lines.map((line) => (
                  <Box as="tr" key={line.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <Box as="td" padding={3}>
                      <Text>{line.lineNumber}</Text>
                    </Box>
                    <Box as="td" padding={3}>
                      <Text size={2} style={{ fontFamily: "monospace" }}>
                        {line.saleorVariantSku || "-"}
                      </Text>
                    </Box>
                    <Box as="td" padding={3}>
                      <Text>{line.saleorVariantName || "Unknown"}</Text>
                    </Box>
                    <Box as="td" padding={3} textAlign="right">
                      <Text>{line.qtyOrdered}</Text>
                    </Box>
                    <Box as="td" padding={3} textAlign="right">
                      <Text
                        color={
                          line.qtyReceived === line.qtyOrdered
                            ? "success1"
                            : line.qtyReceived > 0
                              ? "info1"
                              : "default2"
                        }
                      >
                        {line.qtyReceived}
                      </Text>
                    </Box>
                    <Box as="td" padding={3} textAlign="right">
                      <Text>{formatCurrency(line.expectedUnitCost, line.currency)}</Text>
                    </Box>
                    <Box as="td" padding={3} textAlign="right">
                      <Text fontWeight="bold">
                        {formatCurrency(
                          line.qtyOrdered * parseFloat(line.expectedUnitCost.toString()),
                          line.currency
                        )}
                      </Text>
                    </Box>
                  </Box>
                ))}
              </Box>
              <Box as="tfoot">
                <Box as="tr" style={{ backgroundColor: "#f9fafb" }}>
                  <Box as="td" colSpan={6} padding={3} textAlign="right">
                    <Text fontWeight="bold">Total:</Text>
                  </Box>
                  <Box as="td" padding={3} textAlign="right">
                    <Text fontWeight="bold" size={5}>
                      {formatCurrency(totalValue, currency)}
                    </Text>
                  </Box>
                </Box>
              </Box>
            </Box>
          )}
        </Layout.AppSectionCard>
      </Layout.AppSection>

      {/* Goods Receipts */}
      {po.goodsReceipts && po.goodsReceipts.length > 0 && (
        <Layout.AppSection
          heading="Goods Receipts"
          sideContent={
            <Box display="flex" flexDirection="column" gap={2}>
              <Text>{po.goodsReceipts.length} receipt(s)</Text>
            </Box>
          }
        >
          <Layout.AppSectionCard>
            <Box as="table" width="100%">
              <Box as="thead">
                <Box as="tr" style={{ backgroundColor: "#f9fafb" }}>
                  <Box as="th" padding={3} textAlign="left">
                    <Text fontWeight="bold" size={2}>
                      Receipt #
                    </Text>
                  </Box>
                  <Box as="th" padding={3} textAlign="left">
                    <Text fontWeight="bold" size={2}>
                      Status
                    </Text>
                  </Box>
                  <Box as="th" padding={3} textAlign="left">
                    <Text fontWeight="bold" size={2}>
                      Lines
                    </Text>
                  </Box>
                  <Box as="th" padding={3} textAlign="left">
                    <Text fontWeight="bold" size={2}>
                      Created
                    </Text>
                  </Box>
                </Box>
              </Box>
              <Box as="tbody">
                {po.goodsReceipts.map((gr) => (
                  <Box
                    as="tr"
                    key={gr.id}
                    cursor="pointer"
                    onClick={() => router.push(`/goods-receipts/${gr.id}`)}
                    className="hover-row"
                    style={{ borderBottom: "1px solid #e5e7eb" }}
                  >
                    <Box as="td" padding={3}>
                      <Text>{gr.receiptNumber}</Text>
                    </Box>
                    <Box as="td" padding={3}>
                      <Text>{gr.status}</Text>
                    </Box>
                    <Box as="td" padding={3}>
                      <Text>{gr._count.lines}</Text>
                    </Box>
                    <Box as="td" padding={3}>
                      <Text>{formatDate(gr.createdAt)}</Text>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Layout.AppSectionCard>
        </Layout.AppSection>
      )}

      {/* Actions */}
      <Layout.AppSection
        heading="Actions"
        sideContent={
          <Box display="flex" flexDirection="column" gap={2}>
            <Text>Available actions for this order.</Text>
          </Box>
        }
      >
        <Layout.AppSectionCard>
          <Box padding={4} display="flex" gap={4} flexWrap="wrap">
            {/* Submit for approval */}
            {po.status === "DRAFT" && (
              <Button
                variant="primary"
                onClick={() => submitMutation.mutate({ id: po.id })}
                disabled={submitMutation.isLoading || po.lines.length === 0}
              >
                {submitMutation.isLoading ? "Submitting..." : "Submit for Approval"}
              </Button>
            )}

            {/* Approve */}
            {po.status === "PENDING_APPROVAL" && (
              <Button
                variant="primary"
                onClick={() => approveMutation.mutate({ id: po.id })}
                disabled={approveMutation.isLoading}
              >
                {approveMutation.isLoading ? "Approving..." : "Approve"}
              </Button>
            )}

            {/* Reject */}
            {po.status === "PENDING_APPROVAL" && (
              <Button
                variant="secondary"
                onClick={() => setShowRejectConfirm(true)}
                disabled={rejectMutation.isLoading}
              >
                Reject
              </Button>
            )}

            {/* Create Goods Receipt */}
            {(po.status === "APPROVED" || po.status === "PARTIALLY_RECEIVED") && (
              <Button
                variant="primary"
                onClick={() => router.push(`/goods-receipts/new?poId=${po.id}`)}
              >
                Create Goods Receipt
              </Button>
            )}

            {/* Duplicate */}
            <Button
              variant="secondary"
              onClick={() => duplicateMutation.mutate({ id: po.id })}
              disabled={duplicateMutation.isLoading}
            >
              {duplicateMutation.isLoading ? "Duplicating..." : "Duplicate as Draft"}
            </Button>

            {/* Cancel */}
            {po.status !== "FULLY_RECEIVED" && po.status !== "CANCELLED" && (
              <Button variant="error" onClick={() => setShowCancelConfirm(true)}>
                Cancel Order
              </Button>
            )}
          </Box>

          {/* Error messages */}
          {submitMutation.error && (
            <Box padding={4}>
              <Text color="critical1">Error: {submitMutation.error.message}</Text>
            </Box>
          )}
          {approveMutation.error && (
            <Box padding={4}>
              <Text color="critical1">Error: {approveMutation.error.message}</Text>
            </Box>
          )}
        </Layout.AppSectionCard>
      </Layout.AppSection>

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <Box
          position="fixed"
          inset={0}
          display="flex"
          alignItems="center"
          justifyContent="center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1000 }}
        >
          <Box
            backgroundColor="default1"
            padding={6}
            borderRadius={4}
            __maxWidth="400px"
            boxShadow="defaultModal"
          >
            <Text as="h2" size={6} fontWeight="bold" marginBottom={4}>
              Cancel Purchase Order?
            </Text>
            <Text marginBottom={4}>
              Are you sure you want to cancel {po.orderNumber}? This action cannot be undone.
            </Text>
            <Box display="flex" justifyContent="flex-end" gap={2}>
              <Button variant="secondary" onClick={() => setShowCancelConfirm(false)}>
                Keep Order
              </Button>
              <Button
                variant="error"
                onClick={() => cancelMutation.mutate({ id: po.id })}
                disabled={cancelMutation.isLoading}
              >
                {cancelMutation.isLoading ? "Cancelling..." : "Cancel Order"}
              </Button>
            </Box>
          </Box>
        </Box>
      )}

      {/* Reject Confirmation Modal */}
      {showRejectConfirm && (
        <Box
          position="fixed"
          inset={0}
          display="flex"
          alignItems="center"
          justifyContent="center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1000 }}
        >
          <Box
            backgroundColor="default1"
            padding={6}
            borderRadius={4}
            __maxWidth="400px"
            boxShadow="defaultModal"
          >
            <Text as="h2" size={6} fontWeight="bold" marginBottom={4}>
              Reject Purchase Order?
            </Text>
            <Text marginBottom={4}>
              This will return {po.orderNumber} to Draft status for revisions.
            </Text>
            <Box display="flex" justifyContent="flex-end" gap={2}>
              <Button variant="secondary" onClick={() => setShowRejectConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => rejectMutation.mutate({ id: po.id })}
                disabled={rejectMutation.isLoading}
              >
                {rejectMutation.isLoading ? "Rejecting..." : "Reject to Draft"}
              </Button>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default PurchaseOrderDetailPage;
