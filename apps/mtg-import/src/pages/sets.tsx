import { Layout } from "@saleor/apps-ui";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const SetsPage: NextPage = () => {
  const router = useRouter();
  const { data: sets, isLoading } = trpcClient.sets.list.useQuery();
  const { data: importStatus } = trpcClient.sets.importStatus.useQuery();
  const [verifyingSet, setVerifyingSet] = useState<string | null>(null);

  const importedSets = new Map(
    (importStatus ?? []).map((audit) => [audit.setCode, audit])
  );

  const createMutation = trpcClient.jobs.create.useMutation({
    onSuccess: (job) => router.push(`/import/${job.id}`),
  });

  const verifyQuery = trpcClient.sets.verify.useQuery(
    { setCode: verifyingSet ?? "" },
    { enabled: !!verifyingSet }
  );

  const handleImportSet = (setCode: string) => {
    createMutation.mutate({
      type: "SET",
      setCode,
      priority: 2,
    });
  };

  return (
    <Box>
      <Box marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Sets
        </Text>
      </Box>

      {/* Verification Detail Panel */}
      {verifyingSet && verifyQuery.data && (
        <Box marginBottom={6}>
          <Layout.AppSection
            heading={`Verification: ${verifyQuery.data.setName}`}
            sideContent={
              <Button variant="secondary" size="small" onClick={() => setVerifyingSet(null)}>
                Close
              </Button>
            }
          >
            <Layout.AppSectionCard>
              <Box display="flex" gap={6} padding={4} flexWrap="wrap">
                <StatBox label="Set" value={verifyQuery.data.setCode.toUpperCase()} />
                <StatBox label="Scryfall Total" value={String(verifyQuery.data.scryfallTotal)} />
                <StatBox label="Imported" value={String(verifyQuery.data.imported)} />
                <StatBox label="Newly Created" value={String(verifyQuery.data.newlyCreated)} />
                <StatBox label="Already Existed" value={String(verifyQuery.data.alreadyExisted)} />
                <StatBox label="Failed" value={String(verifyQuery.data.failed)} />
                <StatBox
                  label="Completeness"
                  value={`${verifyQuery.data.completeness}%`}
                  color={
                    verifyQuery.data.completeness >= 100
                      ? "success1"
                      : verifyQuery.data.completeness >= 80
                      ? "info1"
                      : "critical1"
                  }
                />
              </Box>
              {verifyQuery.data.lastImportedAt && (
                <Box padding={4} paddingTop={0}>
                  <Text size={1} color="default2">
                    Last imported: {new Date(verifyQuery.data.lastImportedAt).toLocaleString()}
                  </Text>
                </Box>
              )}
            </Layout.AppSectionCard>
          </Layout.AppSection>
        </Box>
      )}

      <Layout.AppSection
        heading="Available Sets"
        sideContent={
          <Text>
            Browse MTG sets from Scryfall. Click Import to start importing a set,
            or Verify to check completeness of imported sets.
          </Text>
        }
      >
        {isLoading ? (
          <Text>Loading sets...</Text>
        ) : (
          <Layout.AppSectionCard>
            <Box as="table" width="100%">
              <Box as="thead">
                <Box as="tr">
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Code</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Name</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="right">
                    <Text fontWeight="bold">Cards</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Released</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Status</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="right">
                    <Text fontWeight="bold">Action</Text>
                  </Box>
                </Box>
              </Box>
              <Box as="tbody">
                {(sets ?? []).map((set) => {
                  const audit = importedSets.get(set.code);
                  const completeness = audit && audit.totalCards > 0
                    ? Math.round((audit.importedCards / audit.totalCards) * 100)
                    : null;

                  return (
                    <Box as="tr" key={set.id}>
                      <Box as="td" padding={2}>
                        <Text fontWeight="bold">{set.code.toUpperCase()}</Text>
                      </Box>
                      <Box as="td" padding={2}>
                        <Text>{set.name}</Text>
                      </Box>
                      <Box as="td" padding={2} textAlign="right">
                        <Text>{set.card_count}</Text>
                      </Box>
                      <Box as="td" padding={2}>
                        <Text size={1}>{set.released_at ?? "—"}</Text>
                      </Box>
                      <Box as="td" padding={2}>
                        {audit ? (
                          <Box>
                            <Text
                              size={1}
                              color={completeness !== null && completeness >= 100 ? "success1" : "info1"}
                            >
                              {audit.importedCards}/{audit.totalCards} ({completeness}%)
                            </Text>
                            <Box marginTop={1}>
                              <Box
                                __width="60px"
                                __height="4px"
                                backgroundColor="default2"
                                borderRadius={2}
                                overflow="hidden"
                              >
                                <Box
                                  __width={`${Math.min(completeness ?? 0, 100)}%`}
                                  __height="100%"
                                  backgroundColor={
                                    completeness !== null && completeness >= 100 ? "success1" : "info1"
                                  }
                                />
                              </Box>
                            </Box>
                          </Box>
                        ) : (
                          <Text size={1} color="default2">Not imported</Text>
                        )}
                      </Box>
                      <Box as="td" padding={2} textAlign="right">
                        <Box display="flex" gap={2} justifyContent="flex-end">
                          {audit && (
                            <Button
                              size="small"
                              variant="tertiary"
                              onClick={() => setVerifyingSet(set.code)}
                            >
                              Verify
                            </Button>
                          )}
                          <Button
                            size="small"
                            variant={audit ? "secondary" : "primary"}
                            onClick={() => handleImportSet(set.code)}
                            disabled={createMutation.isLoading}
                          >
                            {audit ? "Re-import" : "Import"}
                          </Button>
                        </Box>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </Layout.AppSectionCard>
        )}
      </Layout.AppSection>
    </Box>
  );
};

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Box>
      <Text size={1} color="default2">{label}</Text>
      <Text size={4} fontWeight="bold" color={color as any}>{value}</Text>
    </Box>
  );
}

export default SetsPage;
