import { Layout } from "@saleor/apps-ui";
import { Box, Button, Input, Select, Text, Textarea } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

interface FormData {
  supplierId: string;
  saleorWarehouseId: string;
  expectedDeliveryAt: string;
  externalReference: string;
  notes: string;
}

interface FormErrors {
  supplierId?: string;
  saleorWarehouseId?: string;
  expectedDeliveryAt?: string;
}

const NewPurchaseOrderPage = () => {
  const router = useRouter();
  const utils = trpcClient.useUtils();

  const [formData, setFormData] = useState<FormData>({
    supplierId: "",
    saleorWarehouseId: "",
    expectedDeliveryAt: "",
    externalReference: "",
    notes: "",
  });

  const [errors, setErrors] = useState<FormErrors>({});

  // Fetch suppliers for dropdown
  const { data: suppliersData, isLoading: suppliersLoading } = trpcClient.suppliers.list.useQuery({
    isActive: true,
    limit: 100,
  });

  // Fetch warehouses from Saleor
  const { data: warehouses, isLoading: warehousesLoading } =
    trpcClient.purchaseOrders.getWarehouses.useQuery();

  const createMutation = trpcClient.purchaseOrders.create.useMutation({
    onSuccess: (newPO) => {
      utils.purchaseOrders.list.invalidate();
      // Redirect to edit page to add lines
      router.push(`/purchase-orders/${newPO.id}/edit`);
    },
    onError: (error) => {
      // Handle specific errors
      if (error.message.includes("Supplier not found")) {
        setErrors({ supplierId: error.message });
      }
    },
  });

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.supplierId) {
      newErrors.supplierId = "Supplier is required";
    }

    if (!formData.saleorWarehouseId) {
      newErrors.saleorWarehouseId = "Warehouse is required";
    }

    if (formData.expectedDeliveryAt) {
      const date = new Date(formData.expectedDeliveryAt);

      if (isNaN(date.getTime())) {
        newErrors.expectedDeliveryAt = "Invalid date";
      }
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
      supplierId: formData.supplierId,
      saleorWarehouseId: formData.saleorWarehouseId,
      expectedDeliveryAt: formData.expectedDeliveryAt
        ? new Date(formData.expectedDeliveryAt).toISOString()
        : null,
      externalReference: formData.externalReference.trim() || null,
      notes: formData.notes.trim() || null,
    });
  };

  const handleChange =
    (field: keyof FormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setFormData((prev) => ({ ...prev, [field]: e.target.value }));
      if (errors[field as keyof FormErrors]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    };

  // Format options for Select components
  const supplierOptions = [
    { value: "", label: "Select a supplier..." },
    ...(suppliersData?.suppliers.map((s) => ({
      value: s.id,
      label: `${s.code} - ${s.name}`,
    })) || []),
  ];

  const warehouseOptions = [
    { value: "", label: "Select a warehouse..." },
    ...(warehouses?.map((w) => ({
      value: w.id,
      label: w.name,
    })) || []),
  ];

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Text as="h1" size={10} fontWeight="bold">
          Create Purchase Order
        </Text>
        <Button variant="secondary" onClick={() => router.push("/purchase-orders")}>
          Cancel
        </Button>
      </Box>

      <form onSubmit={handleSubmit}>
        <Layout.AppSection
          heading="Order Details"
          sideContent={
            <Box display="flex" flexDirection="column" gap={2}>
              <Text>Select a supplier and destination warehouse for this purchase order.</Text>
            </Box>
          }
        >
          <Layout.AppSectionCard>
            <Box display="flex" flexDirection="column" gap={4} padding={4}>
              {/* Supplier Selection */}
              <Box>
                <Text size={2} fontWeight="bold" marginBottom={1}>
                  Supplier *
                </Text>
                {suppliersLoading ? (
                  <Text color="default2">Loading suppliers...</Text>
                ) : suppliersData?.suppliers.length === 0 ? (
                  <Box>
                    <Text color="default2">No suppliers found.</Text>
                    <Button
                      variant="tertiary"
                      onClick={() => router.push("/suppliers/new")}
                      marginTop={2}
                    >
                      Create a supplier first
                    </Button>
                  </Box>
                ) : (
                  <Select
                    value={formData.supplierId}
                    onChange={(value) => {
                      setFormData((prev) => ({ ...prev, supplierId: value as string }));
                      if (errors.supplierId) {
                        setErrors((prev) => ({ ...prev, supplierId: undefined }));
                      }
                    }}
                    options={supplierOptions}
                    error={!!errors.supplierId}
                  />
                )}
                {errors.supplierId && (
                  <Text size={1} color="critical1" marginTop={1}>
                    {errors.supplierId}
                  </Text>
                )}
              </Box>

              {/* Warehouse Selection */}
              <Box>
                <Text size={2} fontWeight="bold" marginBottom={1}>
                  Destination Warehouse *
                </Text>
                {warehousesLoading ? (
                  <Text color="default2">Loading warehouses...</Text>
                ) : warehouses?.length === 0 ? (
                  <Text color="default2">No warehouses found in Saleor.</Text>
                ) : (
                  <Select
                    value={formData.saleorWarehouseId}
                    onChange={(value) => {
                      setFormData((prev) => ({ ...prev, saleorWarehouseId: value as string }));
                      if (errors.saleorWarehouseId) {
                        setErrors((prev) => ({ ...prev, saleorWarehouseId: undefined }));
                      }
                    }}
                    options={warehouseOptions}
                    error={!!errors.saleorWarehouseId}
                  />
                )}
                {errors.saleorWarehouseId && (
                  <Text size={1} color="critical1" marginTop={1}>
                    {errors.saleorWarehouseId}
                  </Text>
                )}
              </Box>

              {/* Expected Delivery Date */}
              <Box>
                <Input
                  label="Expected Delivery Date"
                  type="date"
                  value={formData.expectedDeliveryAt}
                  onChange={handleChange("expectedDeliveryAt")}
                  error={!!errors.expectedDeliveryAt}
                  helperText={errors.expectedDeliveryAt}
                />
              </Box>

              {/* External Reference */}
              <Box>
                <Input
                  label="External Reference"
                  value={formData.externalReference}
                  onChange={handleChange("externalReference")}
                  placeholder="e.g., Invoice #, Vendor PO #"
                />
              </Box>
            </Box>
          </Layout.AppSectionCard>
        </Layout.AppSection>

        <Layout.AppSection
          heading="Additional Notes"
          sideContent={
            <Box display="flex" flexDirection="column" gap={2}>
              <Text>Any additional information about this order.</Text>
            </Box>
          }
        >
          <Layout.AppSectionCard>
            <Box padding={4}>
              <Textarea
                label="Notes"
                value={formData.notes}
                onChange={handleChange("notes")}
                placeholder="Special instructions, delivery notes, etc."
                rows={4}
              />
            </Box>
          </Layout.AppSectionCard>
        </Layout.AppSection>

        <Box display="flex" justifyContent="flex-end" gap={4} marginTop={6}>
          <Button variant="secondary" onClick={() => router.push("/purchase-orders")} type="button">
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={
              createMutation.isLoading ||
              suppliersLoading ||
              warehousesLoading ||
              !formData.supplierId ||
              !formData.saleorWarehouseId
            }
          >
            {createMutation.isLoading ? "Creating..." : "Create & Add Items"}
          </Button>
        </Box>

        {createMutation.error && !errors.supplierId && (
          <Box marginTop={4}>
            <Text color="critical1">Error: {createMutation.error.message}</Text>
          </Box>
        )}
      </form>
    </Box>
  );
};

export default NewPurchaseOrderPage;
