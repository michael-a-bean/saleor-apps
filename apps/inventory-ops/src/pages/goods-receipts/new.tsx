import { Layout } from "@saleor/apps-ui";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const NewGoodsReceiptPage: NextPage = () => {
  const router = useRouter();
  const { poId } = router.query;
  const [selectedPOId, setSelectedPOId] = useState<string | null>((poId as string) || null);
  const [notes, setNotes] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const { data: receivablePOs, isLoading } = trpcClient.goodsReceipts.getReceivablePOs.useQuery();
  const createMutation = trpcClient.goodsReceipts.create.useMutation();

  const selectedPO = receivablePOs?.find((po) => po.id === selectedPOId);

  const handleCreate = async () => {
    if (!selectedPOId) return;

    setIsCreating(true);
    try {
      const gr = await createMutation.mutateAsync({
        purchaseOrderId: selectedPOId,
        notes: notes || null,
      });

      router.push(`/goods-receipts/${gr.id}`);
    } catch {
      setIsCreating(false);
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Create Goods Receipt
        </Text>
        <Button variant="secondary" onClick={() => router.push("/goods-receipts")}>
          Back
        </Button>
      </Box>

      <Layout.AppSection
        heading="Select Purchase Order"
        sideContent={
          <Box display="flex" flexDirection="column" gap={2}>
            <Text>
              Select a purchase order to receive against. Only approved and partially received POs
              are shown.
            </Text>
          </Box>
        }
      >
        {isLoading ? (
          <Text>Loading purchase orders...</Text>
        ) : !receivablePOs || receivablePOs.length === 0 ? (
          <Layout.AppSectionCard>
            <Box padding={6} display="flex" flexDirection="column" alignItems="center" gap={4}>
              <Text>No purchase orders available for receiving.</Text>
              <Text color="default2">
                Purchase orders must be in APPROVED or PARTIALLY_RECEIVED status to receive against.
              </Text>
              <Button variant="secondary" onClick={() => router.push("/purchase-orders")}>
                View Purchase Orders
              </Button>
            </Box>
          </Layout.AppSectionCard>
        ) : (
          <Layout.AppSectionCard>
            <Box as="table" width="100%">
              <Box as="thead">
                <Box as="tr">
                  <Box as="th" padding={2} textAlign="left" __width="40px"></Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">PO #</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Supplier</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Status</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Lines</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Receipts</Text>
                  </Box>
                </Box>
              </Box>
              <Box as="tbody">
                {receivablePOs.map((po) => {
                  const totalRemaining = po.lines.reduce((sum, line) => sum + line.qtyRemaining, 0);

                  return (
                    <Box
                      as="tr"
                      key={po.id}
                      cursor="pointer"
                      onClick={() => setSelectedPOId(po.id)}
                      __backgroundColor={selectedPOId === po.id ? "#eff6ff" : undefined}
                    >
                      <Box as="td" padding={2}>
                        <input
                          type="radio"
                          name="selectedPO"
                          checked={selectedPOId === po.id}
                          onChange={() => setSelectedPOId(po.id)}
                        />
                      </Box>
                      <Box as="td" padding={2}>
                        <Text fontWeight="medium">{po.orderNumber}</Text>
                      </Box>
                      <Box as="td" padding={2}>
                        <Text>{po.supplier.name}</Text>
                      </Box>
                      <Box as="td" padding={2}>
                        <Box
                          as="span"
                          paddingX={2}
                          paddingY={1}
                          borderRadius={4}
                          __backgroundColor={po.status === "APPROVED" ? "#10b981" : "#3b82f6"}
                          __color="#ffffff"
                          __fontSize="12px"
                          __fontWeight="500"
                        >
                          {po.status}
                        </Box>
                      </Box>
                      <Box as="td" padding={2}>
                        <Text>
                          {po.lines.length} lines ({totalRemaining} remaining)
                        </Text>
                      </Box>
                      <Box as="td" padding={2}>
                        <Text>{po._count.goodsReceipts}</Text>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </Layout.AppSectionCard>
        )}
      </Layout.AppSection>

      {selectedPO && (
        <>
          <Box marginTop={6}>
            <Layout.AppSection
              heading="Order Lines to Receive"
              sideContent={
                <Box display="flex" flexDirection="column" gap={2}>
                  <Text>
                    Lines with remaining quantity will be pre-populated in the goods receipt.
                  </Text>
                </Box>
              }
            >
              <Layout.AppSectionCard>
                <Box as="table" width="100%">
                  <Box as="thead">
                    <Box as="tr">
                      <Box as="th" padding={2} textAlign="left">
                        <Text fontWeight="bold">SKU</Text>
                      </Box>
                      <Box as="th" padding={2} textAlign="left">
                        <Text fontWeight="bold">Name</Text>
                      </Box>
                      <Box as="th" padding={2} textAlign="right">
                        <Text fontWeight="bold">Ordered</Text>
                      </Box>
                      <Box as="th" padding={2} textAlign="right">
                        <Text fontWeight="bold">Received</Text>
                      </Box>
                      <Box as="th" padding={2} textAlign="right">
                        <Text fontWeight="bold">Remaining</Text>
                      </Box>
                    </Box>
                  </Box>
                  <Box as="tbody">
                    {selectedPO.lines.map((line) => (
                      <Box
                        as="tr"
                        key={line.id}
                        __backgroundColor={line.qtyRemaining > 0 ? undefined : "#f9fafb"}
                      >
                        <Box as="td" padding={2}>
                          <Text>{line.saleorVariantSku || "-"}</Text>
                        </Box>
                        <Box as="td" padding={2}>
                          <Text>{line.saleorVariantName || "-"}</Text>
                        </Box>
                        <Box as="td" padding={2} textAlign="right">
                          <Text>{line.qtyOrdered}</Text>
                        </Box>
                        <Box as="td" padding={2} textAlign="right">
                          <Text>{line.qtyReceived}</Text>
                        </Box>
                        <Box as="td" padding={2} textAlign="right">
                          <Text
                            fontWeight={line.qtyRemaining > 0 ? "bold" : "regular"}
                            color={line.qtyRemaining > 0 ? "default1" : "default2"}
                          >
                            {line.qtyRemaining}
                          </Text>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Layout.AppSectionCard>
            </Layout.AppSection>
          </Box>

          <Box marginTop={6}>
            <Layout.AppSection
              heading="Receipt Details"
              sideContent={
                <Box display="flex" flexDirection="column" gap={2}>
                  <Text>Add optional notes for this goods receipt.</Text>
                </Box>
              }
            >
              <Layout.AppSectionCard>
                <Box display="flex" flexDirection="column" gap={4} padding={4}>
                  <Box>
                    <Text fontWeight="bold" marginBottom={2}>
                      Notes (optional)
                    </Text>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Add any notes about this receipt..."
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
                      onClick={() => router.push("/goods-receipts")}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleCreate}
                      disabled={isCreating}
                    >
                      {isCreating ? "Creating..." : "Create Goods Receipt"}
                    </Button>
                  </Box>
                </Box>
              </Layout.AppSectionCard>
            </Layout.AppSection>
          </Box>
        </>
      )}
    </Box>
  );
};

export default NewGoodsReceiptPage;
