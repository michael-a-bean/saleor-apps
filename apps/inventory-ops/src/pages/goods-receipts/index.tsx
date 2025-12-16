import { Layout } from "@saleor/apps-ui";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

type GRStatus = "DRAFT" | "POSTED" | "REVERSED" | undefined;

const statusColors: Record<string, string> = {
  DRAFT: "#6b7280",
  POSTED: "#10b981",
  REVERSED: "#f59e0b",
};

const GoodsReceiptsPage: NextPage = () => {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<GRStatus>(undefined);
  const [searchQuery, setSearchQuery] = useState("");

  const {
    data: goodsReceiptsData,
    isLoading,
    error,
  } = trpcClient.goodsReceipts.list.useQuery({
    status: statusFilter,
    query: searchQuery || undefined,
  });

  const goodsReceipts = goodsReceiptsData?.goodsReceipts ?? [];

  if (error) {
    return (
      <Box>
        <Text color="critical1">Error loading goods receipts: {error.message}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Goods Receipts
        </Text>
        <Button variant="primary" onClick={() => router.push("/goods-receipts/new")}>
          New Receipt
        </Button>
      </Box>

      <Layout.AppSection
        heading="All Goods Receipts"
        sideContent={
          <Box display="flex" flexDirection="column" gap={4}>
            <Text>
              Track received inventory from purchase orders. Post receipts to update Saleor stock
              quantities.
            </Text>
            <Box display="flex" flexDirection="column" gap={2}>
              <Text fontWeight="bold" size={3}>
                Filter by Status
              </Text>
              <Box display="flex" gap={2} flexWrap="wrap">
                <Button
                  variant={statusFilter === undefined ? "primary" : "secondary"}
                  size="small"
                  onClick={() => setStatusFilter(undefined)}
                >
                  All
                </Button>
                <Button
                  variant={statusFilter === "DRAFT" ? "primary" : "secondary"}
                  size="small"
                  onClick={() => setStatusFilter("DRAFT")}
                >
                  Draft
                </Button>
                <Button
                  variant={statusFilter === "POSTED" ? "primary" : "secondary"}
                  size="small"
                  onClick={() => setStatusFilter("POSTED")}
                >
                  Posted
                </Button>
                <Button
                  variant={statusFilter === "REVERSED" ? "primary" : "secondary"}
                  size="small"
                  onClick={() => setStatusFilter("REVERSED")}
                >
                  Reversed
                </Button>
              </Box>
            </Box>
          </Box>
        }
      >
        <Box marginBottom={4}>
          <input
            type="text"
            placeholder="Search by receipt #, PO #, or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid #e5e7eb",
              borderRadius: "6px",
              fontSize: "14px",
            }}
          />
        </Box>

        {isLoading ? (
          <Text>Loading...</Text>
        ) : goodsReceipts.length === 0 ? (
          <Layout.AppSectionCard>
            <Box padding={6} display="flex" flexDirection="column" alignItems="center" gap={4}>
              <Text>No goods receipts found.</Text>
              <Text color="default2">
                {statusFilter
                  ? `No receipts with status "${statusFilter}".`
                  : "Create a goods receipt from a purchase order to start receiving inventory."}
              </Text>
              <Button variant="primary" onClick={() => router.push("/goods-receipts/new")}>
                Create Receipt
              </Button>
            </Box>
          </Layout.AppSectionCard>
        ) : (
          <Layout.AppSectionCard>
            <Box as="table" width="100%">
              <Box as="thead">
                <Box as="tr">
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Receipt #</Text>
                  </Box>
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
                    <Text fontWeight="bold">Created</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Notes</Text>
                  </Box>
                </Box>
              </Box>
              <Box as="tbody">
                {goodsReceipts.map((gr) => (
                  <Box
                    as="tr"
                    key={gr.id}
                    cursor="pointer"
                    onClick={() => router.push(`/goods-receipts/${gr.id}`)}
                    __backgroundColor={{ hover: "#f9fafb" }}
                  >
                    <Box as="td" padding={2}>
                      <Text fontWeight="medium">{gr.receiptNumber}</Text>
                      {gr.reversalOfGr && (
                        <Text size={1} color="default2">
                          Reversal of {gr.reversalOfGr.receiptNumber}
                        </Text>
                      )}
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{gr.purchaseOrder.orderNumber}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{gr.purchaseOrder.supplier.name}</Text>
                    </Box>
                    <Box as="td" padding={2}>
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
                      {gr.reversedByGr && (
                        <Text size={1} color="default2" marginLeft={2}>
                          → {gr.reversedByGr.receiptNumber}
                        </Text>
                      )}
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{gr._count.lines}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{new Date(gr.createdAt).toLocaleDateString()}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Text
                        color="default2"
                        __maxWidth="200px"
                        __overflow="hidden"
                        __textOverflow="ellipsis"
                        __whiteSpace="nowrap"
                      >
                        {gr.notes || "-"}
                      </Text>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
            {goodsReceiptsData?.hasMore && (
              <Box padding={4} display="flex" justifyContent="center">
                <Text color="default2">Showing {goodsReceipts.length} of {goodsReceiptsData.total} receipts</Text>
              </Box>
            )}
          </Layout.AppSectionCard>
        )}
      </Layout.AppSection>
    </Box>
  );
};

export default GoodsReceiptsPage;
