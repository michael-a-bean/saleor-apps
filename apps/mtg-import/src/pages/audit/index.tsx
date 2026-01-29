import { Box, Text, Button, Input } from "@saleor/macaw-ui";
import { NextPage } from "next";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/router";

import { trpcClient } from "@/modules/trpc/trpc-client";

const AuditPage: NextPage = () => {
  const router = useRouter();
  const [setCode, setSetCode] = useState("");

  const { data: summary } = trpcClient.audit.summary.useQuery();
  const { data: audits, isLoading, refetch } = trpcClient.audit.list.useQuery({
    limit: 50,
  });

  const runAuditMutation = trpcClient.audit.runSetAudit.useMutation({
    onSuccess: (data) => {
      refetch();
      router.push(`/audit/${data.result.setCode}`);
    },
  });

  return (
    <Box>
      <Text as="h1" size={10} fontWeight="bold" marginBottom={6}>
        Audit
      </Text>

      {/* Summary Stats */}
      {summary && (
        <Box display="flex" gap={4} marginBottom={6}>
          <Box backgroundColor="default1" padding={4} borderRadius={2} style={{ flex: 1 }}>
            <Text size={2} color="default2">Completion Rate</Text>
            <Text size={8} fontWeight="bold">{summary.completionRate}%</Text>
          </Box>
          <Box backgroundColor="default1" padding={4} borderRadius={2} style={{ flex: 1 }}>
            <Text size={2} color="default2">Sellable Sets</Text>
            <Text size={8} fontWeight="bold" color="success1">
              {summary.sellableSets}
            </Text>
            <Text size={2} color="default2">of {summary.totalSets}</Text>
          </Box>
          <Box backgroundColor="default1" padding={4} borderRadius={2} style={{ flex: 1 }}>
            <Text size={2} color="default2">Missing Cards</Text>
            <Text size={8} fontWeight="bold" color={summary.totalMissingCards > 0 ? "warning1" : "success1"}>
              {summary.totalMissingCards.toLocaleString()}
            </Text>
          </Box>
        </Box>
      )}

      {/* Run Audit Section */}
      <Box marginBottom={6}>
        <Text size={5} fontWeight="bold" marginBottom={4}>
          Run Set Audit
        </Text>
        <Box backgroundColor="default1" padding={4} borderRadius={2}>
          <Text marginBottom={4}>
            Compare a set's cards in Scryfall against what's imported in Saleor.
            Identifies missing cards, missing variants, and pricing gaps.
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
                  runAuditMutation.mutate({ setCode });
                }
              }}
              disabled={!setCode || runAuditMutation.isLoading}
              variant="primary"
            >
              {runAuditMutation.isLoading ? "Running..." : "Run Audit"}
            </Button>
          </Box>
        </Box>
      </Box>

      {/* Audit History */}
      <Box>
        <Text size={5} fontWeight="bold" marginBottom={4}>
          Audit History
        </Text>
        {isLoading ? (
          <Text>Loading audits...</Text>
        ) : !audits?.audits || audits.audits.length === 0 ? (
          <Box backgroundColor="default1" padding={6} borderRadius={2} textAlign="center">
            <Text color="default2">No audits run yet</Text>
          </Box>
        ) : (
          <Box display="flex" flexDirection="column" gap={2}>
            {audits.audits.map((audit) => {
              const missingCount =
                (audit.scryfallCardCount ?? 0) - (audit.saleorProductCount ?? 0);
              const completionPercent = audit.scryfallCardCount
                ? Math.round((audit.saleorProductCount / audit.scryfallCardCount) * 100)
                : 0;

              return (
                <Link key={audit.id} href={`/audit/${audit.setCode}`} style={{ textDecoration: "none" }}>
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
                        <Text fontWeight="bold">{audit.setName}</Text>
                        <Text size={2} color="default2">
                          ({audit.setCode.toUpperCase()})
                        </Text>
                        {audit.sellableTimestamp && (
                          <Text
                            size={2}
                            paddingX={2}
                            paddingY={1}
                            borderRadius={1}
                            backgroundColor="success1"
                            color="default1"
                          >
                            Sellable
                          </Text>
                        )}
                      </Box>
                      <Text size={2} color="default2" marginTop={1}>
                        Audited: {new Date(audit.auditedAt).toLocaleString()}
                      </Text>
                    </Box>
                    <Box textAlign="right">
                      <Text size={4} fontWeight="bold" color={completionPercent === 100 ? "success1" : undefined}>
                        {completionPercent}%
                      </Text>
                      <Text size={2} color="default2">
                        {audit.saleorProductCount} / {audit.scryfallCardCount}
                        {missingCount > 0 && (
                          <Text size={2} color="warning1"> ({missingCount} missing)</Text>
                        )}
                      </Text>
                    </Box>
                  </Box>
                </Link>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default AuditPage;
