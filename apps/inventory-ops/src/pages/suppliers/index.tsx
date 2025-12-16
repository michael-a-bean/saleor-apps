import { Layout } from "@saleor/apps-ui";
import { Box, Button, Input, Select, Text } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

type StatusFilter = "all" | "active" | "inactive";

const SuppliersPageContent = () => {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data, isLoading, error } = trpcClient.suppliers.list.useQuery({
    query: searchQuery || undefined,
    isActive: statusFilter === "all" ? undefined : statusFilter === "active",
  });

  if (error) {
    return (
      <Box>
        <Text color="critical1">Error loading suppliers: {error.message}</Text>
      </Box>
    );
  }

  const suppliers = data?.suppliers || [];

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Suppliers
        </Text>
        <Button onClick={() => router.push("/suppliers/new")}>Add Supplier</Button>
      </Box>

      <Layout.AppSection
        heading="All Suppliers"
        sideContent={
          <Box display="flex" flexDirection="column" gap={2}>
            <Text>
              Manage your supplier list. Suppliers are vendors from whom you purchase inventory.
            </Text>
            {data && (
              <Text size={2} color="default2">
                {data.total} supplier(s) total
              </Text>
            )}
          </Box>
        }
      >
        {/* Search and Filter */}
        <Box display="flex" gap={4} marginBottom={4}>
          <Box __flex="2">
            <Input
              label="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by code, name, or email..."
              size="small"
            />
          </Box>
          <Box __flex="1">
            <Select
              label="Status"
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as StatusFilter)}
              options={[
                { value: "all", label: "All" },
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ]}
              size="small"
            />
          </Box>
        </Box>

        {isLoading ? (
          <Layout.AppSectionCard>
            <Box padding={6} display="flex" justifyContent="center">
              <Text>Loading...</Text>
            </Box>
          </Layout.AppSectionCard>
        ) : suppliers.length === 0 ? (
          <Layout.AppSectionCard>
            <Box padding={6} display="flex" flexDirection="column" alignItems="center" gap={4}>
              {searchQuery || statusFilter !== "all" ? (
                <>
                  <Text>No suppliers found matching your criteria.</Text>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearchQuery("");
                      setStatusFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                </>
              ) : (
                <>
                  <Text>No suppliers yet.</Text>
                  <Button onClick={() => router.push("/suppliers/new")}>
                    Add your first supplier
                  </Button>
                </>
              )}
            </Box>
          </Layout.AppSectionCard>
        ) : (
          <Layout.AppSectionCard>
            <Box as="table" width="100%">
              <Box as="thead">
                <Box as="tr" borderBottomStyle="solid" borderBottomWidth={1} borderColor="default1">
                  <Box as="th" padding={3} textAlign="left">
                    <Text fontWeight="bold" size={2}>
                      Code
                    </Text>
                  </Box>
                  <Box as="th" padding={3} textAlign="left">
                    <Text fontWeight="bold" size={2}>
                      Name
                    </Text>
                  </Box>
                  <Box as="th" padding={3} textAlign="left">
                    <Text fontWeight="bold" size={2}>
                      Contact
                    </Text>
                  </Box>
                  <Box as="th" padding={3} textAlign="left">
                    <Text fontWeight="bold" size={2}>
                      Status
                    </Text>
                  </Box>
                </Box>
              </Box>
              <Box as="tbody">
                {suppliers.map((supplier) => (
                  <Box
                    as="tr"
                    key={supplier.id}
                    cursor="pointer"
                    onClick={() => router.push(`/suppliers/${supplier.id}`)}
                    borderBottomStyle="solid"
                    borderBottomWidth={1}
                    borderColor="default1"
                    style={{ cursor: "pointer" }}
                    className="supplier-row"
                  >
                    <Box as="td" padding={3}>
                      <Text fontWeight="medium">{supplier.code}</Text>
                    </Box>
                    <Box as="td" padding={3}>
                      <Text>{supplier.name}</Text>
                    </Box>
                    <Box as="td" padding={3}>
                      <Text color="default2">{supplier.contactEmail || "-"}</Text>
                    </Box>
                    <Box as="td" padding={3}>
                      <Box
                        display="inline-block"
                        paddingX={2}
                        paddingY={1}
                        borderRadius={2}
                        backgroundColor={supplier.isActive ? "success1" : "default2"}
                      >
                        <Text size={1} color={supplier.isActive ? "success1" : "default2"}>
                          {supplier.isActive ? "Active" : "Inactive"}
                        </Text>
                      </Box>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
            {data?.hasMore && (
              <Box padding={4} display="flex" justifyContent="center">
                <Text size={2} color="default2">
                  Showing {suppliers.length} of {data.total} suppliers
                </Text>
              </Box>
            )}
          </Layout.AppSectionCard>
        )}
      </Layout.AppSection>
    </Box>
  );
};

export default SuppliersPageContent;
