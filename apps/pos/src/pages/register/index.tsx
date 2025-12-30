import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";

import { trpcClient } from "@/modules/trpc/trpc-client";

const RegisterPage: NextPage = () => {
  const router = useRouter();
  const { data: currentSession, isLoading } = trpcClient.register.current.useQuery();
  const { data: cashSummary } = trpcClient.register.cashSummary.useQuery(undefined, {
    enabled: !!currentSession,
  });

  const handleOpenRegister = () => {
    router.push("/register/open");
  };

  const handleCloseRegister = () => {
    router.push("/register/close");
  };

  const handleGoToTransaction = () => {
    router.push("/transaction");
  };

  if (isLoading) {
    return (
      <Box>
        <Text>Loading register status...</Text>
      </Box>
    );
  }

  return (
    <Box display="flex" flexDirection="column" gap={6}>
      <Text size={8} fontWeight="bold">
        Register
      </Text>

      {!currentSession ? (
        // No open session
        <Box
          padding={6}
          borderRadius={4}
          borderWidth={1}
          borderStyle="solid"
          borderColor="default1"
          display="flex"
          flexDirection="column"
          gap={4}
          alignItems="center"
        >
          <Text size={6} color="default2">
            No register is currently open
          </Text>
          <Button onClick={handleOpenRegister} variant="primary" size="large">
            Open Register
          </Button>
        </Box>
      ) : (
        // Session is open
        <Box display="flex" flexDirection="column" gap={4}>
          {/* Session Info */}
          <Box
            padding={4}
            borderRadius={4}
            borderWidth={1}
            borderStyle="solid"
            borderColor="default1"
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={4}>
              <Box>
                <Text size={6} fontWeight="bold">
                  {currentSession.registerName}
                </Text>
                <Text size={3} color="default2">
                  Status:{" "}
                  <Text
                    as="span"
                    color={currentSession.status === "OPEN" ? "success1" : "warning1"}
                  >
                    {currentSession.status}
                  </Text>
                </Text>
              </Box>
              <Box display="flex" gap={2}>
                <Button onClick={handleGoToTransaction} variant="primary">
                  Start Transaction
                </Button>
                <Button onClick={handleCloseRegister} variant="secondary">
                  Close Register
                </Button>
              </Box>
            </Box>

            <Box display="grid" __gridTemplateColumns="repeat(3, 1fr)" gap={4}>
              <Box>
                <Text size={2} color="default2">
                  Opened By
                </Text>
                <Text size={4}>{currentSession.openedByName ?? "Unknown"}</Text>
              </Box>
              <Box>
                <Text size={2} color="default2">
                  Opened At
                </Text>
                <Text size={4}>{new Date(currentSession.openedAt).toLocaleString()}</Text>
              </Box>
              <Box>
                <Text size={2} color="default2">
                  Opening Float
                </Text>
                <Text size={4}>${currentSession.openingFloat.toFixed(2)}</Text>
              </Box>
            </Box>
          </Box>

          {/* Cash Summary */}
          {cashSummary && (
            <Box
              padding={4}
              borderRadius={4}
              borderWidth={1}
              borderStyle="solid"
              borderColor="default1"
            >
              <Text size={5} fontWeight="bold" marginBottom={4}>
                Cash Summary
              </Text>

              <Box display="grid" __gridTemplateColumns="repeat(4, 1fr)" gap={4}>
                <Box>
                  <Text size={2} color="default2">
                    Current Cash
                  </Text>
                  <Text size={6} fontWeight="bold">
                    ${cashSummary.currentCash.toFixed(2)}
                  </Text>
                </Box>
                <Box>
                  <Text size={2} color="default2">
                    Cash Sales
                  </Text>
                  <Text size={4} color="success1">
                    +${cashSummary.totalSales.toFixed(2)}
                  </Text>
                </Box>
                <Box>
                  <Text size={2} color="default2">
                    Cash Returns
                  </Text>
                  <Text size={4} color="critical1">
                    -${cashSummary.totalReturns.toFixed(2)}
                  </Text>
                </Box>
                <Box>
                  <Text size={2} color="default2">
                    Drops/Payouts
                  </Text>
                  <Text size={4}>
                    -${(cashSummary.totalDrops + cashSummary.totalPayouts).toFixed(2)}
                  </Text>
                </Box>
              </Box>
            </Box>
          )}

          {/* Session Stats */}
          <Box
            padding={4}
            borderRadius={4}
            borderWidth={1}
            borderStyle="solid"
            borderColor="default1"
          >
            <Text size={5} fontWeight="bold" marginBottom={4}>
              Session Stats
            </Text>

            <Box display="grid" __gridTemplateColumns="repeat(3, 1fr)" gap={4}>
              <Box>
                <Text size={2} color="default2">
                  Transactions
                </Text>
                <Text size={6}>{currentSession._count?.transactions ?? 0}</Text>
              </Box>
              <Box>
                <Text size={2} color="default2">
                  Cash Movements
                </Text>
                <Text size={6}>{currentSession._count?.cashMovements ?? 0}</Text>
              </Box>
              <Box>
                <Text size={2} color="default2">
                  Session Duration
                </Text>
                <Text size={4}>{getSessionDuration(currentSession.openedAt)}</Text>
              </Box>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

function getSessionDuration(openedAt: Date): string {
  const now = new Date();
  const opened = new Date(openedAt);
  const diffMs = now.getTime() - opened.getTime();

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

export default RegisterPage;
