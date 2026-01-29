import { Box, Text, Button } from "@saleor/macaw-ui";
import { NextPage } from "next";
import Link from "next/link";

import { trpcClient } from "@/modules/trpc/trpc-client";

const DashboardPage: NextPage = () => {
  const { data: importStats, isLoading: importLoading } = trpcClient.import.stats.useQuery();
  const { data: jobStats, isLoading: jobsLoading } = trpcClient.jobs.stats.useQuery();
  const { data: auditSummary, isLoading: auditLoading } = trpcClient.audit.summary.useQuery();
  const { data: cacheStatus, isLoading: cacheLoading } = trpcClient.scryfall.getCacheStatus.useQuery();

  const isLoading = importLoading || jobsLoading || auditLoading || cacheLoading;

  return (
    <Box>
      <Text as="h1" size={10} fontWeight="bold" marginBottom={6}>
        Dashboard
      </Text>

      {isLoading ? (
        <Text>Loading...</Text>
      ) : (
        <Box display="flex" flexDirection="column" gap={6}>
          {/* Stats Cards */}
          <Box display="flex" gap={4} flexWrap="wrap">
            {/* Import Stats */}
            <Box
              backgroundColor="default1"
              padding={4}
              borderRadius={2}
              style={{ minWidth: "200px" }}
            >
              <Text size={3} color="default2" marginBottom={2}>
                Imported Products
              </Text>
              <Text size={8} fontWeight="bold">
                {importStats?.totalProducts?.toLocaleString() ?? 0}
              </Text>
              <Text size={2} color="default2" marginTop={1}>
                across {importStats?.setCount ?? 0} sets
              </Text>
            </Box>

            {/* Job Stats */}
            <Box
              backgroundColor="default1"
              padding={4}
              borderRadius={2}
              style={{ minWidth: "200px" }}
            >
              <Text size={3} color="default2" marginBottom={2}>
                Job Queue
              </Text>
              <Box display="flex" gap={2} alignItems="baseline">
                <Text size={8} fontWeight="bold" color={jobStats?.running ? "info1" : undefined}>
                  {jobStats?.running ?? 0}
                </Text>
                <Text size={3} color="default2">running</Text>
              </Box>
              <Text size={2} color="default2" marginTop={1}>
                {jobStats?.pending ?? 0} pending, {jobStats?.completed ?? 0} completed
              </Text>
            </Box>

            {/* Audit Stats */}
            <Box
              backgroundColor="default1"
              padding={4}
              borderRadius={2}
              style={{ minWidth: "200px" }}
            >
              <Text size={3} color="default2" marginBottom={2}>
                Completion Rate
              </Text>
              <Text size={8} fontWeight="bold">
                {auditSummary?.completionRate ?? 0}%
              </Text>
              <Text size={2} color="default2" marginTop={1}>
                {auditSummary?.sellableSets ?? 0} / {auditSummary?.totalSets ?? 0} sets sellable
              </Text>
            </Box>

            {/* Cache Status */}
            <Box
              backgroundColor="default1"
              padding={4}
              borderRadius={2}
              style={{ minWidth: "200px" }}
            >
              <Text size={3} color="default2" marginBottom={2}>
                Scryfall Cache
              </Text>
              <Text size={8} fontWeight="bold" color={cacheStatus?.cached ? "success1" : "warning1"}>
                {cacheStatus?.cached ? "Ready" : "Empty"}
              </Text>
              {cacheStatus?.metadata && (
                <Text size={2} color="default2" marginTop={1}>
                  {cacheStatus.metadata.cardCount.toLocaleString()} cards
                </Text>
              )}
            </Box>
          </Box>

          {/* Quick Actions */}
          <Box>
            <Text size={5} fontWeight="bold" marginBottom={4}>
              Quick Actions
            </Text>
            <Box display="flex" gap={3}>
              <Link href="/import" style={{ textDecoration: "none" }}>
                <Button variant="primary">Start Import</Button>
              </Link>
              <Link href="/audit" style={{ textDecoration: "none" }}>
                <Button variant="secondary">Run Audit</Button>
              </Link>
              <Link href="/jobs" style={{ textDecoration: "none" }}>
                <Button variant="secondary">View Jobs</Button>
              </Link>
            </Box>
          </Box>

          {/* Recent Imports */}
          {importStats?.recentImports && importStats.recentImports.length > 0 && (
            <Box>
              <Text size={5} fontWeight="bold" marginBottom={4}>
                Recent Imports
              </Text>
              <Box display="flex" flexDirection="column" gap={2}>
                {importStats.recentImports.map((item, index) => (
                  <Box
                    key={index}
                    backgroundColor="default1"
                    padding={3}
                    borderRadius={2}
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <Box>
                      <Text fontWeight="medium">{item.cardName}</Text>
                      <Text size={2} color="default2">
                        {item.setCode.toUpperCase()}
                      </Text>
                    </Box>
                    <Text size={2} color="default2">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </Text>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default DashboardPage;
