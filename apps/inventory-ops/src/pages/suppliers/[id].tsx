import { Layout } from "@saleor/apps-ui";
import { Box, Button, Input, Text, Textarea } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

interface FormData {
  code: string;
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  notes: string;
  isActive: boolean;
}

interface FormErrors {
  code?: string;
  name?: string;
  contactEmail?: string;
}

const SupplierDetailPageContent = () => {
  const router = useRouter();
  const { id } = router.query;
  const utils = trpcClient.useUtils();

  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    code: "",
    name: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    address: "",
    notes: "",
    isActive: true,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);

  const { data: supplier, isLoading, error } = trpcClient.suppliers.getById.useQuery(
    { id: id as string },
    { enabled: !!id }
  );

  const updateMutation = trpcClient.suppliers.update.useMutation({
    onSuccess: () => {
      utils.suppliers.getById.invalidate({ id: id as string });
      utils.suppliers.list.invalidate();
      setIsEditing(false);
    },
    onError: (error) => {
      if (error.message.includes("already exists")) {
        setErrors({ code: error.message });
      }
    },
  });

  const deactivateMutation = trpcClient.suppliers.deactivate.useMutation({
    onSuccess: () => {
      utils.suppliers.getById.invalidate({ id: id as string });
      utils.suppliers.list.invalidate();
      setShowDeactivateConfirm(false);
    },
  });

  const reactivateMutation = trpcClient.suppliers.reactivate.useMutation({
    onSuccess: () => {
      utils.suppliers.getById.invalidate({ id: id as string });
      utils.suppliers.list.invalidate();
    },
  });

  // Populate form when supplier data loads
  useEffect(() => {
    if (supplier) {
      setFormData({
        code: supplier.code,
        name: supplier.name,
        contactName: supplier.contactName || "",
        contactEmail: supplier.contactEmail || "",
        contactPhone: supplier.contactPhone || "",
        address: supplier.address || "",
        notes: supplier.notes || "",
        isActive: supplier.isActive,
      });
    }
  }, [supplier]);

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

    updateMutation.mutate({
      id: id as string,
      data: {
        code: formData.code.trim().toUpperCase(),
        name: formData.name.trim(),
        contactName: formData.contactName.trim() || null,
        contactEmail: formData.contactEmail.trim() || null,
        contactPhone: formData.contactPhone.trim() || null,
        address: formData.address.trim() || null,
        notes: formData.notes.trim() || null,
      },
    });
  };

  const handleChange = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleCancel = () => {
    if (supplier) {
      setFormData({
        code: supplier.code,
        name: supplier.name,
        contactName: supplier.contactName || "",
        contactEmail: supplier.contactEmail || "",
        contactPhone: supplier.contactPhone || "",
        address: supplier.address || "",
        notes: supplier.notes || "",
        isActive: supplier.isActive,
      });
    }
    setErrors({});
    setIsEditing(false);
  };

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" padding={10}>
        <Text>Loading...</Text>
      </Box>
    );
  }

  if (error || !supplier) {
    return (
      <Box>
        <Text color="critical1">Error: {error?.message || "Supplier not found"}</Text>
        <Button onClick={() => router.push("/suppliers")} marginTop={4}>
          Back to Suppliers
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Box display="flex" alignItems="center" gap={4}>
          <Text as="h1" size={10} fontWeight="bold">
            {supplier.name}
          </Text>
          {!supplier.isActive && (
            <Box
              backgroundColor="critical1"
              paddingX={2}
              paddingY={1}
              borderRadius={2}
            >
              <Text size={2} color="buttonDefaultPrimary">
                Inactive
              </Text>
            </Box>
          )}
        </Box>
        <Box display="flex" gap={2}>
          <Button variant="secondary" onClick={() => router.push("/suppliers")}>
            Back
          </Button>
          {!isEditing && (
            <Button variant="primary" onClick={() => setIsEditing(true)}>
              Edit
            </Button>
          )}
        </Box>
      </Box>

      <form onSubmit={handleSubmit}>
        <Layout.AppSection
          heading="Supplier Details"
          sideContent={
            <Box display="flex" flexDirection="column" gap={2}>
              <Text>Code: {supplier.code}</Text>
              {supplier._count && (
                <Text size={2} color="default2">
                  {supplier._count.purchaseOrders} purchase order(s)
                </Text>
              )}
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
                    disabled={!isEditing}
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
                    disabled={!isEditing}
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
              <Text>Contact details for this supplier.</Text>
            </Box>
          }
        >
          <Layout.AppSectionCard>
            <Box display="flex" flexDirection="column" gap={4} padding={2}>
              <Input
                label="Contact Name"
                value={formData.contactName}
                onChange={handleChange("contactName")}
                disabled={!isEditing}
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
                    disabled={!isEditing}
                  />
                </Box>
                <Box __flex="1">
                  <Input
                    label="Phone"
                    value={formData.contactPhone}
                    onChange={handleChange("contactPhone")}
                    disabled={!isEditing}
                  />
                </Box>
              </Box>
              <Textarea
                label="Address"
                value={formData.address}
                onChange={handleChange("address")}
                disabled={!isEditing}
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
                disabled={!isEditing}
                rows={4}
              />
            </Box>
          </Layout.AppSectionCard>
        </Layout.AppSection>

        {isEditing && (
          <Box display="flex" justifyContent="flex-end" gap={4} marginTop={6}>
            <Button variant="secondary" onClick={handleCancel} type="button">
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={updateMutation.isLoading}>
              {updateMutation.isLoading ? "Saving..." : "Save Changes"}
            </Button>
          </Box>
        )}

        {updateMutation.error && !errors.code && (
          <Box marginTop={4}>
            <Text color="critical1">Error: {updateMutation.error.message}</Text>
          </Box>
        )}
      </form>

      {/* Status Actions */}
      <Layout.AppSection
        heading="Status"
        sideContent={
          <Box display="flex" flexDirection="column" gap={2}>
            <Text>Manage supplier status.</Text>
          </Box>
        }
      >
        <Layout.AppSectionCard>
          <Box padding={4} display="flex" justifyContent="space-between" alignItems="center">
            <Box>
              <Text fontWeight="bold">
                Status: {supplier.isActive ? "Active" : "Inactive"}
              </Text>
              <Text size={2} color="default2">
                {supplier.isActive
                  ? "This supplier can be used for new purchase orders."
                  : "This supplier cannot be used for new purchase orders."}
              </Text>
            </Box>
            {supplier.isActive ? (
              <Button
                variant="secondary"
                onClick={() => setShowDeactivateConfirm(true)}
              >
                Deactivate
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => reactivateMutation.mutate({ id: id as string })}
                disabled={reactivateMutation.isLoading}
              >
                {reactivateMutation.isLoading ? "Reactivating..." : "Reactivate"}
              </Button>
            )}
          </Box>
        </Layout.AppSectionCard>
      </Layout.AppSection>

      {/* Deactivate Confirmation Modal */}
      {showDeactivateConfirm && (
        <Box
          position="fixed"
          inset={0}
          backgroundColor="default1"
          display="flex"
          alignItems="center"
          justifyContent="center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1000 }}
        >
          <Box
            backgroundColor="default1"
            padding={6}
            borderRadius={4}
            __maxWidth="400px"
            boxShadow="defaultModal"
          >
            <Text as="h2" size={6} fontWeight="bold" marginBottom={4}>
              Deactivate Supplier?
            </Text>
            <Text marginBottom={4}>
              Are you sure you want to deactivate {supplier.name}? The supplier will no longer be
              available for new purchase orders.
            </Text>
            {supplier._count && supplier._count.purchaseOrders > 0 && (
              <Box
                backgroundColor="warning1"
                padding={3}
                borderRadius={2}
                marginBottom={4}
              >
                <Text size={2}>
                  This supplier has {supplier._count.purchaseOrders} purchase order(s).
                  Existing orders will not be affected.
                </Text>
              </Box>
            )}
            <Box display="flex" justifyContent="flex-end" gap={2}>
              <Button variant="secondary" onClick={() => setShowDeactivateConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="error"
                onClick={() => deactivateMutation.mutate({ id: id as string })}
                disabled={deactivateMutation.isLoading}
              >
                {deactivateMutation.isLoading ? "Deactivating..." : "Deactivate"}
              </Button>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default SupplierDetailPageContent;
