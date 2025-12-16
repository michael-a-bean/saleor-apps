import { Layout } from "@saleor/apps-ui";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const formatCurrency = (amount: string, currency: string) => {
  const num = parseFloat(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(num);
};

const formatNumber = (num: number) => {
  return new Intl.NumberFormat("en-US").format(num);
};

const InventoryValuePage: NextPage = () => {
  const [selectedWarehouse] = useState<string | undefined>(undefined);

  const {
    data: valuationData,
    isLoading,
    error,
    refetch,
  } = trpcClient.reporting.inventoryValuation.useQuery({
    warehouseId: selectedWarehouse,
  });

  const { data: summaryData } = trpcClient.reporting.dashboardSummary.useQuery();

  if (error) {
    return (
      <Box>
        <Text color="critical1">Error loading inventory valuation: {error.message}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Inventory Valuation
        </Text>
        <Button variant="secondary" onClick={() => refetch()}>
          Refresh
        </Button>
      </Box>

      <Layout.AppSection
        heading="Inventory Value Report"
        sideContent={
          <Box display="flex" flexDirection="column" gap={4}>
            <Text>
              Weighted Average Cost (WAC) valuation of all inventory. Each item&apos;s value is
              calculated as: Quantity on Hand × WAC.
            </Text>
            {summaryData && (
              <Box display="flex" flexDirection="column" gap={2}>
                <Text fontWeight="bold" size={3}>
                  Summary
                </Text>
                <Box
                  padding={3}
                  borderRadius={2}
                  backgroundColor="default1"
                  display="flex"
                  flexDirection="column"
                  gap={2}
                >
                  <Box display="flex" justifyContent="space-between">
                    <Text color="default2">Total Value:</Text>
                    <Text fontWeight="bold">
                      {formatCurrency(summaryData.inventory.totalValue, summaryData.inventory.currency)}
                    </Text>
                  </Box>
                  <Box display="flex" justifyContent="space-between">
                    <Text color="default2">Items in Stock:</Text>
                    <Text fontWeight="bold">{formatNumber(summaryData.inventory.itemCount)}</Text>
                  </Box>
                  <Box display="flex" justifyContent="space-between">
                    <Text color="default2">Total Quantity:</Text>
                    <Text fontWeight="bold">{formatNumber(summaryData.inventory.totalQuantity)}</Text>
                  </Box>
                  <Box display="flex" justifyContent="space-between">
                    <Text color="default2">Cost Events:</Text>
                    <Text fontWeight="bold">{formatNumber(summaryData.activity.totalCostEvents)}</Text>
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        }
      >
        {isLoading ? (
          <Text>Loading inventory valuation...</Text>
        ) : !valuationData || valuationData.items.length === 0 ? (
          <Layout.AppSectionCard>
            <Box padding={6} display="flex" flexDirection="column" alignItems="center" gap={4}>
              <Text>No inventory data found.</Text>
              <Text color="default2">
                Post goods receipts to create cost layer events and build inventory value.
              </Text>
            </Box>
          </Layout.AppSectionCard>
        ) : (
          <>
            {/* Summary Cards */}
            <Box display="grid" __gridTemplateColumns="repeat(3, 1fr)" gap={4} marginBottom={6}>
              <Box
                padding={4}
                borderRadius={2}
                backgroundColor="default1"
                borderWidth={1}
                borderColor="default1"
                borderStyle="solid"
              >
                <Text color="default2" size={2}>
                  Total Inventory Value
                </Text>
                <Text size={8} fontWeight="bold">
                  {formatCurrency(valuationData.totalValue, valuationData.currency)}
                </Text>
              </Box>
              <Box
                padding={4}
                borderRadius={2}
                backgroundColor="default1"
                borderWidth={1}
                borderColor="default1"
                borderStyle="solid"
              >
                <Text color="default2" size={2}>
                  Unique Items
                </Text>
                <Text size={8} fontWeight="bold">
                  {formatNumber(valuationData.itemCount)}
                </Text>
              </Box>
              <Box
                padding={4}
                borderRadius={2}
                backgroundColor="default1"
                borderWidth={1}
                borderColor="default1"
                borderStyle="solid"
              >
                <Text color="default2" size={2}>
                  Total Quantity
                </Text>
                <Text size={8} fontWeight="bold">
                  {formatNumber(valuationData.totalQuantity)}
                </Text>
              </Box>
            </Box>

            {/* Inventory Table */}
            <Layout.AppSectionCard>
              <Box
                padding={3}
                style={{ borderBottom: "1px solid #e5e7eb" }}
                display="flex"
                justifyContent="space-between"
                alignItems="center"
              >
                <Text fontWeight="bold">
                  Inventory Items ({valuationData.items.length})
                </Text>
                <Text color="default2" size={2}>
                  Generated: {new Date(valuationData.generatedAt).toLocaleString()}
                </Text>
              </Box>
              <Box as="table" width="100%">
                <Box as="thead">
                  <Box as="tr" backgroundColor="default1">
                    <Box as="th" padding={3} textAlign="left">
                      <Text fontWeight="bold" size={2}>
                        SKU
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="left">
                      <Text fontWeight="bold" size={2}>
                        Name
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="right">
                      <Text fontWeight="bold" size={2}>
                        Qty on Hand
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="right">
                      <Text fontWeight="bold" size={2}>
                        WAC
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="right">
                      <Text fontWeight="bold" size={2}>
                        Total Value
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="left">
                      <Text fontWeight="bold" size={2}>
                        Last Activity
                      </Text>
                    </Box>
                  </Box>
                </Box>
                <Box as="tbody">
                  {valuationData.items.map((item, index) => (
                    <Box
                      as="tr"
                      key={`${item.variantId}-${item.warehouseId}`}
                      style={{
                        borderBottom: "1px solid #e5e7eb",
                        backgroundColor: index % 2 === 0 ? "transparent" : "#f9fafb",
                      }}
                    >
                      <Box as="td" padding={3}>
                        <Text fontWeight="medium">{item.variantSku || item.variantId.slice(0, 8)}</Text>
                      </Box>
                      <Box as="td" padding={3}>
                        <Text
                          __maxWidth="250px"
                          __overflow="hidden"
                          __textOverflow="ellipsis"
                          __whiteSpace="nowrap"
                        >
                          {item.variantName || "-"}
                        </Text>
                      </Box>
                      <Box as="td" padding={3} textAlign="right">
                        <Text>{formatNumber(item.qtyOnHand)}</Text>
                      </Box>
                      <Box as="td" padding={3} textAlign="right">
                        <Text>{formatCurrency(item.wac, item.currency)}</Text>
                      </Box>
                      <Box as="td" padding={3} textAlign="right">
                        <Text fontWeight="bold">{formatCurrency(item.totalValue, item.currency)}</Text>
                      </Box>
                      <Box as="td" padding={3}>
                        <Text color="default2" size={2}>
                          {item.lastEventAt
                            ? new Date(item.lastEventAt).toLocaleDateString()
                            : "-"}
                        </Text>
                      </Box>
                    </Box>
                  ))}
                </Box>
                <Box as="tfoot">
                  <Box as="tr" backgroundColor="default1">
                    <Box as="td" padding={3} colSpan={2}>
                      <Text fontWeight="bold">Total</Text>
                    </Box>
                    <Box as="td" padding={3} textAlign="right">
                      <Text fontWeight="bold">{formatNumber(valuationData.totalQuantity)}</Text>
                    </Box>
                    <Box as="td" padding={3} textAlign="right">
                      <Text color="default2">-</Text>
                    </Box>
                    <Box as="td" padding={3} textAlign="right">
                      <Text fontWeight="bold" size={4}>
                        {formatCurrency(valuationData.totalValue, valuationData.currency)}
                      </Text>
                    </Box>
                    <Box as="td" padding={3}></Box>
                  </Box>
                </Box>
              </Box>
            </Layout.AppSectionCard>
          </>
        )}
      </Layout.AppSection>
    </Box>
  );
};

export default InventoryValuePage;
