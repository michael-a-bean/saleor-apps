import { Layout } from "@saleor/apps-ui";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const costTypeOptions = [
  { value: "FREIGHT", label: "Freight" },
  { value: "DUTY", label: "Duty" },
  { value: "INSURANCE", label: "Insurance" },
  { value: "HANDLING", label: "Handling" },
  { value: "OTHER", label: "Other" },
];

const allocationMethodOptions = [
  { value: "VALUE", label: "By Value (proportional to line value)" },
  { value: "QUANTITY", label: "By Quantity (equal per unit)" },
];

const statusColors: Record<string, string> = {
  DRAFT: "#6b7280",
  POSTED: "#10b981",
  REVERSED: "#f59e0b",
};

const formatCurrency = (amount: number | string, currency: string) => {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(num);
};

const GoodsReceiptDetailPage: NextPage = () => {
  const router = useRouter();
  const { id } = router.query;
  const utils = trpcClient.useContext();

  const [isPosting, setIsPosting] = useState(false);
  const [showPostConfirm, setShowPostConfirm] = useState(false);
  const [showReversalModal, setShowReversalModal] = useState(false);
  const [reversalReason, setReversalReason] = useState("");
  const [isReversing, setIsReversing] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editedQty, setEditedQty] = useState<number>(0);
  const [editedCost, setEditedCost] = useState<number>(0);

  // Landed costs state
  const [showAddLandedCost, setShowAddLandedCost] = useState(false);
  const [newLandedCost, setNewLandedCost] = useState({
    costType: "FREIGHT" as "FREIGHT" | "DUTY" | "INSURANCE" | "HANDLING" | "OTHER",
    description: "",
    amount: "",
    currency: "USD",
    allocationMethod: "VALUE" as "VALUE" | "QUANTITY",
  });
  const [showAllocationPreview, setShowAllocationPreview] = useState(false);

  const { data: gr, isLoading, error, refetch } = trpcClient.goodsReceipts.getById.useQuery(
    { id: id as string },
    { enabled: !!id }
  );

  // Fetch WAC for each line when GR is posted
  const wacItems = gr?.status === "POSTED" || gr?.status === "REVERSED"
    ? gr.lines.map((line) => ({
        variantId: line.saleorVariantId,
        warehouseId: gr.saleorWarehouseId,
      }))
    : [];

  const { data: wacData } = trpcClient.costLayers.getWacBatch.useQuery(
    { items: wacItems },
    { enabled: wacItems.length > 0 }
  );

  // Create a map of variantId -> WAC for easy lookup
  const wacMap = new Map<string, { wac: string; qtyOnHand: number; totalValue: string }>();
  if (wacData) {
    wacData.forEach((wac) => {
      wacMap.set(wac.variantId, {
        wac: wac.wac,
        qtyOnHand: wac.qtyOnHand,
        totalValue: wac.totalValue,
      });
    });
  }

  const postMutation = trpcClient.goodsReceipts.post.useMutation();
  const reverseMutation = trpcClient.goodsReceipts.reverse.useMutation();
  const updateLineMutation = trpcClient.goodsReceipts.updateLine.useMutation();
  const deleteLineMutation = trpcClient.goodsReceipts.removeLine.useMutation();
  const deleteMutation = trpcClient.goodsReceipts.delete.useMutation();

  // Landed costs queries and mutations
  const { data: landedCostsData, refetch: refetchLandedCosts } = trpcClient.landedCosts.listByGR.useQuery(
    { goodsReceiptId: id as string },
    { enabled: !!id }
  );

  const { data: allocationPreview, refetch: refetchAllocationPreview } = trpcClient.landedCosts.previewAllocation.useQuery(
    { goodsReceiptId: id as string },
    { enabled: !!id && showAllocationPreview }
  );

  const { data: landedCostSummary } = trpcClient.landedCosts.getGRSummary.useQuery(
    { goodsReceiptId: id as string },
    { enabled: !!id }
  );

  const createLandedCostMutation = trpcClient.landedCosts.create.useMutation();
  const deleteLandedCostMutation = trpcClient.landedCosts.delete.useMutation();

  if (!id) {
    return <Text>Loading...</Text>;
  }

  if (error) {
    return (
      <Box>
        <Text color="critical1">Error: {error.message}</Text>
        <Button variant="secondary" onClick={() => router.push("/goods-receipts")}>
          Back to Goods Receipts
        </Button>
      </Box>
    );
  }

  if (isLoading || !gr) {
    return <Text>Loading goods receipt...</Text>;
  }

  const handlePost = async () => {
    setIsPosting(true);
    try {
      await postMutation.mutateAsync({ id: gr.id });
      await refetch();
      setShowPostConfirm(false);
    } catch (error) {
      alert(`Failed to post: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsPosting(false);
    }
  };

  const handleReverse = async () => {
    if (!reversalReason.trim()) {
      alert("Please enter a reason for the reversal");

      return;
    }

    setIsReversing(true);
    try {
      const reversalGr = await reverseMutation.mutateAsync({
        id: gr.id,
        reason: reversalReason,
      });

      await utils.goodsReceipts.invalidate();
      router.push(`/goods-receipts/${reversalGr.id}`);
    } catch (error) {
      alert(`Failed to reverse: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsReversing(false);
    }
  };

  const handleUpdateLine = async (lineId: string) => {
    try {
      await updateLineMutation.mutateAsync({
        lineId,
        data: {
          qtyReceived: editedQty,
          unitCost: editedCost,
        },
      });
      await refetch();
      setEditingLineId(null);
    } catch (error) {
      alert(`Failed to update: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleDeleteLine = async (lineId: string) => {
    if (!confirm("Are you sure you want to remove this line?")) return;

    try {
      await deleteLineMutation.mutateAsync({ lineId });
      await refetch();
    } catch (error) {
      alert(`Failed to delete: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this goods receipt?")) return;

    try {
      await deleteMutation.mutateAsync({ id: gr.id });
      router.push("/goods-receipts");
    } catch (error) {
      alert(`Failed to delete: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const startEditing = (line: typeof gr.lines[0]) => {
    setEditingLineId(line.id);
    setEditedQty(line.qtyReceived);
    setEditedCost(Number(line.unitCost));
  };

  const handleAddLandedCost = async () => {
    if (!newLandedCost.description.trim()) {
      alert("Please enter a description");
      return;
    }
    const amount = parseFloat(newLandedCost.amount);
    if (isNaN(amount) || amount <= 0) {
      alert("Please enter a valid positive amount");
      return;
    }

    try {
      await createLandedCostMutation.mutateAsync({
        goodsReceiptId: gr.id,
        costType: newLandedCost.costType,
        description: newLandedCost.description,
        amount,
        currency: newLandedCost.currency,
        allocationMethod: newLandedCost.allocationMethod,
      });
      await refetchLandedCosts();
      setShowAddLandedCost(false);
      setNewLandedCost({
        costType: "FREIGHT",
        description: "",
        amount: "",
        currency: gr.lines[0]?.currency || "USD",
        allocationMethod: "VALUE",
      });
    } catch (error) {
      alert(`Failed to add landed cost: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleDeleteLandedCost = async (landedCostId: string) => {
    if (!confirm("Are you sure you want to delete this landed cost?")) return;

    try {
      await deleteLandedCostMutation.mutateAsync({ id: landedCostId });
      await refetchLandedCosts();
    } catch (error) {
      alert(`Failed to delete: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const totalValue = gr.lines.reduce(
    (sum, line) => sum + line.qtyReceived * Number(line.unitCost),
    0
  );

  return (
    <Box>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Box>
          <Text as="h1" size={10} fontWeight="bold">
            {gr.receiptNumber}
          </Text>
          <Box display="flex" alignItems="center" gap={2} marginTop={2}>
            <Box
              as="span"
              paddingX={2}
              paddingY={1}
              borderRadius={4}
              __backgroundColor={statusColors[gr.status] || "#6b7280"}
              __color="#ffffff"
              __fontSize="12px"
              __fontWeight="500"
            >
              {gr.status}
            </Box>
            {gr.reversalOfGr && (
              <Text color="default2">Reversal of {gr.reversalOfGr.receiptNumber}</Text>
            )}
            {gr.reversedByGr && (
              <Text color="default2">Reversed by {gr.reversedByGr.receiptNumber}</Text>
            )}
          </Box>
        </Box>
        <Box display="flex" gap={2}>
          {gr.status === "DRAFT" && (
            <>
              <Button variant="tertiary" onClick={handleDelete}>
                Delete
              </Button>
              <Button variant="primary" onClick={() => setShowPostConfirm(true)}>
                Post Receipt
              </Button>
            </>
          )}
          {gr.status === "POSTED" && !gr.reversedByGr && (
            <Button variant="secondary" onClick={() => setShowReversalModal(true)}>
              Reverse
            </Button>
          )}
          <Button variant="secondary" onClick={() => router.push("/goods-receipts")}>
            Back
          </Button>
        </Box>
      </Box>

      {/* Receipt Info */}
      <Layout.AppSection
        heading="Receipt Details"
        sideContent={
          <Box display="flex" flexDirection="column" gap={2}>
            <Text>
              {gr.status === "DRAFT"
                ? "Review and edit the receipt details before posting."
                : "This receipt has been posted and cannot be modified."}
            </Text>
          </Box>
        }
      >
        <Layout.AppSectionCard>
          <Box display="grid" __gridTemplateColumns="1fr 1fr" gap={4} padding={4}>
            <Box>
              <Text fontWeight="bold" marginBottom={1}>
                Purchase Order
              </Text>
              <Text
                cursor="pointer"
                color="info1"
                onClick={() => router.push(`/purchase-orders/${gr.purchaseOrder.id}`)}
              >
                {gr.purchaseOrder.orderNumber}
              </Text>
            </Box>
            <Box>
              <Text fontWeight="bold" marginBottom={1}>
                Supplier
              </Text>
              <Text>{gr.purchaseOrder.supplier.name}</Text>
            </Box>
            <Box>
              <Text fontWeight="bold" marginBottom={1}>
                Created
              </Text>
              <Text>{new Date(gr.createdAt).toLocaleString()}</Text>
            </Box>
            <Box>
              <Text fontWeight="bold" marginBottom={1}>
                Posted
              </Text>
              <Text>{gr.postedAt ? new Date(gr.postedAt).toLocaleString() : "-"}</Text>
            </Box>
            {gr.notes && (
              <Box __gridColumn="1 / -1">
                <Text fontWeight="bold" marginBottom={1}>
                  Notes
                </Text>
                <Text>{gr.notes}</Text>
              </Box>
            )}
          </Box>
        </Layout.AppSectionCard>
      </Layout.AppSection>

      {/* Landed Costs */}
      <Box marginTop={6}>
        <Layout.AppSection
          heading="Landed Costs"
          sideContent={
            <Box display="flex" flexDirection="column" gap={2}>
              <Text>
                {gr.status === "DRAFT"
                  ? "Add freight, duty, or other costs that will be allocated across line items."
                  : "Landed costs have been allocated and included in the cost layer."}
              </Text>
              {landedCostSummary && landedCostSummary.landedCostCount > 0 && (
                <Text fontWeight="bold">
                  Total: {formatCurrency(landedCostSummary.totalLandedCost, landedCostSummary.currency)}
                </Text>
              )}
            </Box>
          }
        >
          <Layout.AppSectionCard>
            {landedCostsData && landedCostsData.landedCosts.length > 0 ? (
              <Box as="table" width="100%" marginBottom={4}>
                <Box as="thead">
                  <Box as="tr">
                    <Box as="th" padding={2} textAlign="left">
                      <Text fontWeight="bold">Type</Text>
                    </Box>
                    <Box as="th" padding={2} textAlign="left">
                      <Text fontWeight="bold">Description</Text>
                    </Box>
                    <Box as="th" padding={2} textAlign="right">
                      <Text fontWeight="bold">Amount</Text>
                    </Box>
                    <Box as="th" padding={2} textAlign="left">
                      <Text fontWeight="bold">Allocation</Text>
                    </Box>
                    <Box as="th" padding={2} textAlign="center">
                      <Text fontWeight="bold">Status</Text>
                    </Box>
                    {gr.status === "DRAFT" && (
                      <Box as="th" padding={2} textAlign="center">
                        <Text fontWeight="bold">Actions</Text>
                      </Box>
                    )}
                  </Box>
                </Box>
                <Box as="tbody">
                  {landedCostsData.landedCosts.map((lc) => (
                    <Box as="tr" key={lc.id}>
                      <Box as="td" padding={2}>
                        <Text>{lc.costType}</Text>
                      </Box>
                      <Box as="td" padding={2}>
                        <Text>{lc.description}</Text>
                      </Box>
                      <Box as="td" padding={2} textAlign="right">
                        <Text>{formatCurrency(lc.amount, lc.currency)}</Text>
                      </Box>
                      <Box as="td" padding={2}>
                        <Text color="default2">
                          {lc.allocationMethod === "VALUE" ? "By Value" : "By Quantity"}
                        </Text>
                      </Box>
                      <Box as="td" padding={2} textAlign="center">
                        <Box
                          as="span"
                          paddingX={2}
                          paddingY={1}
                          borderRadius={4}
                          __backgroundColor={lc.isAllocated ? "#10b981" : "#f59e0b"}
                          __color="#ffffff"
                          __fontSize="12px"
                        >
                          {lc.isAllocated ? "Allocated" : "Pending"}
                        </Box>
                      </Box>
                      {gr.status === "DRAFT" && (
                        <Box as="td" padding={2} textAlign="center">
                          {!lc.isAllocated && (
                            <Button
                              size="small"
                              variant="tertiary"
                              onClick={() => handleDeleteLandedCost(lc.id)}
                            >
                              Remove
                            </Button>
                          )}
                        </Box>
                      )}
                    </Box>
                  ))}
                </Box>
              </Box>
            ) : (
              <Box padding={4} display="flex" justifyContent="center">
                <Text color="default2">No landed costs added</Text>
              </Box>
            )}

            {gr.status === "DRAFT" && (
              <>
                {showAddLandedCost ? (
                  <Box
                    padding={4}
                    borderRadius={4}
                    marginTop={2}
                    style={{ backgroundColor: "#f9fafb", border: "1px solid #e5e7eb" }}
                  >
                    <Text fontWeight="bold" marginBottom={3}>
                      Add Landed Cost
                    </Text>
                    <Box display="grid" __gridTemplateColumns="1fr 1fr 1fr 1fr" gap={3} marginBottom={3}>
                      <Box>
                        <Text size={2} marginBottom={1}>Cost Type</Text>
                        <select
                          value={newLandedCost.costType}
                          onChange={(e) =>
                            setNewLandedCost({
                              ...newLandedCost,
                              costType: e.target.value as typeof newLandedCost.costType,
                            })
                          }
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            border: "1px solid #e5e7eb",
                            borderRadius: "6px",
                            fontSize: "14px",
                          }}
                        >
                          {costTypeOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </Box>
                      <Box>
                        <Text size={2} marginBottom={1}>Description</Text>
                        <input
                          type="text"
                          value={newLandedCost.description}
                          onChange={(e) =>
                            setNewLandedCost({ ...newLandedCost, description: e.target.value })
                          }
                          placeholder="e.g., International shipping"
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            border: "1px solid #e5e7eb",
                            borderRadius: "6px",
                            fontSize: "14px",
                          }}
                        />
                      </Box>
                      <Box>
                        <Text size={2} marginBottom={1}>Amount</Text>
                        <Box display="flex" gap={2}>
                          <input
                            type="number"
                            step="0.01"
                            value={newLandedCost.amount}
                            onChange={(e) =>
                              setNewLandedCost({ ...newLandedCost, amount: e.target.value })
                            }
                            placeholder="0.00"
                            style={{
                              flex: 1,
                              padding: "8px 12px",
                              border: "1px solid #e5e7eb",
                              borderRadius: "6px",
                              fontSize: "14px",
                            }}
                          />
                          <input
                            type="text"
                            value={newLandedCost.currency}
                            onChange={(e) =>
                              setNewLandedCost({
                                ...newLandedCost,
                                currency: e.target.value.toUpperCase(),
                              })
                            }
                            maxLength={3}
                            style={{
                              width: "60px",
                              padding: "8px 12px",
                              border: "1px solid #e5e7eb",
                              borderRadius: "6px",
                              fontSize: "14px",
                              textAlign: "center",
                            }}
                          />
                        </Box>
                      </Box>
                      <Box>
                        <Text size={2} marginBottom={1}>Allocation Method</Text>
                        <select
                          value={newLandedCost.allocationMethod}
                          onChange={(e) =>
                            setNewLandedCost({
                              ...newLandedCost,
                              allocationMethod: e.target.value as typeof newLandedCost.allocationMethod,
                            })
                          }
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            border: "1px solid #e5e7eb",
                            borderRadius: "6px",
                            fontSize: "14px",
                          }}
                        >
                          {allocationMethodOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </Box>
                    </Box>
                    <Box display="flex" gap={2} justifyContent="flex-end">
                      <Button variant="secondary" onClick={() => setShowAddLandedCost(false)}>
                        Cancel
                      </Button>
                      <Button variant="primary" onClick={handleAddLandedCost}>
                        Add Cost
                      </Button>
                    </Box>
                  </Box>
                ) : (
                  <Box display="flex" justifyContent="flex-start" marginTop={2}>
                    <Button variant="secondary" onClick={() => setShowAddLandedCost(true)}>
                      + Add Landed Cost
                    </Button>
                  </Box>
                )}
              </>
            )}

            {/* Allocation Preview */}
            {gr.status === "DRAFT" &&
              landedCostsData &&
              landedCostsData.landedCosts.some((lc) => !lc.isAllocated) && (
                <Box marginTop={4}>
                  <Box display="flex" alignItems="center" gap={2} marginBottom={2}>
                    <Button
                      variant="tertiary"
                      onClick={() => {
                        setShowAllocationPreview(!showAllocationPreview);
                        if (!showAllocationPreview) refetchAllocationPreview();
                      }}
                    >
                      {showAllocationPreview ? "Hide" : "Show"} Allocation Preview
                    </Button>
                    <Text color="default2" size={2}>
                      Costs will be allocated automatically when you post the receipt
                    </Text>
                  </Box>

                  {showAllocationPreview && allocationPreview && (
                    <Box
                      padding={4}
                      borderRadius={4}
                      style={{ backgroundColor: "#f0f9ff", border: "1px solid #bae6fd" }}
                    >
                      {allocationPreview.allocations.map((preview) => (
                        <Box key={preview.landedCostId} marginBottom={3}>
                          <Text fontWeight="bold" marginBottom={2}>
                            {preview.costType}: {preview.description} (
                            {formatCurrency(preview.totalAmount, gr.lines[0]?.currency || "USD")})
                          </Text>
                          <Box as="table" width="100%">
                            <Box as="thead">
                              <Box as="tr">
                                <Box as="th" padding={1} textAlign="left">
                                  <Text size={2}>SKU</Text>
                                </Box>
                                <Box as="th" padding={1} textAlign="right">
                                  <Text size={2}>Qty</Text>
                                </Box>
                                <Box as="th" padding={1} textAlign="right">
                                  <Text size={2}>Line Value</Text>
                                </Box>
                                <Box as="th" padding={1} textAlign="right">
                                  <Text size={2}>Allocation %</Text>
                                </Box>
                                <Box as="th" padding={1} textAlign="right">
                                  <Text size={2}>Allocated Amount</Text>
                                </Box>
                              </Box>
                            </Box>
                            <Box as="tbody">
                              {preview.allocations.map((alloc) => (
                                <Box as="tr" key={alloc.lineId}>
                                  <Box as="td" padding={1}>
                                    <Text size={2}>{alloc.variantSku || "-"}</Text>
                                  </Box>
                                  <Box as="td" padding={1} textAlign="right">
                                    <Text size={2}>{alloc.lineQty}</Text>
                                  </Box>
                                  <Box as="td" padding={1} textAlign="right">
                                    <Text size={2}>
                                      {formatCurrency(alloc.lineValue, gr.lines[0]?.currency || "USD")}
                                    </Text>
                                  </Box>
                                  <Box as="td" padding={1} textAlign="right">
                                    <Text size={2}>{alloc.allocationPercent}%</Text>
                                  </Box>
                                  <Box as="td" padding={1} textAlign="right">
                                    <Text size={2} fontWeight="bold">
                                      {formatCurrency(alloc.allocatedAmount, gr.lines[0]?.currency || "USD")}
                                    </Text>
                                  </Box>
                                </Box>
                              ))}
                            </Box>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
              )}
          </Layout.AppSectionCard>
        </Layout.AppSection>
      </Box>

      {/* Lines */}
      <Box marginTop={6}>
        <Layout.AppSection
          heading="Receipt Lines"
          sideContent={
            <Box display="flex" flexDirection="column" gap={2}>
              <Text>
                {gr.status === "DRAFT"
                  ? "Click on a line to edit quantity or cost."
                  : `${gr.lines.length} lines totaling ${totalValue.toFixed(2)} ${gr.lines[0]?.currency || "USD"}`}
              </Text>
            </Box>
          }
        >
          <Layout.AppSectionCard>
            <Box as="table" width="100%">
              <Box as="thead">
                <Box as="tr">
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">#</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">SKU</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Name</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="right">
                    <Text fontWeight="bold">Qty</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="right">
                    <Text fontWeight="bold">Unit Cost</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="right">
                    <Text fontWeight="bold">Line Total</Text>
                  </Box>
                  {(gr.status === "POSTED" || gr.status === "REVERSED") && (
                    <>
                      <Box as="th" padding={2} textAlign="right">
                        <Text fontWeight="bold">Current WAC</Text>
                      </Box>
                      <Box as="th" padding={2} textAlign="right">
                        <Text fontWeight="bold">Qty on Hand</Text>
                      </Box>
                    </>
                  )}
                  {gr.status === "DRAFT" && (
                    <Box as="th" padding={2} textAlign="center">
                      <Text fontWeight="bold">Actions</Text>
                    </Box>
                  )}
                </Box>
              </Box>
              <Box as="tbody">
                {gr.lines.map((line) => {
                  const isEditing = editingLineId === line.id;
                  const lineTotal = line.qtyReceived * Number(line.unitCost);

                  return (
                    <Box as="tr" key={line.id}>
                      <Box as="td" padding={2}>
                        <Text>{line.lineNumber}</Text>
                      </Box>
                      <Box as="td" padding={2}>
                        <Text>{line.saleorVariantSku || "-"}</Text>
                      </Box>
                      <Box as="td" padding={2}>
                        <Text>{line.saleorVariantName || "-"}</Text>
                      </Box>
                      <Box as="td" padding={2} textAlign="right">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editedQty}
                            onChange={(e) => setEditedQty(parseInt(e.target.value) || 0)}
                            style={{
                              width: "80px",
                              padding: "4px 8px",
                              border: "1px solid #e5e7eb",
                              borderRadius: "4px",
                              textAlign: "right",
                            }}
                          />
                        ) : (
                          <Text>{line.qtyReceived}</Text>
                        )}
                      </Box>
                      <Box as="td" padding={2} textAlign="right">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editedCost}
                            onChange={(e) => setEditedCost(parseFloat(e.target.value) || 0)}
                            style={{
                              width: "100px",
                              padding: "4px 8px",
                              border: "1px solid #e5e7eb",
                              borderRadius: "4px",
                              textAlign: "right",
                            }}
                          />
                        ) : (
                          <Text>
                            {Number(line.unitCost).toFixed(2)} {line.currency}
                          </Text>
                        )}
                      </Box>
                      <Box as="td" padding={2} textAlign="right">
                        <Text fontWeight="medium">
                          {lineTotal.toFixed(2)} {line.currency}
                        </Text>
                      </Box>
                      {(gr.status === "POSTED" || gr.status === "REVERSED") && (
                        <>
                          <Box as="td" padding={2} textAlign="right">
                            {wacMap.has(line.saleorVariantId) ? (
                              <Text color="info1">
                                {formatCurrency(wacMap.get(line.saleorVariantId)!.wac, line.currency)}
                              </Text>
                            ) : (
                              <Text color="default2">-</Text>
                            )}
                          </Box>
                          <Box as="td" padding={2} textAlign="right">
                            {wacMap.has(line.saleorVariantId) ? (
                              <Text>{wacMap.get(line.saleorVariantId)!.qtyOnHand}</Text>
                            ) : (
                              <Text color="default2">-</Text>
                            )}
                          </Box>
                        </>
                      )}
                      {gr.status === "DRAFT" && (
                        <Box as="td" padding={2} textAlign="center">
                          {isEditing ? (
                            <Box display="flex" gap={1} justifyContent="center">
                              <Button
                                size="small"
                                variant="primary"
                                onClick={() => handleUpdateLine(line.id)}
                              >
                                Save
                              </Button>
                              <Button
                                size="small"
                                variant="secondary"
                                onClick={() => setEditingLineId(null)}
                              >
                                Cancel
                              </Button>
                            </Box>
                          ) : (
                            <Box display="flex" gap={1} justifyContent="center">
                              <Button
                                size="small"
                                variant="tertiary"
                                onClick={() => startEditing(line)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="small"
                                variant="tertiary"
                                onClick={() => handleDeleteLine(line.id)}
                              >
                                Remove
                              </Button>
                            </Box>
                          )}
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
              <Box as="tfoot">
                <Box
                  as="tr"
                  borderTopStyle="solid"
                  borderTopWidth={1}
                  borderColor="default1"
                >
                  <Box as="td" colSpan={5} padding={2} textAlign="right">
                    <Text fontWeight="bold">Total:</Text>
                  </Box>
                  <Box as="td" padding={2} textAlign="right">
                    <Text fontWeight="bold">
                      {totalValue.toFixed(2)} {gr.lines[0]?.currency || "USD"}
                    </Text>
                  </Box>
                  {(gr.status === "POSTED" || gr.status === "REVERSED") && (
                    <>
                      <Box as="td" padding={2}></Box>
                      <Box as="td" padding={2}></Box>
                    </>
                  )}
                  {gr.status === "DRAFT" && <Box as="td" />}
                </Box>
              </Box>
            </Box>
          </Layout.AppSectionCard>
        </Layout.AppSection>
      </Box>

      {/* Post Confirmation Modal */}
      {showPostConfirm && (
        <Box
          position="fixed"
          __top="0"
          __left="0"
          __right="0"
          __bottom="0"
          __backgroundColor="rgba(0,0,0,0.5)"
          display="flex"
          alignItems="center"
          justifyContent="center"
          __zIndex="1000"
        >
          <Box
            __backgroundColor="#ffffff"
            borderRadius={4}
            padding={6}
            __maxWidth="500px"
            width="100%"
          >
            <Text as="h2" size={8} fontWeight="bold" marginBottom={4}>
              Confirm Posting
            </Text>
            <Text marginBottom={4}>
              This will update stock quantities in Saleor for {gr.lines.length} line(s). This action
              cannot be undone directly - you will need to create a reversal to undo it.
            </Text>
            <Box marginBottom={4}>
              <Text fontWeight="bold">Summary:</Text>
              <Text>
                Total items: {gr.lines.reduce((sum, line) => sum + line.qtyReceived, 0)}
              </Text>
              <Text>
                Total value: {totalValue.toFixed(2)} {gr.lines[0]?.currency || "USD"}
              </Text>
              {landedCostSummary && landedCostSummary.landedCostCount > 0 && (
                <>
                  <Text>
                    Landed costs: {formatCurrency(landedCostSummary.totalLandedCost, landedCostSummary.currency)}
                  </Text>
                  {landedCostSummary.unallocatedCount > 0 && (
                    <Text color="info1">
                      {landedCostSummary.unallocatedCount} cost(s) will be allocated during posting
                    </Text>
                  )}
                </>
              )}
            </Box>
            <Box display="flex" gap={2} justifyContent="flex-end">
              <Button variant="secondary" onClick={() => setShowPostConfirm(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handlePost} disabled={isPosting}>
                {isPosting ? "Posting..." : "Confirm Post"}
              </Button>
            </Box>
          </Box>
        </Box>
      )}

      {/* Reversal Modal */}
      {showReversalModal && (
        <Box
          position="fixed"
          __top="0"
          __left="0"
          __right="0"
          __bottom="0"
          __backgroundColor="rgba(0,0,0,0.5)"
          display="flex"
          alignItems="center"
          justifyContent="center"
          __zIndex="1000"
        >
          <Box
            __backgroundColor="#ffffff"
            borderRadius={4}
            padding={6}
            __maxWidth="500px"
            width="100%"
          >
            <Text as="h2" size={8} fontWeight="bold" marginBottom={4}>
              Reverse Goods Receipt
            </Text>
            <Text marginBottom={4}>
              This will create a reversal document and decrease stock quantities in Saleor. The
              original receipt will be marked as REVERSED.
            </Text>
            <Box marginBottom={4}>
              <Text fontWeight="bold" marginBottom={2}>
                Reason for Reversal (required)
              </Text>
              <textarea
                value={reversalReason}
                onChange={(e) => setReversalReason(e.target.value)}
                placeholder="Enter the reason for this reversal..."
                rows={3}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  border: "1px solid #e5e7eb",
                  borderRadius: "6px",
                  fontSize: "14px",
                  resize: "vertical",
                }}
              />
            </Box>
            <Box display="flex" gap={2} justifyContent="flex-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowReversalModal(false);
                  setReversalReason("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleReverse}
                disabled={isReversing || !reversalReason.trim()}
              >
                {isReversing ? "Reversing..." : "Confirm Reversal"}
              </Button>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default GoodsReceiptDetailPage;
