import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import Link from "next/link";

import { trpcClient } from "@/modules/trpc/trpc-client";

const TransactionsPage: NextPage = () => {
  const { data, isLoading } = trpcClient.transactions.list.useQuery({
    limit: 50,
  });

  if (isLoading) {
    return (
      <Box>
        <Text>Loading transactions...</Text>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Text size={8} fontWeight="bold">
          Transaction History
        </Text>
        <Text color="default2">
          Showing {data?.transactions.length ?? 0} of {data?.total ?? 0}
        </Text>
      </Box>

      {/* Transactions List */}
      <Box borderRadius={4} borderWidth={1} borderStyle="solid" borderColor="default1" overflow="hidden">
        {/* Header */}
        <Box
          display="grid"
          __gridTemplateColumns="180px 100px 100px 120px 120px 100px"
          gap={4}
          padding={3}
          backgroundColor="default1"
          borderBottomWidth={1}
          borderBottomStyle="solid"
          borderColor="default1"
        >
          <Text size={2} fontWeight="bold">
            Transaction #
          </Text>
          <Text size={2} fontWeight="bold">
            Type
          </Text>
          <Text size={2} fontWeight="bold">
            Status
          </Text>
          <Text size={2} fontWeight="bold" textAlign="right">
            Total
          </Text>
          <Text size={2} fontWeight="bold">
            Date
          </Text>
          <Text size={2} fontWeight="bold" textAlign="center">
            Actions
          </Text>
        </Box>

        {/* Rows */}
        {data?.transactions.length === 0 ? (
          <Box padding={6} textAlign="center">
            <Text color="default2">No transactions found</Text>
          </Box>
        ) : (
          data?.transactions.map((tx) => (
            <Box
              key={tx.id}
              display="grid"
              __gridTemplateColumns="180px 100px 100px 120px 120px 100px"
              gap={4}
              padding={3}
              borderBottomWidth={1}
              borderBottomStyle="solid"
              borderColor="default1"
              alignItems="center"
            >
              <Box>
                <Text size={3} fontWeight="bold">
                  {tx.transactionNumber}
                </Text>
                <Text size={1} color="default2">
                  {tx._count?.lines ?? 0} items
                </Text>
              </Box>
              <Text size={3}>{formatType(tx.transactionType)}</Text>
              <Box>
                <StatusBadge status={tx.status} />
              </Box>
              <Text size={3} textAlign="right" fontWeight="bold">
                ${Number(tx.grandTotal).toFixed(2)}
              </Text>
              <Text size={2} color="default2">
                {new Date(tx.startedAt).toLocaleString()}
              </Text>
              <Box textAlign="center">
                <Link href={`/transactions/${tx.id}`}>
                  <Button variant="tertiary" size="small">
                    View
                  </Button>
                </Link>
              </Box>
            </Box>
          ))
        )}
      </Box>

      {data?.hasMore && (
        <Box textAlign="center">
          <Button variant="tertiary">Load More</Button>
        </Box>
      )}
    </Box>
  );
};

const StatusBadge = ({ status }: { status: string }) => {
  const colors: Record<string, "warning1" | "info1" | "success1" | "critical1" | "default1"> = {
    DRAFT: "warning1",
    SUSPENDED: "info1",
    COMPLETED: "success1",
    VOIDED: "critical1",
  };

  return (
    <Box
      padding={1}
      paddingX={2}
      borderRadius={2}
      backgroundColor={colors[status] ?? "default1"}
      display="inline-block"
    >
      <Text size={1}>{status}</Text>
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

export default TransactionsPage;
