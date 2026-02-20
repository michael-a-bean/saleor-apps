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
  const [scanningSet, setScanningSet] = useState<string | null>(null);

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

  const scanQuery = trpcClient.sets.scan.useQuery(
    { setCode: scanningSet ?? "" },
    { enabled: !!scanningSet }
  );

  const handleImportSet = (setCode: string) => {
    createMutation.mutate({
      type: "SET",
      setCode,
      priority: 2,
    });
  };

  const handleBackfill = (setCode: string) => {
    createMutation.mutate({
      type: "BACKFILL",
      setCode,
      priority: 2,
    });
    setScanningSet(null);
  };

  return (
    <Box>
      <Box marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Sets
        </Text>
      </Box>

      {/* Scan Results Panel */}
      {scanningSet && (
        <Box marginBottom={6}>
          <Layout.AppSection
            heading={
              scanQuery.data
                ? `Scan: ${scanQuery.data.setName}`
                : `Scanning ${scanningSet.toUpperCase()}...`
            }
            sideContent={
              <Box display="flex" gap={2}>
                {scanQuery.data &&
                  (scanQuery.data.missingCount > 0 || scanQuery.data.failedCount > 0) && (
                    <Button
                      variant="primary"
                      size="small"
                      onClick={() => handleBackfill(scanningSet)}
                      disabled={createMutation.isLoading}
                    >
                      Backfill {scanQuery.data.missingCount + scanQuery.data.failedCount} Cards
                    </Button>
                  )}
                <Button variant="secondary" size="small" onClick={() => setScanningSet(null)}>
                  Close
                </Button>
              </Box>
            }
          >
            <Layout.AppSectionCard>
              {scanQuery.isLoading && (
                <Box padding={4}>
                  <Text>Scanning Scryfall data... this may take a moment.</Text>
                </Box>
              )}
              {scanQuery.error && (
                <Box padding={4}>
                  <Text color="critical1">{scanQuery.error.message}</Text>
                </Box>
              )}
              {scanQuery.data && (
                <>
                  <Box display="flex" gap={6} padding={4} flexWrap="wrap">
                    <StatBox label="Scryfall Cards" value={String(scanQuery.data.scryfallTotal)} />
                    <StatBox label="Imported" value={String(scanQuery.data.importedCount)} />
                    <StatBox
                      label="Missing"
                      value={String(scanQuery.data.missingCount)}
                      color={scanQuery.data.missingCount > 0 ? "critical1" : "success1"}
                    />
                    <StatBox
                      label="Failed"
                      value={String(scanQuery.data.failedCount)}
                      color={scanQuery.data.failedCount > 0 ? "critical1" : "success1"}
                    />
                  </Box>

                  {scanQuery.data.missingCount === 0 && scanQuery.data.failedCount === 0 && (
                    <Box padding={4} paddingTop={0}>
                      <Text color="success1">All cards imported successfully.</Text>
                    </Box>
                  )}

                  {scanQuery.data.missingCards.length > 0 && (
                    <Box padding={4} paddingTop={0}>
                      <Text as="p" fontWeight="bold" marginBottom={2}>
                        Missing Cards ({scanQuery.data.missingCards.length})
                      </Text>
                      <Box
                        as="table"
                        width="100%"
                        __fontSize="13px"
                      >
                        <Box as="thead">
                          <Box as="tr">
                            <Box as="th" padding={1} textAlign="left">
                              <Text size={1} fontWeight="bold">#</Text>
                            </Box>
                            <Box as="th" padding={1} textAlign="left">
                              <Text size={1} fontWeight="bold">Name</Text>
                            </Box>
                            <Box as="th" padding={1} textAlign="left">
                              <Text size={1} fontWeight="bold">Rarity</Text>
                            </Box>
                          </Box>
                        </Box>
                        <Box as="tbody">
                          {scanQuery.data.missingCards.map((card) => (
                            <Box as="tr" key={card.scryfallId}>
                              <Box as="td" padding={1}>
                                <Text size={1}>{card.collectorNumber}</Text>
                              </Box>
                              <Box as="td" padding={1}>
                                <Text size={1}>{card.name}</Text>
                              </Box>
                              <Box as="td" padding={1}>
                                <Text size={1}>{card.rarity}</Text>
                              </Box>
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    </Box>
                  )}

                  {scanQuery.data.failedCards.length > 0 && (
                    <Box padding={4} paddingTop={0}>
                      <Text as="p" fontWeight="bold" marginBottom={2}>
                        Failed Cards ({scanQuery.data.failedCards.length})
                      </Text>
                      <Box
                        as="table"
                        width="100%"
                        __fontSize="13px"
                      >
                        <Box as="thead">
                          <Box as="tr">
                            <Box as="th" padding={1} textAlign="left">
                              <Text size={1} fontWeight="bold">#</Text>
                            </Box>
                            <Box as="th" padding={1} textAlign="left">
                              <Text size={1} fontWeight="bold">Name</Text>
                            </Box>
                            <Box as="th" padding={1} textAlign="left">
                              <Text size={1} fontWeight="bold">Error</Text>
                            </Box>
                          </Box>
                        </Box>
                        <Box as="tbody">
                          {scanQuery.data.failedCards.map((card) => (
                            <Box as="tr" key={card.scryfallId}>
                              <Box as="td" padding={1}>
                                <Text size={1}>{card.collectorNumber}</Text>
                              </Box>
                              <Box as="td" padding={1}>
                                <Text size={1}>{card.name}</Text>
                              </Box>
                              <Box as="td" padding={1}>
                                <Text size={1} color="critical1">
                                  {card.errorMessage ?? "Unknown error"}
                                </Text>
                              </Box>
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    </Box>
                  )}
                </>
              )}
            </Layout.AppSectionCard>
          </Layout.AppSection>
        </Box>
      )}

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
            Verify to check counts, or Scan to find missing cards.
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
                            <>
                              <Button
                                size="small"
                                variant="tertiary"
                                onClick={() => {
                                  setVerifyingSet(null);
                                  setScanningSet(set.code);
                                }}
                                disabled={scanningSet === set.code && scanQuery.isLoading}
                              >
                                {scanningSet === set.code && scanQuery.isLoading
                                  ? "Scanning..."
                                  : "Scan"}
                              </Button>
                              <Button
                                size="small"
                                variant="tertiary"
                                onClick={() => {
                                  setScanningSet(null);
                                  setVerifyingSet(set.code);
                                }}
                              >
                                Verify
                              </Button>
                            </>
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
