import { Layout } from "@saleor/apps-ui";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";

const NewGoodsReceiptPage: NextPage = () => {
  const router = useRouter();

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Create Goods Receipt
        </Text>
        <Button variant="secondary" onClick={() => router.push("/goods-receipts")}>
          Back
        </Button>
      </Box>

      <Layout.AppSection
        heading="New Goods Receipt"
        sideContent={
          <Box display="flex" flexDirection="column" gap={2}>
            <Text>Record the receipt of goods from a purchase order.</Text>
          </Box>
        }
      >
        <Layout.AppSectionCard>
          <Box padding={6} display="flex" flexDirection="column" alignItems="center" gap={4}>
            <Text size={6} color="default2">
              Coming soon - Phase 4 implementation
            </Text>
            <Text>
              This page will allow you to receive goods against purchase orders, with partial
              receiving support and automatic stock posting to Saleor.
            </Text>
          </Box>
        </Layout.AppSectionCard>
      </Layout.AppSection>
    </Box>
  );
};

export default NewGoodsReceiptPage;
