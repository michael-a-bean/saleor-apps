import { Layout } from "@saleor/apps-ui";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";

import { trpcClient } from "@/modules/trpc/trpc-client";

const SuppliersPage: NextPage = () => {
  const router = useRouter();
  const { data: suppliers, isLoading, error } = trpcClient.suppliers.list.useQuery();

  if (error) {
    return (
      <Box>
        <Text color="critical1">Error loading suppliers: {error.message}</Text>
      </Box>
    );
  }

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
          </Box>
        }
      >
        {isLoading ? (
          <Text>Loading...</Text>
        ) : suppliers?.length === 0 ? (
          <Layout.AppSectionCard>
            <Box padding={6} display="flex" flexDirection="column" alignItems="center" gap={4}>
              <Text>No suppliers yet.</Text>
              <Button onClick={() => router.push("/suppliers/new")}>Add your first supplier</Button>
            </Box>
          </Layout.AppSectionCard>
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
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Contact</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Status</Text>
                  </Box>
                </Box>
              </Box>
              <Box as="tbody">
                {suppliers?.map((supplier) => (
                  <Box
                    as="tr"
                    key={supplier.id}
                    cursor="pointer"
                    onClick={() => router.push(`/suppliers/${supplier.id}`)}
                    className="hover-row"
                  >
                    <Box as="td" padding={2}>
                      <Text>{supplier.code}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{supplier.name}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{supplier.contactEmail || "-"}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{supplier.isActive ? "Active" : "Inactive"}</Text>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Layout.AppSectionCard>
        )}
      </Layout.AppSection>
    </Box>
  );
};

export default SuppliersPage;
