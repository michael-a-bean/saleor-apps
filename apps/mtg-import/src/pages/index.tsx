import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { Layout } from "@saleor/apps-ui";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";

import { trpcClient } from "@/modules/trpc/trpc-client";
import type { ImportJob } from "@/types/import-types";

const STATUS_ICON: Record<string, string> = {
  pass: "✓",
  fail: "✗",
  warn: "⚠",
};

const STATUS_COLOR: Record<string, string> = {
  pass: "success1",
  fail: "critical1",
  warn: "info1",
};

const IndexPage: NextPage = () => {
  const { appBridgeState } = useAppBridge();
  const router = useRouter();

  const readiness = trpcClient.system.readiness.useQuery(undefined, {
    enabled: !!appBridgeState?.ready,
  });

  const catalog = trpcClient.catalog.summary.useQuery(undefined, {
    enabled: !!appBridgeState?.ready,
  });

  return (
    <Box>
      <Box marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Dashboard
        </Text>
      </Box>

      {/* System Readiness */}
      <Layout.AppSection
        heading="System Readiness"
        sideContent={
          <Text>
            Checks that Saleor is properly configured for MTG card imports.
            All checks must pass before importing.
          </Text>
        }
      >
        <Layout.AppSectionCard>
          {readiness.isLoading && (
            <Box padding={4}>
              <Text>Checking system readiness...</Text>
            </Box>
          )}
          {readiness.error && (
            <Box padding={4}>
              <Text color="critical1">Error: {readiness.error.message}</Text>
            </Box>
          )}
          {readiness.data && (
            <Box padding={4}>
              <Box
                display="flex"
                alignItems="center"
                gap={3}
                marginBottom={4}
                padding={3}
                borderRadius={2}
                backgroundColor={readiness.data.ready ? "success1" : "critical1"}
              >
                <Text fontWeight="bold" size={4}>
                  {readiness.data.ready ? "System Ready" : "System Not Ready"}
                </Text>
              </Box>

              <Box display="flex" flexDirection="column" gap={2}>
                {readiness.data.checks.map((check) => (
                  <Box
                    key={check.name}
                    display="flex"
                    alignItems="center"
                    gap={3}
                    padding={2}
                    borderRadius={2}
                  >
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    <Text size={4} color={STATUS_COLOR[check.status] as any}>
                      {STATUS_ICON[check.status]}
                    </Text>
                    <Box __flex="1">
                      <Text fontWeight="bold">{check.name}</Text>
                      <Text size={1} color="default2">
                        {check.message}
                      </Text>
                      {check.detail && (
                        <Text size={1} color="default2">
                          {check.detail}
                        </Text>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>

              {!readiness.data.ready && (
                <Box marginTop={4}>
                  <Button variant="secondary" onClick={() => readiness.refetch()}>
                    Re-check
                  </Button>
                </Box>
              )}
            </Box>
          )}
        </Layout.AppSectionCard>
      </Layout.AppSection>

      {/* Catalog Health */}
      <Box marginTop={6}>
        <Layout.AppSection
          heading="Catalog Health"
          sideContent={
            <Text>
              Overview of imported MTG card data across all sets.
            </Text>
          }
        >
          <Layout.AppSectionCard>
            {catalog.isLoading && (
              <Box padding={4}>
                <Text>Loading catalog data...</Text>
              </Box>
            )}
            {catalog.error && (
              <Box padding={4}>
                <Text color="critical1">Error: {catalog.error.message}</Text>
              </Box>
            )}
            {catalog.data && (
              <Box padding={4}>
                <Box display="flex" gap={6} flexWrap="wrap" marginBottom={4}>
                  <StatBox label="Sets Imported" value={String(catalog.data.totalSets)} />
                  <StatBox label="Complete Sets" value={String(catalog.data.completeSets)} />
                  <StatBox
                    label="Incomplete Sets"
                    value={String(catalog.data.incompleteSets)}
                    color={catalog.data.incompleteSets > 0 ? "critical1" : "success1"}
                  />
                  <StatBox label="Cards Imported" value={String(catalog.data.totalCards)} />
                  <StatBox label="Cards Expected" value={String(catalog.data.totalExpected)} />
                  <StatBox
                    label="Completeness"
                    value={`${catalog.data.completenessPercent}%`}
                    color={catalog.data.completenessPercent >= 100 ? "success1" : "info1"}
                  />
                  <StatBox label="Products in Saleor" value={String(catalog.data.totalProducts)} />
                  <StatBox label="Total Jobs Run" value={String(catalog.data.totalJobs)} />
                </Box>

                {/* Completeness Bar */}
                {catalog.data.totalExpected > 0 && (
                  <Box marginBottom={4}>
                    <Box display="flex" justifyContent="space-between" marginBottom={1}>
                      <Text size={1}>Overall Completeness</Text>
                      <Text size={1}>{catalog.data.completenessPercent}%</Text>
                    </Box>
                    <Box
                      __width="100%"
                      __height="8px"
                      backgroundColor="default2"
                      borderRadius={2}
                      overflow="hidden"
                    >
                      <Box
                        __width={`${Math.min(catalog.data.completenessPercent, 100)}%`}
                        __height="100%"
                        backgroundColor={
                          catalog.data.completenessPercent >= 100 ? "success1" : "info1"
                        }
                        __transition="width 0.3s ease"
                      />
                    </Box>
                  </Box>
                )}

                {/* Recent Jobs */}
                {catalog.data.recentJobs.length > 0 && (
                  <Box>
                    <Text as="p" fontWeight="bold" marginBottom={2}>
                      Recent Jobs
                    </Text>
                    <Box as="table" width="100%">
                      <Box as="thead">
                        <Box as="tr">
                          <Box as="th" padding={1} textAlign="left">
                            <Text size={1} fontWeight="bold">Type</Text>
                          </Box>
                          <Box as="th" padding={1} textAlign="left">
                            <Text size={1} fontWeight="bold">Set</Text>
                          </Box>
                          <Box as="th" padding={1} textAlign="left">
                            <Text size={1} fontWeight="bold">Status</Text>
                          </Box>
                          <Box as="th" padding={1} textAlign="right">
                            <Text size={1} fontWeight="bold">Cards</Text>
                          </Box>
                          <Box as="th" padding={1} textAlign="left">
                            <Text size={1} fontWeight="bold">Created</Text>
                          </Box>
                        </Box>
                      </Box>
                      <Box as="tbody">
                        {(catalog.data.recentJobs as unknown as ImportJob[]).map((job) => (
                          <Box
                            as="tr"
                            key={job.id}
                            cursor="pointer"
                            onClick={() => router.push(`/import/${job.id}`)}
                          >
                            <Box as="td" padding={1}>
                              <Text size={1}>{job.type}</Text>
                            </Box>
                            <Box as="td" padding={1}>
                              <Text size={1}>{job.setCode?.toUpperCase() ?? "ALL"}</Text>
                            </Box>
                            <Box as="td" padding={1}>
                              <Text
                                size={1}
                                color={
                                  job.status === "COMPLETED"
                                    ? "success1"
                                    : job.status === "FAILED"
                                    ? "critical1"
                                    : job.status === "RUNNING"
                                    ? "info1"
                                    : undefined
                                }
                              >
                                {job.status}
                              </Text>
                            </Box>
                            <Box as="td" padding={1} textAlign="right">
                              <Text size={1}>
                                {job.cardsProcessed}/{job.cardsTotal || "?"}
                              </Text>
                            </Box>
                            <Box as="td" padding={1}>
                              <Text size={1}>
                                {new Date(job.createdAt).toLocaleDateString()}
                              </Text>
                            </Box>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  </Box>
                )}

                {/* Quick Actions */}
                <Box display="flex" gap={3} marginTop={4}>
                  <Button onClick={() => router.push("/import/new")}>
                    New Import
                  </Button>
                  <Button variant="secondary" onClick={() => router.push("/sets")}>
                    Browse Sets
                  </Button>
                  <Button variant="secondary" onClick={() => router.push("/import")}>
                    View All Jobs
                  </Button>
                </Box>
              </Box>
            )}
          </Layout.AppSectionCard>
        </Layout.AppSection>
      </Box>
    </Box>
  );
};

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box>
      <Text size={1} color="default2">{label}</Text>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Text size={4} fontWeight="bold" color={color as any}>{value}</Text>
    </Box>
  );
}

export default IndexPage;
