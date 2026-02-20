import { Layout } from "@saleor/apps-ui";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";

import { trpcClient } from "@/modules/trpc/trpc-client";
import type { ImportJobWithProducts } from "@/types/import-types";

const JobDetailPage: NextPage = () => {
  const router = useRouter();
  const jobId = router.query.id as string;
  const utils = trpcClient.useUtils();

  const { data: job, isLoading, error } = trpcClient.jobs.get.useQuery(
    { id: jobId },
    { enabled: !!jobId, refetchInterval: 3000 }
  );

  const cancelMutation = trpcClient.jobs.cancel.useMutation({
    onSuccess: () => utils.jobs.get.invalidate({ id: jobId }),
  });

  const retryMutation = trpcClient.jobs.retry.useMutation({
    onSuccess: (newJob) => router.push(`/import/${newJob.id}`),
  });

  if (error) {
    return <Text color="critical1">Error: {error.message}</Text>;
  }

  if (isLoading || !job) {
    return <Text>Loading...</Text>;
  }

  // Cast needed: generated Prisma client is from older schema; field names differ at type level
  const j = job as unknown as ImportJobWithProducts;

  const progressPercent = j.cardsTotal > 0
    ? Math.round((j.cardsProcessed / j.cardsTotal) * 100)
    : 0;

  // ETA calculation
  let etaText: string | null = null;
  if (j.status === "RUNNING" && j.startedAt && j.cardsProcessed > 0 && j.cardsTotal > 0) {
    const elapsedMs = Date.now() - new Date(j.startedAt).getTime();
    const cardsPerMs = j.cardsProcessed / elapsedMs;
    const remainingCards = j.cardsTotal - j.cardsProcessed;
    const remainingMs = remainingCards / cardsPerMs;

    if (remainingMs < 60_000) {
      etaText = "< 1 minute remaining";
    } else if (remainingMs < 3_600_000) {
      const mins = Math.ceil(remainingMs / 60_000);
      etaText = `~${mins} minute${mins > 1 ? "s" : ""} remaining`;
    } else {
      const hours = Math.floor(remainingMs / 3_600_000);
      const mins = Math.ceil((remainingMs % 3_600_000) / 60_000);
      etaText = `~${hours}h ${mins}m remaining`;
    }
  }

  const errorLog: string[] = j.errorLog ? JSON.parse(j.errorLog) : [];

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Box>
          <Text
            as="span"
            size={2}
            color="default2"
            cursor="pointer"
            onClick={() => router.push("/import")}
          >
            Import Jobs &gt;{" "}
          </Text>
          <Text as="h1" size={10} fontWeight="bold">
            {j.type} Import {j.setCode ? `(${j.setCode.toUpperCase()})` : ""}
          </Text>
        </Box>
        <Box display="flex" gap={2}>
          {(j.status === "RUNNING" || j.status === "PENDING") && (
            <Button
              variant="secondary"
              onClick={() => cancelMutation.mutate({ id: j.id })}
            >
              Cancel
            </Button>
          )}
          {(j.status === "FAILED" || j.status === "CANCELLED") && (
            <Button onClick={() => retryMutation.mutate({ id: j.id })}>
              Retry
            </Button>
          )}
        </Box>
      </Box>

      {/* Stats */}
      <Layout.AppSection heading="Job Status">
        <Layout.AppSectionCard>
          <Box display="flex" gap={6} padding={4} flexWrap="wrap">
            <StatBox label="Status" value={j.status} />
            <StatBox label="Priority" value={String(j.priority)} />
            <StatBox label="Cards Processed" value={String(j.cardsProcessed)} />
            <StatBox label="Cards Total" value={String(j.cardsTotal || "—")} />
            <StatBox label="Variants Created" value={String(j.variantsCreated)} />
            <StatBox label="Already Existed" value={j.skipped > 0 ? String(j.skipped) : "—"} />
            <StatBox label="Errors" value={String(j.errors)} />
          </Box>

          {/* Progress Bar */}
          {j.status === "RUNNING" && j.cardsTotal > 0 && (
            <Box padding={4} paddingTop={0}>
              <Box display="flex" justifyContent="space-between" marginBottom={1}>
                <Text size={1}>Progress</Text>
                <Box display="flex" gap={3}>
                  {etaText && <Text size={1} color="default2">{etaText}</Text>}
                  <Text size={1}>{progressPercent}%</Text>
                </Box>
              </Box>
              <Box
                __width="100%"
                __height="8px"
                backgroundColor="default2"
                borderRadius={2}
                overflow="hidden"
              >
                <Box
                  __width={`${progressPercent}%`}
                  __height="100%"
                  backgroundColor="info1"
                  __transition="width 0.3s ease"
                />
              </Box>
            </Box>
          )}

          {/* Timestamps */}
          <Box display="flex" gap={6} padding={4} paddingTop={0}>
            <StatBox label="Created" value={formatDate(j.createdAt)} />
            {j.startedAt && <StatBox label="Started" value={formatDate(j.startedAt)} />}
            {j.completedAt && <StatBox label="Completed" value={formatDate(j.completedAt)} />}
          </Box>
        </Layout.AppSectionCard>
      </Layout.AppSection>

      {/* Error Log */}
      {(j.errorMessage || errorLog.length > 0) && (
        <Box marginTop={6}>
          <Layout.AppSection heading="Errors">
            <Layout.AppSectionCard>
              <Box padding={4}>
                {j.errorMessage && (
                  <Box marginBottom={4} padding={3} backgroundColor="critical1" borderRadius={2}>
                    <Text>{j.errorMessage}</Text>
                  </Box>
                )}
                {errorLog.length > 0 && (
                  <Box
                    as="pre"
                    padding={3}
                    backgroundColor="default1"
                    borderRadius={2}
                    style={{ overflow: "auto", maxHeight: "400px", fontSize: "12px", fontFamily: "monospace" }}
                  >
                    {errorLog.map((line, i) => (
                      <Box key={i}>
                        <Text size={1}>{line}</Text>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            </Layout.AppSectionCard>
          </Layout.AppSection>
        </Box>
      )}

      {/* Recent Imports */}
      {j.importedProducts && j.importedProducts.length > 0 && (
        <Box marginTop={6}>
          <Layout.AppSection heading={`Recent Imports (${j._count?.importedProducts ?? 0} total)`}>
            <Layout.AppSectionCard>
              <Box as="table" width="100%">
                <Box as="thead">
                  <Box as="tr">
                    <Box as="th" padding={2} textAlign="left">
                      <Text fontWeight="bold">Card</Text>
                    </Box>
                    <Box as="th" padding={2} textAlign="left">
                      <Text fontWeight="bold">Set</Text>
                    </Box>
                    <Box as="th" padding={2} textAlign="left">
                      <Text fontWeight="bold">Rarity</Text>
                    </Box>
                    <Box as="th" padding={2} textAlign="right">
                      <Text fontWeight="bold">Variants</Text>
                    </Box>
                    <Box as="th" padding={2} textAlign="left">
                      <Text fontWeight="bold">Status</Text>
                    </Box>
                  </Box>
                </Box>
                <Box as="tbody">
                  {j.importedProducts.map((p) => (
                    <Box as="tr" key={p.id}>
                      <Box as="td" padding={2}>
                        <Text>{p.cardName}</Text>
                      </Box>
                      <Box as="td" padding={2}>
                        <Text>{p.setCode.toUpperCase()} #{p.collectorNumber}</Text>
                      </Box>
                      <Box as="td" padding={2}>
                        <Text>{p.rarity}</Text>
                      </Box>
                      <Box as="td" padding={2} textAlign="right">
                        <Text>{p.variantCount}</Text>
                      </Box>
                      <Box as="td" padding={2}>
                        <Text color={p.success ? "success1" : "critical1"}>
                          {p.success ? "OK" : p.errorMessage ?? "Failed"}
                        </Text>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Layout.AppSectionCard>
          </Layout.AppSection>
        </Box>
      )}
    </Box>
  );
};

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Text size={1} color="default2">{label}</Text>
      <Text size={4} fontWeight="bold">{value}</Text>
    </Box>
  );
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleString();
}

export default JobDetailPage;
