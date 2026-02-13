import { Layout } from "@saleor/apps-ui";
import { Box, Button, Input, Select, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const NewImportPage: NextPage = () => {
  const router = useRouter();
  const [importType, setImportType] = useState<"SET" | "BULK" | "BACKFILL">("SET");
  const [setCode, setSetCode] = useState("");
  const [priority, setPriority] = useState(2);

  const createMutation = trpcClient.jobs.create.useMutation({
    onSuccess: (job) => {
      router.push(`/import/${job.id}`);
    },
  });

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
                <Input
                  label="Set Code"
                  value={setCode}
                  onChange={(e) => setSetCode(e.target.value)}
                  placeholder="e.g., mkm, dsk, fdn"
                />
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
              <Button onClick={handleSubmit} disabled={createMutation.isLoading}>
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
