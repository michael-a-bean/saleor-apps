import { Layout } from "@saleor/apps-ui";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";

const NewPurchaseOrderPage: NextPage = () => {
  const router = useRouter();

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Create Purchase Order
        </Text>
        <Button variant="secondary" onClick={() => router.push("/purchase-orders")}>
          Back
        </Button>
      </Box>

      <Layout.AppSection
        heading="New Purchase Order"
        sideContent={
          <Box display="flex" flexDirection="column" gap={2}>
            <Text>Create a new purchase order for a supplier.</Text>
          </Box>
        }
      >
        <Layout.AppSectionCard>
          <Box padding={6} display="flex" flexDirection="column" alignItems="center" gap={4}>
            <Text size={6} color="default2">
              Coming soon - Phase 3 implementation
            </Text>
            <Text>
              This page will allow you to create purchase orders with supplier selection, warehouse
              assignment, and line items.
            </Text>
          </Box>
        </Layout.AppSectionCard>
      </Layout.AppSection>
    </Box>
  );
};

export default NewPurchaseOrderPage;
