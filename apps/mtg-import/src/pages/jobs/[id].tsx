import { JobStatus } from "@prisma/client";
import { Box, Text, Button } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";

import { trpcClient } from "@/modules/trpc/trpc-client";

const statusColors: Record<JobStatus, string> = {
  PENDING: "warning1",
  RUNNING: "info1",
  COMPLETED: "success1",
  FAILED: "critical1",
  CANCELLED: "default2",
};

const JobDetailPage: NextPage = () => {
  const router = useRouter();
  const { id } = router.query;

  const { data: job, isLoading, refetch } = trpcClient.jobs.getById.useQuery(
    { id: id as string },
    { enabled: !!id, refetchInterval: 5000 }
  );

  const { data: logs } = trpcClient.jobs.getLogs.useQuery(
    { id: id as string, limit: 100 },
    { enabled: !!id, refetchInterval: 5000 }
  );

  const cancelMutation = trpcClient.jobs.cancel.useMutation({
    onSuccess: () => refetch(),
  });

  if (!id) return null;

  if (isLoading) {
    return <Text>Loading job details...</Text>;
  }

  if (!job) {
    return <Text color="critical1">Job not found</Text>;
  }

  const progressPercent = job.totalItems
    ? Math.round((job.progress / job.totalItems) * 100)
    : 0;

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Box>
          <Text as="h1" size={10} fontWeight="bold">
            Job Details
          </Text>
          <Text size={3} color="default2">
            {job.id}
          </Text>
        </Box>
        <Box display="flex" gap={2}>
          <Button onClick={() => refetch()} variant="secondary">
            Refresh
          </Button>
          {(job.status === JobStatus.PENDING || job.status === JobStatus.RUNNING) && (
            <Button
              onClick={() => cancelMutation.mutate({ id: job.id })}
              variant="secondary"
              disabled={cancelMutation.isLoading}
            >
              Cancel
            </Button>
          )}
        </Box>
      </Box>

      {/* Job Info */}
      <Box display="flex" gap={6} marginBottom={6}>
        <Box backgroundColor="default1" padding={4} borderRadius={2} style={{ flex: 1 }}>
          <Text size={2} color="default2" marginBottom={2}>Type</Text>
          <Text size={5} fontWeight="bold">{job.jobType.replace(/_/g, " ")}</Text>
        </Box>
        <Box backgroundColor="default1" padding={4} borderRadius={2} style={{ flex: 1 }}>
          <Text size={2} color="default2" marginBottom={2}>Status</Text>
          <Text
            size={5}
            fontWeight="bold"
            color={statusColors[job.status] as never}
          >
            {job.status}
          </Text>
        </Box>
        <Box backgroundColor="default1" padding={4} borderRadius={2} style={{ flex: 1 }}>
          <Text size={2} color="default2" marginBottom={2}>Priority</Text>
          <Text size={5} fontWeight="bold">{job.priority}</Text>
        </Box>
      </Box>

      {/* Progress */}
      <Box backgroundColor="default1" padding={4} borderRadius={2} marginBottom={6}>
        <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={2}>
          <Text size={2} color="default2">Progress</Text>
          <Text size={4} fontWeight="bold">{progressPercent}%</Text>
        </Box>
        <Box
          backgroundColor="default2"
          borderRadius={1}
          overflow="hidden"
          style={{ height: "8px" }}
        >
          <Box
            backgroundColor={job.status === JobStatus.FAILED ? "critical1" : "success1"}
            style={{ height: "100%", width: `${progressPercent}%`, transition: "width 0.3s ease" }}
          />
        </Box>
        <Text size={2} color="default2" marginTop={2}>
          {job.progress.toLocaleString()} / {(job.totalItems ?? 0).toLocaleString()} items processed
        </Text>
      </Box>

      {/* Timestamps */}
      <Box display="flex" gap={4} marginBottom={6}>
        <Box style={{ flex: 1 }}>
          <Text size={2} color="default2">Created</Text>
          <Text>{new Date(job.createdAt).toLocaleString()}</Text>
        </Box>
        {job.startedAt && (
          <Box style={{ flex: 1 }}>
            <Text size={2} color="default2">Started</Text>
            <Text>{new Date(job.startedAt).toLocaleString()}</Text>
          </Box>
        )}
        {job.completedAt && (
          <Box style={{ flex: 1 }}>
            <Text size={2} color="default2">Completed</Text>
            <Text>{new Date(job.completedAt).toLocaleString()}</Text>
          </Box>
        )}
      </Box>

      {/* Error */}
      {job.error && (
        <Box
          backgroundColor="critical2"
          padding={4}
          borderRadius={2}
          marginBottom={6}
        >
          <Text size={2} color="critical1" marginBottom={2}>Error</Text>
          <Text color="critical1" style={{ whiteSpace: "pre-wrap" }}>
            {job.error}
          </Text>
        </Box>
      )}

      {/* Config */}
      {job.config && Object.keys(job.config).length > 0 && (
        <Box marginBottom={6}>
          <Text size={5} fontWeight="bold" marginBottom={4}>Configuration</Text>
          <Box backgroundColor="default1" padding={4} borderRadius={2}>
            <Box
              as="pre"
              style={{ fontFamily: "monospace", whiteSpace: "pre-wrap", margin: 0, fontSize: "12px" }}
            >
              {JSON.stringify(job.config, null, 2)}
            </Box>
          </Box>
        </Box>
      )}

      {/* Logs */}
      {logs && logs.logs.length > 0 && (
        <Box>
          <Text size={5} fontWeight="bold" marginBottom={4}>Recent Logs</Text>
          <Box
            backgroundColor="default1"
            padding={4}
            borderRadius={2}
            style={{ maxHeight: "400px", overflowY: "auto" }}
          >
            {logs.logs.map((log, index) => (
              <Box
                key={index}
                paddingY={1}
                borderBottomWidth={1}
                borderBottomStyle="solid"
                borderColor="default2"
              >
                <Box display="flex" gap={2} alignItems="baseline">
                  <Text size={2} color="default2" style={{ fontFamily: "monospace" }}>
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </Text>
                  <Text
                    size={2}
                    color={
                      log.level === "error" ? "critical1" :
                      log.level === "warn" ? "warning1" : "default2"
                    }
                    fontWeight="bold"
                  >
                    [{log.level.toUpperCase()}]
                  </Text>
                  <Text size={2}>{log.message}</Text>
                </Box>
                {log.data && (
                  <Text size={2} color="default2" marginLeft={4} style={{ fontFamily: "monospace" }}>
                    {JSON.stringify(log.data)}
                  </Text>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default JobDetailPage;
