import { Layout } from "@saleor/apps-ui";
import { Box, Button, Input, Select, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { useState, useMemo } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const NewImportPage: NextPage = () => {
  const router = useRouter();
  const [importType, setImportType] = useState<"SET" | "BULK" | "BACKFILL">("SET");
  const [setCode, setSetCode] = useState("");
  const [setSearch, setSetSearch] = useState("");
  const [priority, setPriority] = useState(2);
  const [showSetPicker, setShowSetPicker] = useState(false);

  const { data: sets } = trpcClient.sets.list.useQuery(undefined, {
    enabled: importType === "SET",
  });

  const createMutation = trpcClient.jobs.create.useMutation({
    onSuccess: (job) => {
      router.push(`/import/${job.id}`);
    },
  });

  const filteredSets = useMemo(() => {
    if (!sets || !setSearch) return sets?.slice(0, 20) ?? [];
    const q = setSearch.toLowerCase();
    return sets
      .filter(
        (s) =>
          s.code.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [sets, setSearch]);

  const selectedSet = useMemo(
    () => sets?.find((s) => s.code === setCode.toLowerCase()),
    [sets, setCode]
  );

  const handleSelectSet = (code: string) => {
    setSetCode(code);
    setSetSearch("");
    setShowSetPicker(false);
  };

  const handleSubmit = () => {
    createMutation.mutate({
      type: importType,
      setCode: importType === "SET" ? setCode.toLowerCase() : undefined,
      priority,
    });
  };

  return (
    <Box>
      <Box marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          New Import
        </Text>
      </Box>

      <Layout.AppSection
        heading="Import Configuration"
        sideContent={
          <Box display="flex" flexDirection="column" gap={2}>
            <Text>
              <strong>SET:</strong> Import a specific set by code (e.g., &quot;mkm&quot;).
            </Text>
            <Text>
              <strong>BULK:</strong> Import all cards from the Scryfall bulk data file.
            </Text>
            <Text>
              <strong>BACKFILL:</strong> Re-import missing or updated cards.
            </Text>
          </Box>
        }
      >
        <Layout.AppSectionCard>
          <Box display="flex" flexDirection="column" gap={4} padding={4}>
            <Box>
              <Text as="p" fontWeight="bold" marginBottom={2}>
                Import Type
              </Text>
              <Select
                label="Import Type"
                value={importType}
                onChange={(value) => setImportType(value as "SET" | "BULK" | "BACKFILL")}
                options={[
                  { value: "SET", label: "Set Import" },
                  { value: "BULK", label: "Bulk Import" },
                  { value: "BACKFILL", label: "Backfill" },
                ]}
              />
            </Box>

            {importType === "SET" && (
              <Box>
                <Text as="p" fontWeight="bold" marginBottom={2}>
                  Set Code
                </Text>
                {selectedSet ? (
                  <Box
                    display="flex"
                    alignItems="center"
                    gap={3}
                    padding={3}
                    backgroundColor="default1"
                    borderRadius={2}
                  >
                    <Box>
                      <Text fontWeight="bold">
                        {selectedSet.code.toUpperCase()} — {selectedSet.name}
                      </Text>
                      <Text size={1} color="default2">
                        {selectedSet.card_count} cards
                        {selectedSet.released_at ? ` | Released ${selectedSet.released_at}` : ""}
                      </Text>
                    </Box>
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => {
                        setSetCode("");
                        setShowSetPicker(true);
                      }}
                    >
                      Change
                    </Button>
                  </Box>
                ) : (
                  <Box position="relative">
                    <Input
                      label="Search sets..."
                      value={setSearch || setCode}
                      onChange={(e) => {
                        setSetSearch(e.target.value);
                        setSetCode(e.target.value);
                        setShowSetPicker(true);
                      }}
                      onFocus={() => setShowSetPicker(true)}
                      placeholder="Type to search (e.g., lea, modern horizons)"
                    />
                    {showSetPicker && filteredSets.length > 0 && (
                      <Box
                        position="absolute"
                        __zIndex="10"
                        __width="100%"
                        __maxHeight="300px"
                        overflow="auto"
                        backgroundColor="default1"
                        borderRadius={2}
                        __boxShadow="0 4px 12px rgba(0,0,0,0.15)"
                        marginTop={1}
                      >
                        {filteredSets.map((set) => (
                          <Box
                            key={set.id}
                            padding={2}
                            paddingX={3}
                            cursor="pointer"
                            onClick={() => handleSelectSet(set.code)}
                            __transition="background-color 0.1s"
                          >
                            <Text fontWeight="bold" size={2}>
                              {set.code.toUpperCase()}
                            </Text>
                            <Text size={1}> {set.name}</Text>
                            <Text size={1} color="default2">
                              {" "}({set.card_count} cards
                              {set.released_at ? `, ${set.released_at}` : ""})
                            </Text>
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
            )}

            <Box>
              <Text as="p" fontWeight="bold" marginBottom={2}>
                Priority
              </Text>
              <Select
                label="Priority"
                value={String(priority)}
                onChange={(value) => setPriority(Number(value))}
                options={[
                  { value: "0", label: "0 - Prerelease (highest)" },
                  { value: "1", label: "1 - Reprint" },
                  { value: "2", label: "2 - Backfill (lowest)" },
                ]}
              />
            </Box>

            {createMutation.error && (
              <Box padding={3} backgroundColor="critical1" borderRadius={2}>
                <Text>{createMutation.error.message}</Text>
              </Box>
            )}

            <Box display="flex" gap={4}>
              <Button
                onClick={handleSubmit}
                disabled={createMutation.isLoading || (importType === "SET" && !setCode)}
              >
                {createMutation.isLoading ? "Creating..." : "Start Import"}
              </Button>
              <Button variant="secondary" onClick={() => router.push("/import")}>
                Cancel
              </Button>
            </Box>
          </Box>
        </Layout.AppSectionCard>
      </Layout.AppSection>
    </Box>
  );
};

export default NewImportPage;
