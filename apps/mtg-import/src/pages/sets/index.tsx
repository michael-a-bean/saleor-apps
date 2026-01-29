import { Box, Text, Input } from "@saleor/macaw-ui";
import { NextPage } from "next";
import Link from "next/link";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

const SetsPage: NextPage = () => {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: sets, isLoading } = trpcClient.scryfall.getSets.useQuery();

  const filteredSets = sets?.filter(
    (set) =>
      set.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      set.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Box>
      <Text as="h1" size={10} fontWeight="bold" marginBottom={6}>
        Sets
      </Text>

      {/* Search */}
      <Box marginBottom={6} style={{ maxWidth: "400px" }}>
        <Input
          label="Search sets"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name or code..."
        />
      </Box>

      {/* Sets List */}
      {isLoading ? (
        <Text>Loading sets from Scryfall...</Text>
      ) : !filteredSets || filteredSets.length === 0 ? (
        <Text color="default2">No sets found</Text>
      ) : (
        <Box display="flex" flexDirection="column" gap={2}>
          {filteredSets.slice(0, 100).map((set) => (
            <Link key={set.id} href={`/sets/${set.code}`} style={{ textDecoration: "none" }}>
              <Box
                backgroundColor="default1"
                padding={4}
                borderRadius={2}
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                cursor="pointer"
              >
                <Box display="flex" gap={4} alignItems="center">
                  {set.icon_svg_uri && (
                    <img
                      src={set.icon_svg_uri}
                      alt={set.name}
                      style={{ width: "24px", height: "24px" }}
                    />
                  )}
                  <Box>
                    <Text fontWeight="bold">{set.name}</Text>
                    <Text size={2} color="default2">
                      {set.code.toUpperCase()} • {set.set_type}
                    </Text>
                  </Box>
                </Box>
                <Box textAlign="right">
                  <Text size={4} fontWeight="bold">
                    {set.card_count}
                  </Text>
                  <Text size={2} color="default2">
                    {set.released_at || "TBD"}
                  </Text>
                </Box>
              </Box>
            </Link>
          ))}
          {filteredSets.length > 100 && (
            <Text textAlign="center" color="default2" marginTop={4}>
              Showing first 100 of {filteredSets.length} sets
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
};

export default SetsPage;
