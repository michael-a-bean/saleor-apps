import { Layout } from "@saleor/apps-ui";
import { Box, Button, Input, Text, Textarea } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

interface FormData {
  code: string;
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  notes: string;
}

interface FormErrors {
  code?: string;
  name?: string;
  contactEmail?: string;
}

const NewSupplierPageContent = () => {
  const router = useRouter();
  const utils = trpcClient.useUtils();

  const [formData, setFormData] = useState<FormData>({
    code: "",
    name: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    address: "",
    notes: "",
  });

  const [errors, setErrors] = useState<FormErrors>({});

  const createMutation = trpcClient.suppliers.create.useMutation({
    onSuccess: () => {
      utils.suppliers.list.invalidate();
      router.push("/suppliers");
    },
    onError: (error) => {
      if (error.message.includes("already exists")) {
        setErrors({ code: error.message });
      }
    },
  });

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.code.trim()) {
      newErrors.code = "Code is required";
    } else if (!/^[A-Za-z0-9-_]+$/.test(formData.code)) {
      newErrors.code = "Code must be alphanumeric (hyphens and underscores allowed)";
    }

    if (!formData.name.trim()) {
      newErrors.name = "Name is required";
    }

    if (formData.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.contactEmail)) {
      newErrors.contactEmail = "Invalid email format";
    }

    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    createMutation.mutate({
      code: formData.code.trim().toUpperCase(),
      name: formData.name.trim(),
      contactName: formData.contactName.trim() || null,
      contactEmail: formData.contactEmail.trim() || null,
      contactPhone: formData.contactPhone.trim() || null,
      address: formData.address.trim() || null,
      notes: formData.notes.trim() || null,
    });
  };

  const handleChange = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));
    // Clear error when user starts typing
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Create Supplier
        </Text>
        <Button variant="secondary" onClick={() => router.push("/suppliers")}>
          Cancel
        </Button>
      </Box>

      <form onSubmit={handleSubmit}>
        <Layout.AppSection
          heading="Supplier Details"
          sideContent={
            <Box display="flex" flexDirection="column" gap={2}>
              <Text>
                Enter the supplier code and name. The code should be a unique identifier (e.g., VENDOR001).
              </Text>
            </Box>
          }
        >
          <Layout.AppSectionCard>
            <Box display="flex" flexDirection="column" gap={4} padding={2}>
              <Box display="flex" gap={4}>
                <Box __flex="1">
                  <Input
                    label="Supplier Code *"
                    value={formData.code}
                    onChange={handleChange("code")}
                    error={!!errors.code}
                    helperText={errors.code}
                    placeholder="e.g., VENDOR001"
                    style={{ textTransform: "uppercase" }}
                  />
                </Box>
                <Box __flex="2">
                  <Input
                    label="Supplier Name *"
                    value={formData.name}
                    onChange={handleChange("name")}
                    error={!!errors.name}
                    helperText={errors.name}
                    placeholder="e.g., Acme Corporation"
                  />
                </Box>
              </Box>
            </Box>
          </Layout.AppSectionCard>
        </Layout.AppSection>

        <Layout.AppSection
          heading="Contact Information"
          sideContent={
            <Box display="flex" flexDirection="column" gap={2}>
              <Text>Optional contact details for this supplier.</Text>
            </Box>
          }
        >
          <Layout.AppSectionCard>
            <Box display="flex" flexDirection="column" gap={4} padding={2}>
              <Input
                label="Contact Name"
                value={formData.contactName}
                onChange={handleChange("contactName")}
                placeholder="e.g., John Smith"
              />
              <Box display="flex" gap={4}>
                <Box __flex="1">
                  <Input
                    label="Email"
                    type="email"
                    value={formData.contactEmail}
                    onChange={handleChange("contactEmail")}
                    error={!!errors.contactEmail}
                    helperText={errors.contactEmail}
                    placeholder="e.g., contact@vendor.com"
                  />
                </Box>
                <Box __flex="1">
                  <Input
                    label="Phone"
                    value={formData.contactPhone}
                    onChange={handleChange("contactPhone")}
                    placeholder="e.g., +1 555-123-4567"
                  />
                </Box>
              </Box>
              <Textarea
                label="Address"
                value={formData.address}
                onChange={handleChange("address")}
                placeholder="Street address, city, state, zip"
                rows={3}
              />
            </Box>
          </Layout.AppSectionCard>
        </Layout.AppSection>

        <Layout.AppSection
          heading="Additional Notes"
          sideContent={
            <Box display="flex" flexDirection="column" gap={2}>
              <Text>Any additional information about this supplier.</Text>
            </Box>
          }
        >
          <Layout.AppSectionCard>
            <Box padding={2}>
              <Textarea
                label="Notes"
                value={formData.notes}
                onChange={handleChange("notes")}
                placeholder="Payment terms, special instructions, etc."
                rows={4}
              />
            </Box>
          </Layout.AppSectionCard>
        </Layout.AppSection>

        <Box display="flex" justifyContent="flex-end" gap={4} marginTop={6}>
          <Button variant="secondary" onClick={() => router.push("/suppliers")} type="button">
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={createMutation.isLoading}>
            {createMutation.isLoading ? "Creating..." : "Create Supplier"}
          </Button>
        </Box>

        {createMutation.error && !errors.code && (
          <Box marginTop={4}>
            <Text color="critical1">Error: {createMutation.error.message}</Text>
          </Box>
        )}
      </form>
    </Box>
  );
};

export default NewSupplierPageContent;
