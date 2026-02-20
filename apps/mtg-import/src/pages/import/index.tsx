import { Layout } from "@saleor/apps-ui";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";

import { trpcClient } from "@/modules/trpc/trpc-client";
import type { ImportJob } from "@/types/import-types";

const statusColors = {
  PENDING: "default2",
  RUNNING: "info1",
  COMPLETED: "success1",
  FAILED: "critical1",
  CANCELLED: "default1",
} as const;

type StatusColorKey = keyof typeof statusColors;

const ImportJobsPage: NextPage = () => {
  const router = useRouter();
  const utils = trpcClient.useUtils();
  const { data, isLoading, error } = trpcClient.jobs.list.useQuery({}, {
    refetchInterval: 5000,
  });

  const cancelMutation = trpcClient.jobs.cancel.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });

  const retryMutation = trpcClient.jobs.retry.useMutation({
    onSuccess: () => utils.jobs.list.invalidate(),
  });

  if (error) {
    return (
      <Box>
        <Text color="critical1">Error: {error.message}</Text>
      </Box>
    );
  }

  // Cast needed: generated Prisma client is from older schema; field names differ at type level
  const jobs = (data?.jobs ?? []) as unknown as ImportJob[];

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Import Jobs
        </Text>
        <Button onClick={() => router.push("/import/new")}>New Import</Button>
      </Box>

      <Layout.AppSection
        heading="Job Queue"
        sideContent={
          <Text>
            Import jobs process in priority order. Cancel running jobs or retry failed ones.
            List auto-refreshes every 5 seconds.
          </Text>
        }
      >
        {isLoading ? (
          <Text>Loading...</Text>
        ) : jobs.length === 0 ? (
          <Layout.AppSectionCard>
            <Box padding={6} display="flex" flexDirection="column" alignItems="center" gap={4}>
              <Text>No import jobs yet.</Text>
              <Button onClick={() => router.push("/import/new")}>Start your first import</Button>
            </Box>
          </Layout.AppSectionCard>
        ) : (
          <Layout.AppSectionCard>
            <Box as="table" width="100%">
              <Box as="thead">
                <Box as="tr">
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Type</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Set</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Status</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="right">
                    <Text fontWeight="bold">Progress</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="right">
                    <Text fontWeight="bold">Skipped</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="right">
                    <Text fontWeight="bold">Errors</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="right">
                    <Text fontWeight="bold">Actions</Text>
                  </Box>
                </Box>
              </Box>
              <Box as="tbody">
                {jobs.map((job) => (
                  <Box
                    as="tr"
                    key={job.id}
                    cursor="pointer"
                    onClick={() => router.push(`/import/${job.id}`)}
                  >
                    <Box as="td" padding={2}>
                      <Text>{job.type}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{job.setCode?.toUpperCase() ?? "All"}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Box
                        as="span"
                        paddingX={2}
                        paddingY={1}
                        borderRadius={2}
                        backgroundColor={statusColors[job.status as StatusColorKey] ?? "default1"}
                      >
                        <Text size={1}>{job.status}</Text>
                      </Box>
                    </Box>
                    <Box as="td" padding={2} textAlign="right">
                      <Text>
                        {job.cardsProcessed}
                        {job.cardsTotal > 0 ? ` / ${job.cardsTotal}` : ""}
                      </Text>
                      {job.status === "RUNNING" && job.cardsTotal > 0 && (
                        <Box marginTop={1}>
                          <Box
                            __width="100%"
                            __height="4px"
                            backgroundColor="default2"
                            borderRadius={2}
                            overflow="hidden"
                          >
                            <Box
                              __width={`${Math.round((job.cardsProcessed / job.cardsTotal) * 100)}%`}
                              __height="100%"
                              backgroundColor="info1"
                            />
                          </Box>
                        </Box>
                      )}
                    </Box>
                    <Box as="td" padding={2} textAlign="right">
                      <Text color={job.skipped > 0 ? "default2" : undefined}>
                        {job.skipped > 0 ? job.skipped : "—"}
                      </Text>
                    </Box>
                    <Box as="td" padding={2} textAlign="right">
                      <Text color={job.errors > 0 ? "critical1" : undefined}>
                        {job.errors}
                      </Text>
                    </Box>
                    <Box as="td" padding={2} textAlign="right">
                      <Box display="flex" gap={2} justifyContent="flex-end" onClick={(e) => e.stopPropagation()}>
                        {(job.status === "RUNNING" || job.status === "PENDING") && (
                          <Button
                            size="small"
                            variant="secondary"
                            onClick={() => cancelMutation.mutate({ id: job.id })}
                          >
                            Cancel
                          </Button>
                        )}
                        {(job.status === "FAILED" || job.status === "CANCELLED") && (
                          <Button
                            size="small"
                            variant="secondary"
                            onClick={() => retryMutation.mutate({ id: job.id })}
                          >
                            Retry
                          </Button>
                        )}
                      </Box>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Layout.AppSectionCard>
        )}
      </Layout.AppSection>
    </Box>
  );
};

export default ImportJobsPage;
