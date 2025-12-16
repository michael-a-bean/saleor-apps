import { Layout } from "@saleor/apps-ui";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";

import { trpcClient } from "@/modules/trpc/trpc-client";

const PurchaseOrdersPage: NextPage = () => {
  const router = useRouter();
  const { data: purchaseOrders, isLoading, error } = trpcClient.purchaseOrders.list.useQuery();

  if (error) {
    return (
      <Box>
        <Text color="critical1">Error loading purchase orders: {error.message}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Purchase Orders
        </Text>
        <Button onClick={() => router.push("/purchase-orders/new")}>Create PO</Button>
      </Box>

      <Layout.AppSection
        heading="All Purchase Orders"
        sideContent={
          <Box display="flex" flexDirection="column" gap={2}>
            <Text>
              Manage purchase orders for your suppliers. Create POs, track approval status, and
              receive goods.
            </Text>
          </Box>
        }
      >
        {isLoading ? (
          <Text>Loading...</Text>
        ) : purchaseOrders?.length === 0 ? (
          <Layout.AppSectionCard>
            <Box padding={6} display="flex" flexDirection="column" alignItems="center" gap={4}>
              <Text>No purchase orders yet.</Text>
              <Button onClick={() => router.push("/purchase-orders/new")}>
                Create your first PO
              </Button>
            </Box>
          </Layout.AppSectionCard>
        ) : (
          <Layout.AppSectionCard>
            <Box as="table" width="100%">
              <Box as="thead">
                <Box as="tr">
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Order #</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Supplier</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Status</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Lines</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Created</Text>
                  </Box>
                </Box>
              </Box>
              <Box as="tbody">
                {purchaseOrders?.map((po) => (
                  <Box
                    as="tr"
                    key={po.id}
                    cursor="pointer"
                    onClick={() => router.push(`/purchase-orders/${po.id}`)}
                    className="hover-row"
                  >
                    <Box as="td" padding={2}>
                      <Text>{po.orderNumber}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{po.supplier.name}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{po.status}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{po._count.lines}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{new Date(po.createdAt).toLocaleDateString()}</Text>
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

export default PurchaseOrdersPage;
