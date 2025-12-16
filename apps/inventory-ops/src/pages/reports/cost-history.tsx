import { Layout } from "@saleor/apps-ui";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

type EventType = "GOODS_RECEIPT" | "GOODS_RECEIPT_REVERSAL" | "LANDED_COST_ADJUSTMENT" | undefined;

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

const eventTypeColors: Record<string, { bg: string; text: string }> = {
  GOODS_RECEIPT: { bg: "#d1fae5", text: "#065f46" },
  GOODS_RECEIPT_REVERSAL: { bg: "#fee2e2", text: "#991b1b" },
  LANDED_COST_ADJUSTMENT: { bg: "#dbeafe", text: "#1e40af" },
};

const eventTypeLabels: Record<string, string> = {
  GOODS_RECEIPT: "Receipt",
  GOODS_RECEIPT_REVERSAL: "Reversal",
  LANDED_COST_ADJUSTMENT: "Landed Cost",
};

const CostHistoryPage: NextPage = () => {
  const router = useRouter();
  const [eventTypeFilter, setEventTypeFilter] = useState<EventType>(undefined);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(0);
  const pageSize = 50;

  const {
    data: historyData,
    isLoading,
    error,
    refetch,
  } = trpcClient.reporting.costHistory.useQuery({
    eventType: eventTypeFilter,
    startDate: startDate ? new Date(startDate).toISOString() : undefined,
    endDate: endDate ? new Date(endDate + "T23:59:59").toISOString() : undefined,
    limit: pageSize,
    offset: currentPage * pageSize,
  });

  const events = historyData?.events ?? [];

  const clearFilters = () => {
    setEventTypeFilter(undefined);
    setStartDate("");
    setEndDate("");
    setCurrentPage(0);
  };

  if (error) {
    return (
      <Box>
        <Text color="critical1">Error loading cost history: {error.message}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Cost History
        </Text>
        <Box display="flex" gap={2}>
          <Button variant="secondary" onClick={clearFilters}>
            Clear Filters
          </Button>
          <Button variant="secondary" onClick={() => refetch()}>
            Refresh
          </Button>
        </Box>
      </Box>

      <Layout.AppSection
        heading="Cost Event History"
        sideContent={
          <Box display="flex" flexDirection="column" gap={4}>
            <Text>
              Chronological record of all inventory cost events. Each receipt or reversal creates
              an immutable cost layer entry for WAC calculation.
            </Text>

            {/* Event Type Filter */}
            <Box display="flex" flexDirection="column" gap={2}>
              <Text fontWeight="bold" size={3}>
                Event Type
              </Text>
              <Box display="flex" gap={2} flexWrap="wrap">
                <Button
                  variant={eventTypeFilter === undefined ? "primary" : "secondary"}
                  size="small"
                  onClick={() => {
                    setEventTypeFilter(undefined);
                    setCurrentPage(0);
                  }}
                >
                  All
                </Button>
                <Button
                  variant={eventTypeFilter === "GOODS_RECEIPT" ? "primary" : "secondary"}
                  size="small"
                  onClick={() => {
                    setEventTypeFilter("GOODS_RECEIPT");
                    setCurrentPage(0);
                  }}
                >
                  Receipts
                </Button>
                <Button
                  variant={eventTypeFilter === "GOODS_RECEIPT_REVERSAL" ? "primary" : "secondary"}
                  size="small"
                  onClick={() => {
                    setEventTypeFilter("GOODS_RECEIPT_REVERSAL");
                    setCurrentPage(0);
                  }}
                >
                  Reversals
                </Button>
              </Box>
            </Box>

            {/* Date Range Filter */}
            <Box display="flex" flexDirection="column" gap={2}>
              <Text fontWeight="bold" size={3}>
                Date Range
              </Text>
              <Box display="flex" flexDirection="column" gap={2}>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setCurrentPage(0);
                  }}
                  style={{
                    padding: "6px 10px",
                    border: "1px solid #e5e7eb",
                    borderRadius: "4px",
                    fontSize: "14px",
                  }}
                  placeholder="Start date"
                />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setCurrentPage(0);
                  }}
                  style={{
                    padding: "6px 10px",
                    border: "1px solid #e5e7eb",
                    borderRadius: "4px",
                    fontSize: "14px",
                  }}
                  placeholder="End date"
                />
              </Box>
            </Box>

            {/* Page Summary */}
            {historyData?.summary && (
              <Box display="flex" flexDirection="column" gap={2}>
                <Text fontWeight="bold" size={3}>
                  Page Summary
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
                    <Text color="default2">Net Qty Change:</Text>
                    <Text
                      fontWeight="bold"
                      color={historyData.summary.totalQtyDelta >= 0 ? "success1" : "critical1"}
                    >
                      {historyData.summary.totalQtyDelta >= 0 ? "+" : ""}
                      {formatNumber(historyData.summary.totalQtyDelta)}
                    </Text>
                  </Box>
                  <Box display="flex" justifyContent="space-between">
                    <Text color="default2">Net Value Change:</Text>
                    <Text
                      fontWeight="bold"
                      color={parseFloat(historyData.summary.totalValueDelta) >= 0 ? "success1" : "critical1"}
                    >
                      {parseFloat(historyData.summary.totalValueDelta) >= 0 ? "+" : ""}
                      {formatCurrency(historyData.summary.totalValueDelta, "USD")}
                    </Text>
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        }
      >
        {isLoading ? (
          <Text>Loading cost history...</Text>
        ) : events.length === 0 ? (
          <Layout.AppSectionCard>
            <Box padding={6} display="flex" flexDirection="column" alignItems="center" gap={4}>
              <Text>No cost events found.</Text>
              <Text color="default2">
                {eventTypeFilter || startDate || endDate
                  ? "Try adjusting your filters."
                  : "Post goods receipts to create cost layer events."}
              </Text>
            </Box>
          </Layout.AppSectionCard>
        ) : (
          <>
            {/* Results Info */}
            <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={4}>
              <Text color="default2">
                Showing {currentPage * pageSize + 1}-{currentPage * pageSize + events.length} of{" "}
                {historyData?.total ?? 0} events
              </Text>
              <Box display="flex" gap={2}>
                <Button
                  variant="secondary"
                  size="small"
                  disabled={currentPage === 0}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="small"
                  disabled={!historyData?.hasMore}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  Next
                </Button>
              </Box>
            </Box>

            {/* Events Table */}
            <Layout.AppSectionCard>
              <Box as="table" width="100%">
                <Box as="thead">
                  <Box as="tr" backgroundColor="default1">
                    <Box as="th" padding={3} textAlign="left">
                      <Text fontWeight="bold" size={2}>
                        Date/Time
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="left">
                      <Text fontWeight="bold" size={2}>
                        Type
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="left">
                      <Text fontWeight="bold" size={2}>
                        SKU
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="left">
                      <Text fontWeight="bold" size={2}>
                        Receipt #
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="right">
                      <Text fontWeight="bold" size={2}>
                        Qty
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="right">
                      <Text fontWeight="bold" size={2}>
                        Unit Cost
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="right">
                      <Text fontWeight="bold" size={2}>
                        Total Cost
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="right">
                      <Text fontWeight="bold" size={2}>
                        Qty After
                      </Text>
                    </Box>
                  </Box>
                </Box>
                <Box as="tbody">
                  {events.map((event, index) => {
                    const colors = eventTypeColors[event.eventType] || {
                      bg: "#f3f4f6",
                      text: "#374151",
                    };
                    const totalCost = event.qtyDelta * parseFloat(event.totalUnitCost);

                    return (
                      <Box
                        as="tr"
                        key={event.id}
                        style={{
                          borderBottom: "1px solid #e5e7eb",
                          backgroundColor: index % 2 === 0 ? "transparent" : "#f9fafb",
                        }}
                      >
                        <Box as="td" padding={3}>
                          <Text size={2}>
                            {new Date(event.eventTimestamp).toLocaleString()}
                          </Text>
                        </Box>
                        <Box as="td" padding={3}>
                          <Box
                            as="span"
                            paddingX={2}
                            paddingY={1}
                            borderRadius={4}
                            __backgroundColor={colors.bg}
                            __color={colors.text}
                            __fontSize="11px"
                            __fontWeight="600"
                          >
                            {eventTypeLabels[event.eventType] || event.eventType}
                          </Box>
                        </Box>
                        <Box as="td" padding={3}>
                          <Text fontWeight="medium">
                            {event.variantSku || event.saleorVariantId.slice(0, 8)}
                          </Text>
                          {event.variantName && (
                            <Text
                              size={1}
                              color="default2"
                              __maxWidth="150px"
                              __overflow="hidden"
                              __textOverflow="ellipsis"
                              __whiteSpace="nowrap"
                            >
                              {event.variantName}
                            </Text>
                          )}
                        </Box>
                        <Box as="td" padding={3}>
                          {event.receiptId ? (
                            <Text
                              color="info1"
                              cursor="pointer"
                              onClick={() => router.push(`/goods-receipts/${event.receiptId}`)}
                              __textDecoration="underline"
                            >
                              {event.receiptNumber || "-"}
                            </Text>
                          ) : (
                            <Text color="default2">-</Text>
                          )}
                        </Box>
                        <Box as="td" padding={3} textAlign="right">
                          <Text
                            fontWeight="bold"
                            color={event.qtyDelta >= 0 ? "success1" : "critical1"}
                          >
                            {event.qtyDelta >= 0 ? "+" : ""}
                            {formatNumber(event.qtyDelta)}
                          </Text>
                        </Box>
                        <Box as="td" padding={3} textAlign="right">
                          <Text>{formatCurrency(event.totalUnitCost, event.currency)}</Text>
                          {parseFloat(event.landedCostDelta) > 0 && (
                            <Text size={1} color="default2">
                              +{formatCurrency(event.landedCostDelta, event.currency)} landed
                            </Text>
                          )}
                        </Box>
                        <Box as="td" padding={3} textAlign="right">
                          <Text
                            fontWeight="bold"
                            color={totalCost >= 0 ? "success1" : "critical1"}
                          >
                            {totalCost >= 0 ? "+" : ""}
                            {formatCurrency(totalCost.toFixed(4), event.currency)}
                          </Text>
                        </Box>
                        <Box as="td" padding={3} textAlign="right">
                          <Text>{event.qtyOnHandAtEvent !== null ? formatNumber(event.qtyOnHandAtEvent) : "-"}</Text>
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            </Layout.AppSectionCard>

            {/* Pagination */}
            {(historyData?.hasMore || currentPage > 0) && (
              <Box display="flex" justifyContent="center" gap={2} marginTop={4}>
                <Button
                  variant="secondary"
                  disabled={currentPage === 0}
                  onClick={() => setCurrentPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Box
                  padding={2}
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  __minWidth="100px"
                >
                  <Text>Page {currentPage + 1}</Text>
                </Box>
                <Button
                  variant="secondary"
                  disabled={!historyData?.hasMore}
                  onClick={() => setCurrentPage((p) => p + 1)}
                >
                  Next
                </Button>
              </Box>
            )}
          </>
        )}
      </Layout.AppSection>
    </Box>
  );
};

export default CostHistoryPage;
