import { JobType } from "@prisma/client";
import { Box, Text, Button, Input } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const ImportPage: NextPage = () => {
  const router = useRouter();
  const [setCode, setSetCode] = useState("");

  const { data: cacheStatus, refetch: refetchCache } = trpcClient.scryfall.getCacheStatus.useQuery();
  const { data: stats } = trpcClient.import.stats.useQuery();

  const refreshCacheMutation = trpcClient.scryfall.refreshCache.useMutation({
    onSuccess: () => refetchCache(),
  });

  const startBulkImportMutation = trpcClient.import.startBulkImport.useMutation({
    onSuccess: (data) => {
      router.push(`/jobs/${data.jobId}`);
    },
  });

  const startSetImportMutation = trpcClient.import.startSetImport.useMutation({
    onSuccess: (data) => {
      router.push(`/jobs/${data.jobId}`);
    },
  });

  return (
    <Box>
      <Text as="h1" size={10} fontWeight="bold" marginBottom={6}>
        Import
      </Text>

      {/* Scryfall Cache Section */}
      <Box marginBottom={8}>
        <Text size={5} fontWeight="bold" marginBottom={4}>
          Scryfall Cache
        </Text>
        <Box backgroundColor="default1" padding={4} borderRadius={2}>
          {cacheStatus?.cached ? (
            <Box>
              <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={4}>
                <Box>
                  <Text fontWeight="bold" color="success1">Cache Ready</Text>
                  <Text size={2} color="default2">
                    {cacheStatus.metadata?.cardCount.toLocaleString()} cards available
                  </Text>
                </Box>
                <Button
                  onClick={() => refreshCacheMutation.mutate()}
                  disabled={refreshCacheMutation.isLoading}
                  variant="secondary"
                >
                  {refreshCacheMutation.isLoading ? "Refreshing..." : "Refresh Cache"}
                </Button>
              </Box>
              {cacheStatus.metadata && (
                <Box display="flex" gap={4}>
                  <Box>
                    <Text size={2} color="default2">Downloaded</Text>
                    <Text size={3}>
                      {new Date(cacheStatus.metadata.downloadedAt).toLocaleString()}
                    </Text>
                  </Box>
                  <Box>
                    <Text size={2} color="default2">Scryfall Updated</Text>
                    <Text size={3}>
                      {new Date(cacheStatus.metadata.scryfallUpdatedAt).toLocaleString()}
                    </Text>
                  </Box>
                </Box>
              )}
            </Box>
          ) : (
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box>
                <Text fontWeight="bold" color="warning1">Cache Empty</Text>
                <Text size={2} color="default2">
                  Download Scryfall bulk data to enable imports
                </Text>
              </Box>
              <Button
                onClick={() => refreshCacheMutation.mutate()}
                disabled={refreshCacheMutation.isLoading}
                variant="primary"
              >
                {refreshCacheMutation.isLoading ? "Downloading..." : "Download Data"}
              </Button>
            </Box>
          )}
        </Box>
      </Box>

      {/* Bulk Import Section */}
      <Box marginBottom={8}>
        <Text size={5} fontWeight="bold" marginBottom={4}>
          Bulk Import
        </Text>
        <Box backgroundColor="default1" padding={4} borderRadius={2}>
          <Text marginBottom={4}>
            Import all English paper cards from Scryfall. This will create products
            and variants for approximately 100,000 cards.
          </Text>
          {stats && (
            <Text size={2} color="default2" marginBottom={4}>
              Currently have {stats.totalProducts.toLocaleString()} imported products
              across {stats.setCount} sets.
            </Text>
          )}
          <Button
            onClick={() => startBulkImportMutation.mutate({ priority: 2 })}
            disabled={!cacheStatus?.cached || startBulkImportMutation.isLoading}
            variant="primary"
          >
            {startBulkImportMutation.isLoading ? "Starting..." : "Start Bulk Import"}
          </Button>
        </Box>
      </Box>

      {/* Set Import Section */}
      <Box marginBottom={8}>
        <Text size={5} fontWeight="bold" marginBottom={4}>
          Import Specific Set
        </Text>
        <Box backgroundColor="default1" padding={4} borderRadius={2}>
          <Text marginBottom={4}>
            Import cards from a specific set by its code (e.g., "neo" for Kamigawa: Neon Dynasty).
            Use this for new set releases.
          </Text>
          <Box display="flex" gap={4} alignItems="flex-end">
            <Box style={{ width: "200px" }}>
              <Input
                label="Set Code"
                value={setCode}
                onChange={(e) => setSetCode(e.target.value.toLowerCase())}
                placeholder="e.g., neo, one, mkm"
              />
            </Box>
            <Button
              onClick={() => {
                if (setCode) {
                  startSetImportMutation.mutate({
                    setCode,
                    priority: 0,  // Prerelease priority
                  });
                }
              }}
              disabled={!setCode || startSetImportMutation.isLoading}
              variant="primary"
            >
              {startSetImportMutation.isLoading ? "Starting..." : "Import Set"}
            </Button>
          </Box>
        </Box>
      </Box>

      {/* Import Statistics */}
      {stats && stats.productsBySet.length > 0 && (
        <Box>
          <Text size={5} fontWeight="bold" marginBottom={4}>
            Import Statistics by Set
          </Text>
          <Box backgroundColor="default1" padding={4} borderRadius={2}>
            <Box display="flex" flexWrap="wrap" gap={2}>
              {stats.productsBySet.slice(0, 20).map((set) => (
                <Box
                  key={set.setCode}
                  backgroundColor="default2"
                  paddingX={3}
                  paddingY={2}
                  borderRadius={1}
                >
                  <Text fontWeight="bold">{set.setCode.toUpperCase()}</Text>
                  <Text size={2} color="default2"> {set.count}</Text>
                </Box>
              ))}
              {stats.productsBySet.length > 20 && (
                <Box paddingX={3} paddingY={2}>
                  <Text color="default2">+{stats.productsBySet.length - 20} more sets</Text>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default ImportPage;
