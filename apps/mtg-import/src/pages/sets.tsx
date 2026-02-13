import { Layout } from "@saleor/apps-ui";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";

import { trpcClient } from "@/modules/trpc/trpc-client";

const SetsPage: NextPage = () => {
  const router = useRouter();
  const { data: sets, isLoading } = trpcClient.sets.list.useQuery();
  const { data: importStatus } = trpcClient.sets.importStatus.useQuery();

  const importedSets = new Map(
    (importStatus ?? []).map((audit) => [audit.setCode, audit])
  );

  const createMutation = trpcClient.jobs.create.useMutation({
    onSuccess: (job) => router.push(`/import/${job.id}`),
  });

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

      <Layout.AppSection
        heading="Available Sets"
        sideContent={
          <Text>
            Browse MTG sets from Scryfall. Click Import to start importing a set.
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
                          <Text size={1} color="success1">
                            {audit.importedCards}/{audit.totalCards} imported
                          </Text>
                        ) : (
                          <Text size={1} color="default2">Not imported</Text>
                        )}
                      </Box>
                      <Box as="td" padding={2} textAlign="right">
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

export default SetsPage;
