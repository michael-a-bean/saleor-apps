import { Layout } from "@saleor/apps-ui";
import { Box, Button, Text } from "@saleor/macaw-ui";
import { NextPage } from "next";
import { useRouter } from "next/router";

const NewSupplierPage: NextPage = () => {
  const router = useRouter();

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Create Supplier
        </Text>
        <Button variant="secondary" onClick={() => router.push("/suppliers")}>
          Back
        </Button>
      </Box>

      <Layout.AppSection
        heading="New Supplier"
        sideContent={
          <Box display="flex" flexDirection="column" gap={2}>
            <Text>Add a new supplier to your vendor master data.</Text>
          </Box>
        }
      >
        <Layout.AppSectionCard>
          <Box padding={6} display="flex" flexDirection="column" alignItems="center" gap={4}>
            <Text size={6} color="default2">
              Coming soon - Phase 2 implementation
            </Text>
            <Text>
              This page will allow you to create suppliers with contact information and payment
              terms.
            </Text>
          </Box>
        </Layout.AppSectionCard>
      </Layout.AppSection>
    </Box>
  );
};

export default NewSupplierPage;
