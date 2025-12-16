import { Layout } from "@saleor/apps-ui";
import { Box, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";

import { trpcClient } from "@/modules/trpc/trpc-client";

const GoodsReceiptsPage: NextPage = () => {
  const router = useRouter();
  const { data: goodsReceipts, isLoading, error } = trpcClient.goodsReceipts.list.useQuery();

  if (error) {
    return (
      <Box>
        <Text color="critical1">Error loading goods receipts: {error.message}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Goods Receipts
        </Text>
      </Box>

      <Layout.AppSection
        heading="All Goods Receipts"
        sideContent={
          <Box display="flex" flexDirection="column" gap={2}>
            <Text>
              View all goods receipts. Create new receipts from purchase orders to track received
              inventory.
            </Text>
          </Box>
        }
      >
        {isLoading ? (
          <Text>Loading...</Text>
        ) : goodsReceipts?.length === 0 ? (
          <Layout.AppSectionCard>
            <Box padding={6} display="flex" flexDirection="column" alignItems="center" gap={4}>
              <Text>No goods receipts yet.</Text>
              <Text color="default2">
                Create a goods receipt from a purchase order to start receiving inventory.
              </Text>
            </Box>
          </Layout.AppSectionCard>
        ) : (
          <Layout.AppSectionCard>
            <Box as="table" width="100%">
              <Box as="thead">
                <Box as="tr">
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">Receipt #</Text>
                  </Box>
                  <Box as="th" padding={2} textAlign="left">
                    <Text fontWeight="bold">PO #</Text>
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
                {goodsReceipts?.map((gr) => (
                  <Box
                    as="tr"
                    key={gr.id}
                    cursor="pointer"
                    onClick={() => router.push(`/goods-receipts/${gr.id}`)}
                    className="hover-row"
                  >
                    <Box as="td" padding={2}>
                      <Text>{gr.receiptNumber}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{gr.purchaseOrder.orderNumber}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{gr.purchaseOrder.supplier.name}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{gr.status}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{gr._count.lines}</Text>
                    </Box>
                    <Box as="td" padding={2}>
                      <Text>{new Date(gr.createdAt).toLocaleDateString()}</Text>
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

export default GoodsReceiptsPage;
