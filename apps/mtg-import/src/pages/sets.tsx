import { Layout } from "@saleor/apps-ui";
import { Box, Button, Input, Select, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { useState, useMemo } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";
import type { SetAudit } from "@/types/import-types";

const SET_TYPE_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "core", label: "Core" },
  { value: "expansion", label: "Expansion" },
  { value: "masters", label: "Masters" },
  { value: "commander", label: "Commander" },
  { value: "draft_innovation", label: "Draft Innovation" },
  { value: "starter", label: "Starter" },
  { value: "funny", label: "Funny" },
];

const DISPLAY_LIMIT = 50;

const SetsPage: NextPage = () => {
  const router = useRouter();
  const { data: sets, isLoading } = trpcClient.sets.list.useQuery();
  const { data: importStatus } = trpcClient.sets.importStatus.useQuery();
  const [verifyingSet, setVerifyingSet] = useState<string | null>(null);
  const [scanningSet, setScanningSet] = useState<string | null>(null);
  const [auditingSet, setAuditingSet] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [displayLimit, setDisplayLimit] = useState(DISPLAY_LIMIT);
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Cast needed: generated Prisma client is from older schema; field names differ at type level
  const importedSets = new Map(
    ((importStatus ?? []) as unknown as SetAudit[]).map((audit) => [audit.setCode, audit])
  );

  const createMutation = trpcClient.jobs.create.useMutation({
    onSuccess: (job) => router.push(`/import/${job.id}`),
  });

  const batchMutation = trpcClient.jobs.createBatch.useMutation({
    onSuccess: () => {
      router.push("/import");
    },
  });

  const verifyQuery = trpcClient.sets.verify.useQuery(
    { setCode: verifyingSet ?? "" },
    { enabled: !!verifyingSet }
  );

  const scanQuery = trpcClient.sets.scan.useQuery(
    { setCode: scanningSet ?? "" },
    { enabled: !!scanningSet }
  );

  const auditQuery = trpcClient.sets.auditAttributes.useQuery(
    { setCode: auditingSet ?? "" },
    { enabled: !!auditingSet }
  );

  const repairMutation = trpcClient.sets.repairAttributes.useMutation({
    onSuccess: () => {
      // Re-trigger audit to refresh data
      setAuditingSet(null);
    },
  });

  // Filter and search sets
  const filteredSets = useMemo(() => {
    if (!sets) return [];
    let result = sets;

    // Filter by set type
    if (filterType !== "all") {
      result = result.filter((s) => s.set_type === filterType);
    }

    // Filter by search query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.code.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q)
      );
    }

    return result;
  }, [sets, searchQuery, filterType]);

  const displayedSets = filteredSets.slice(0, displayLimit);
  const totalSetsCount = sets?.length ?? 0;

  // Find incomplete sets for batch backfill
  const incompleteSets = useMemo(() => {
    if (!sets) return [];
    return sets.filter((s) => {
      const audit = importedSets.get(s.code);
      if (!audit) return false;
      const completeness = audit.totalCards > 0
        ? Math.round((audit.importedCards / audit.totalCards) * 100)
        : 0;
      return completeness < 100;
    });
  }, [sets, importedSets]);

  const handleImportSet = (setCode: string, cardCount: number) => {
    if (cardCount > 500) {
      setConfirmDialog({
        message: `Import ${setCode.toUpperCase()} (${cardCount} cards)? This may take a few minutes.`,
        onConfirm: () => {
          createMutation.mutate({ type: "SET", setCode, priority: 2 });
          setConfirmDialog(null);
        },
      });
    } else {
      createMutation.mutate({ type: "SET", setCode, priority: 2 });
    }
  };

  const handleBackfill = (setCode: string) => {
    createMutation.mutate({
      type: "BACKFILL",
      setCode,
      priority: 2,
    });
    setScanningSet(null);
  };

  const handleBackfillAllIncomplete = () => {
    const setCodes = incompleteSets.map((s) => s.code);
    setConfirmDialog({
      message: `Create backfill jobs for ${setCodes.length} incomplete set(s)? This will queue imports for all missing cards.`,
      onConfirm: () => {
        batchMutation.mutate({ setCodes, priority: 2 });
        setConfirmDialog(null);
      },
    });
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Sets
        </Text>
        {incompleteSets.length > 0 && (
          <Button
            variant="secondary"
            onClick={handleBackfillAllIncomplete}
            disabled={batchMutation.isLoading}
          >
            {batchMutation.isLoading
              ? "Creating jobs..."
              : `Backfill All Incomplete (${incompleteSets.length})`}
          </Button>
        )}
      </Box>

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <Box
          position="fixed"
          __top="0"
          __left="0"
          __width="100vw"
          __height="100vh"
          __zIndex="100"
          display="flex"
          alignItems="center"
          justifyContent="center"
        >
          <Box
            __position="absolute"
            __top="0"
            __left="0"
            __width="100%"
            __height="100%"
            __backgroundColor="rgba(0,0,0,0.4)"
            onClick={() => setConfirmDialog(null)}
          />
          <Box
            __position="relative"
            __zIndex="101"
            __maxWidth="480px"
            __width="90%"
            backgroundColor="default1"
            borderRadius={4}
            padding={6}
            __boxShadow="0 8px 32px rgba(0,0,0,0.2)"
          >
            <Text as="h2" size={6} fontWeight="bold" marginBottom={4}>
              Confirm Import
            </Text>
            <Text marginBottom={6}>{confirmDialog.message}</Text>
            <Box display="flex" gap={3} justifyContent="flex-end">
              <Button variant="secondary" onClick={() => setConfirmDialog(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={confirmDialog.onConfirm}>
                Confirm
              </Button>
            </Box>
          </Box>
        </Box>
      )}

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
                    <CardTable
                      title={`Missing Cards (${scanQuery.data.missingCards.length})`}
                      cards={scanQuery.data.missingCards}
                      showError={false}
                    />
                  )}

                  {scanQuery.data.failedCards.length > 0 && (
                    <CardTable
                      title={`Failed Cards (${scanQuery.data.failedCards.length})`}
                      cards={scanQuery.data.failedCards}
                      showError={true}
                    />
                  )}
                </>
              )}
            </Layout.AppSectionCard>
          </Layout.AppSection>
        </Box>
      )}

      {/* Verification Detail Panel */}
      {verifyingSet && (
        <Box marginBottom={6}>
          <Layout.AppSection
            heading={
              verifyQuery.data
                ? `Verification: ${verifyQuery.data.setName}`
                : `Verifying ${verifyingSet.toUpperCase()}...`
            }
            sideContent={
              <Button variant="secondary" size="small" onClick={() => setVerifyingSet(null)}>
                Close
              </Button>
            }
          >
            <Layout.AppSectionCard>
              {verifyQuery.isLoading && (
                <Box padding={4}>
                  <Text>Loading verification data...</Text>
                </Box>
              )}
              {verifyQuery.error && (
                <Box padding={4}>
                  <Text color="critical1">{verifyQuery.error.message}</Text>
                </Box>
              )}
              {verifyQuery.data && (
                <>
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
                </>
              )}
            </Layout.AppSectionCard>
          </Layout.AppSection>
        </Box>
      )}

      {/* Attribute Audit Panel */}
      {auditingSet && (
        <Box marginBottom={6}>
          <Layout.AppSection
            heading={
              auditQuery.data
                ? `Attribute Audit: ${auditingSet.toUpperCase()}`
                : `Auditing ${auditingSet.toUpperCase()}...`
            }
            sideContent={
              <Box display="flex" gap={2}>
                {auditQuery.data && auditQuery.data.summary.totalIssues > 0 && (
                  <Button
                    variant="primary"
                    size="small"
                    onClick={() => repairMutation.mutate({ setCode: auditingSet })}
                    disabled={repairMutation.isLoading}
                  >
                    {repairMutation.isLoading ? "Repairing..." : `Repair All (${auditQuery.data.summary.totalIssues})`}
                  </Button>
                )}
                <Button variant="secondary" size="small" onClick={() => setAuditingSet(null)}>
                  Close
                </Button>
              </Box>
            }
          >
            <Layout.AppSectionCard>
              {auditQuery.isLoading && (
                <Box padding={4}>
                  <Text>Auditing product attributes... this may take a moment.</Text>
                </Box>
              )}
              {auditQuery.error && (
                <Box padding={4}>
                  <Text color="critical1">{auditQuery.error.message}</Text>
                </Box>
              )}
              {repairMutation.data && (
                <Box padding={4}>
                  <Text color="success1">
                    Repair complete: {repairMutation.data.repaired} repaired, {repairMutation.data.failed} failed
                  </Text>
                </Box>
              )}
              {auditQuery.data && (
                <>
                  <Box display="flex" gap={6} padding={4} flexWrap="wrap">
                    <StatBox label="Products Audited" value={String(auditQuery.data.productsAudited)} />
                    <StatBox
                      label="Missing Attributes"
                      value={String(auditQuery.data.summary.productsMissingAttributes)}
                      color={auditQuery.data.summary.productsMissingAttributes > 0 ? "critical1" : "success1"}
                    />
                    <StatBox
                      label="Stale Attributes"
                      value={String(auditQuery.data.summary.productsStaleAttributes)}
                      color={auditQuery.data.summary.productsStaleAttributes > 0 ? "critical1" : "success1"}
                    />
                    <StatBox
                      label="Stale Images"
                      value={String(auditQuery.data.summary.productsStaleImages)}
                      color={auditQuery.data.summary.productsStaleImages > 0 ? "critical1" : "success1"}
                    />
                  </Box>
                  {auditQuery.data.summary.totalIssues === 0 && (
                    <Box padding={4} paddingTop={0}>
                      <Text color="success1">All product attributes are up to date.</Text>
                    </Box>
                  )}
                  {auditQuery.data.attributeIssues.length > 0 && (
                    <Box padding={4} paddingTop={0}>
                      <Text as="p" fontWeight="bold" marginBottom={2}>
                        Products with Issues ({auditQuery.data.attributeIssues.length})
                      </Text>
                      <Box as="table" width="100%" __fontSize="13px">
                        <Box as="thead">
                          <Box as="tr">
                            <Box as="th" padding={1} textAlign="left">
                              <Text size={1} fontWeight="bold">Name</Text>
                            </Box>
                            <Box as="th" padding={1} textAlign="right">
                              <Text size={1} fontWeight="bold">Missing</Text>
                            </Box>
                            <Box as="th" padding={1} textAlign="right">
                              <Text size={1} fontWeight="bold">Stale</Text>
                            </Box>
                            <Box as="th" padding={1} textAlign="center">
                              <Text size={1} fontWeight="bold">Image</Text>
                            </Box>
                          </Box>
                        </Box>
                        <Box as="tbody">
                          {auditQuery.data.attributeIssues.slice(0, 50).map((issue) => (
                            <Box as="tr" key={issue.saleorProductId}>
                              <Box as="td" padding={1}>
                                <Text size={1}>{issue.cardName}</Text>
                              </Box>
                              <Box as="td" padding={1} textAlign="right">
                                <Text size={1} color={issue.missingAttributes.length > 0 ? "critical1" : undefined}>
                                  {issue.missingAttributes.length}
                                </Text>
                              </Box>
                              <Box as="td" padding={1} textAlign="right">
                                <Text size={1} color={issue.staleAttributes.length > 0 ? "critical1" : undefined}>
                                  {issue.staleAttributes.length}
                                </Text>
                              </Box>
                              <Box as="td" padding={1} textAlign="center">
                                <Text size={1} color={issue.imageStale ? "critical1" : "success1"}>
                                  {issue.imageStale ? "Stale" : "OK"}
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

      {/* Search and Filter Controls */}
      <Layout.AppSection
        heading="Available Sets"
        sideContent={
          <Text>
            Browse MTG sets from Scryfall. Import, Verify, Scan for missing cards, or Audit attributes.
          </Text>
        }
      >
        <Box display="flex" gap={4} marginBottom={4}>
          <Box __flex="1">
            <Input
              label="Search sets..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setDisplayLimit(DISPLAY_LIMIT);
              }}
              placeholder="Type set name or code..."
            />
          </Box>
          <Box __width="200px">
            <Select
              label="Set Type"
              value={filterType}
              onChange={(value) => {
                setFilterType(value as string);
                setDisplayLimit(DISPLAY_LIMIT);
              }}
              options={SET_TYPE_OPTIONS}
            />
          </Box>
        </Box>

        {isLoading ? (
          <Layout.AppSectionCard>
            <Box padding={6} display="flex" justifyContent="center">
              <Text>Loading sets from Scryfall...</Text>
            </Box>
          </Layout.AppSectionCard>
        ) : !sets || sets.length === 0 ? (
          <Layout.AppSectionCard>
            <Box padding={6} display="flex" justifyContent="center">
              <Text color="default2">No importable sets found. Check your connection to Scryfall.</Text>
            </Box>
          </Layout.AppSectionCard>
        ) : filteredSets.length === 0 ? (
          <Layout.AppSectionCard>
            <Box padding={6} display="flex" justifyContent="center">
              <Text color="default2">No sets match your search.</Text>
            </Box>
          </Layout.AppSectionCard>
        ) : (
          <>
            <Box marginBottom={2}>
              <Text size={1} color="default2">
                Showing {displayedSets.length} of {filteredSets.length} sets
                {filteredSets.length !== totalSetsCount && ` (${totalSetsCount} total)`}
              </Text>
            </Box>
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
                      <Text fontWeight="bold">Actions</Text>
                    </Box>
                  </Box>
                </Box>
                <Box as="tbody">
                  {displayedSets.map((set) => {
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
                          <Box display="flex" gap={2} justifyContent="flex-end" flexWrap="wrap">
                            <Button
                              size="small"
                              variant="tertiary"
                              onClick={() => {
                                setVerifyingSet(null);
                                setAuditingSet(null);
                                setScanningSet(set.code);
                              }}
                              disabled={scanningSet === set.code && scanQuery.isLoading}
                            >
                              {scanningSet === set.code && scanQuery.isLoading
                                ? "Scanning..."
                                : "Scan"}
                            </Button>
                            {audit && (
                              <>
                                <Button
                                  size="small"
                                  variant="tertiary"
                                  onClick={() => {
                                    setScanningSet(null);
                                    setAuditingSet(null);
                                    setVerifyingSet(set.code);
                                  }}
                                >
                                  Verify
                                </Button>
                                <Button
                                  size="small"
                                  variant="tertiary"
                                  onClick={() => {
                                    setScanningSet(null);
                                    setVerifyingSet(null);
                                    setAuditingSet(set.code);
                                  }}
                                  disabled={auditingSet === set.code && auditQuery.isLoading}
                                >
                                  {auditingSet === set.code && auditQuery.isLoading
                                    ? "Auditing..."
                                    : "Audit"}
                                </Button>
                              </>
                            )}
                            <Button
                              size="small"
                              variant={audit ? "secondary" : "primary"}
                              onClick={() => handleImportSet(set.code, set.card_count)}
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

            {displayedSets.length < filteredSets.length && (
              <Box display="flex" justifyContent="center" marginTop={4}>
                <Button
                  variant="secondary"
                  onClick={() => setDisplayLimit((prev) => prev + DISPLAY_LIMIT)}
                >
                  Show More ({filteredSets.length - displayedSets.length} remaining)
                </Button>
              </Box>
            )}
          </>
        )}
      </Layout.AppSection>
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

function CardTable({
  title,
  cards,
  showError,
}: {
  title: string;
  cards: Array<{ scryfallId: string; collectorNumber: string; name: string; rarity?: string; errorMessage?: string | null }>;
  showError: boolean;
}) {
  return (
    <Box padding={4} paddingTop={0}>
      <Text as="p" fontWeight="bold" marginBottom={2}>
        {title}
      </Text>
      <Box as="table" width="100%" __fontSize="13px">
        <Box as="thead">
          <Box as="tr">
            <Box as="th" padding={1} textAlign="left">
              <Text size={1} fontWeight="bold">#</Text>
            </Box>
            <Box as="th" padding={1} textAlign="left">
              <Text size={1} fontWeight="bold">Name</Text>
            </Box>
            <Box as="th" padding={1} textAlign="left">
              <Text size={1} fontWeight="bold">{showError ? "Error" : "Rarity"}</Text>
            </Box>
          </Box>
        </Box>
        <Box as="tbody">
          {cards.map((card) => (
            <Box as="tr" key={card.scryfallId}>
              <Box as="td" padding={1}>
                <Text size={1}>{card.collectorNumber}</Text>
              </Box>
              <Box as="td" padding={1}>
                <Text size={1}>{card.name}</Text>
              </Box>
              <Box as="td" padding={1}>
                {showError ? (
                  <Text size={1} color="critical1">{card.errorMessage ?? "Unknown error"}</Text>
                ) : (
                  <Text size={1}>{card.rarity}</Text>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

export default SetsPage;
