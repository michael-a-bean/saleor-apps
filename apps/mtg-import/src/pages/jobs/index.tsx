import { JobStatus, JobType } from "@prisma/client";
import { Box, Text, Button, Select } from "@saleor/macaw-ui";
import { NextPage } from "next";
import Link from "next/link";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const statusColors: Record<JobStatus, string> = {
  PENDING: "warning1",
  RUNNING: "info1",
  COMPLETED: "success1",
  FAILED: "critical1",
  CANCELLED: "default2",
};

const JobsPage: NextPage = () => {
  const [statusFilter, setStatusFilter] = useState<JobStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<JobType | "all">("all");

  const { data, isLoading, refetch } = trpcClient.jobs.list.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter,
    jobType: typeFilter === "all" ? undefined : typeFilter,
    limit: 50,
  });

  const { data: stats } = trpcClient.jobs.stats.useQuery();

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Jobs
        </Text>
        <Button onClick={() => refetch()} variant="secondary">
          Refresh
        </Button>
      </Box>

      {/* Stats Bar */}
      {stats && (
        <Box display="flex" gap={4} marginBottom={6}>
          <Box>
            <Text size={2} color="default2">Pending</Text>
            <Text size={5} fontWeight="bold">{stats.pending}</Text>
          </Box>
          <Box>
            <Text size={2} color="default2">Running</Text>
            <Text size={5} fontWeight="bold" color="info1">{stats.running}</Text>
          </Box>
          <Box>
            <Text size={2} color="default2">Completed</Text>
            <Text size={5} fontWeight="bold" color="success1">{stats.completed}</Text>
          </Box>
          <Box>
            <Text size={2} color="default2">Failed</Text>
            <Text size={5} fontWeight="bold" color="critical1">{stats.failed}</Text>
          </Box>
        </Box>
      )}

      {/* Filters */}
      <Box display="flex" gap={4} marginBottom={4}>
        <Box style={{ width: "200px" }}>
          <Select
            label="Status"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as JobStatus | "all")}
            options={[
              { value: "all", label: "All Statuses" },
              { value: JobStatus.PENDING, label: "Pending" },
              { value: JobStatus.RUNNING, label: "Running" },
              { value: JobStatus.COMPLETED, label: "Completed" },
              { value: JobStatus.FAILED, label: "Failed" },
              { value: JobStatus.CANCELLED, label: "Cancelled" },
            ]}
          />
        </Box>
        <Box style={{ width: "200px" }}>
          <Select
            label="Type"
            value={typeFilter}
            onChange={(value) => setTypeFilter(value as JobType | "all")}
            options={[
              { value: "all", label: "All Types" },
              { value: JobType.BULK_IMPORT, label: "Bulk Import" },
              { value: JobType.NEW_SET, label: "New Set" },
              { value: JobType.ATTRIBUTE_ENRICHMENT, label: "Enrichment" },
              { value: JobType.AUDIT, label: "Audit" },
              { value: JobType.REMEDIATION, label: "Remediation" },
            ]}
          />
        </Box>
      </Box>

      {/* Jobs List */}
      {isLoading ? (
        <Text>Loading jobs...</Text>
      ) : !data?.jobs || data.jobs.length === 0 ? (
        <Box backgroundColor="default1" padding={6} borderRadius={2} textAlign="center">
          <Text color="default2">No jobs found</Text>
        </Box>
      ) : (
        <Box display="flex" flexDirection="column" gap={2}>
          {data.jobs.map((job) => (
            <Link key={job.id} href={`/jobs/${job.id}`} style={{ textDecoration: "none" }}>
              <Box
                backgroundColor="default1"
                padding={4}
                borderRadius={2}
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                cursor="pointer"
              >
                <Box>
                  <Box display="flex" gap={2} alignItems="center">
                    <Text fontWeight="bold">{job.jobType.replace(/_/g, " ")}</Text>
                    <Text
                      size={2}
                      paddingX={2}
                      paddingY={1}
                      borderRadius={1}
                      backgroundColor={statusColors[job.status] as any}
                      color="default1"
                    >
                      {job.status}
                    </Text>
                  </Box>
                  <Text size={2} color="default2" marginTop={1}>
                    Created: {new Date(job.createdAt).toLocaleString()}
                    {job.completedAt && ` | Completed: ${new Date(job.completedAt).toLocaleString()}`}
                  </Text>
                </Box>
                <Box textAlign="right">
                  {job.totalItems ? (
                    <>
                      <Text size={4} fontWeight="bold">
                        {Math.round((job.progress / job.totalItems) * 100)}%
                      </Text>
                      <Text size={2} color="default2">
                        {job.progress.toLocaleString()} / {job.totalItems.toLocaleString()}
                      </Text>
                    </>
                  ) : (
                    <Text size={2} color="default2">
                      {job.progress.toLocaleString()} processed
                    </Text>
                  )}
                </Box>
              </Box>
            </Link>
          ))}
        </Box>
      )}

      {data && data.total > data.jobs.length && (
        <Box marginTop={4} textAlign="center">
          <Text color="default2">
            Showing {data.jobs.length} of {data.total} jobs
          </Text>
        </Box>
      )}
    </Box>
  );
};

export default JobsPage;
