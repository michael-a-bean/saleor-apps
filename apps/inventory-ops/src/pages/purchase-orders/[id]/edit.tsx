import { Layout } from "@saleor/apps-ui";
import { Box, Button, Input, Select, Text, Textarea } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";
import { VariantSearchModal } from "@/ui/components/variant-search-modal";

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
}

const formatCurrency = (amount: number | string, currency: string) => {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(num);
};

const EditPurchaseOrderPage = () => {
  const router = useRouter();
  const { id } = router.query;
  const utils = trpcClient.useUtils();

  const [formData, setFormData] = useState<FormData>({
    supplierId: "",
    saleorWarehouseId: "",
    expectedDeliveryAt: "",
    externalReference: "",
    notes: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [showVariantModal, setShowVariantModal] = useState(false);
  const [lineToDelete, setLineToDelete] = useState<string | null>(null);

  // Fetch the PO
  const {
    data: po,
    isLoading,
    error,
  } = trpcClient.purchaseOrders.getById.useQuery({ id: id as string }, { enabled: !!id });

  // Fetch suppliers and warehouses for dropdowns
  const { data: suppliersData } = trpcClient.suppliers.list.useQuery({
    isActive: true,
    limit: 100,
  });
  const { data: warehouses } = trpcClient.purchaseOrders.getWarehouses.useQuery();

  // Mutations
  const updateMutation = trpcClient.purchaseOrders.update.useMutation({
    onSuccess: () => {
      utils.purchaseOrders.getById.invalidate({ id: id as string });
    },
  });

  const addLineMutation = trpcClient.purchaseOrders.addLine.useMutation({
    onSuccess: () => {
      utils.purchaseOrders.getById.invalidate({ id: id as string });
    },
  });

  const removeLineMutation = trpcClient.purchaseOrders.removeLine.useMutation({
    onSuccess: () => {
      utils.purchaseOrders.getById.invalidate({ id: id as string });
      setLineToDelete(null);
    },
  });

  // Populate form when PO data loads
  useEffect(() => {
    if (po) {
      setFormData({
        supplierId: po.supplierId,
        saleorWarehouseId: po.saleorWarehouseId,
        expectedDeliveryAt: po.expectedDeliveryAt
          ? new Date(po.expectedDeliveryAt).toISOString().slice(0, 10)
          : "",
        externalReference: po.externalReference || "",
        notes: po.notes || "",
      });
    }
  }, [po]);

  const handleChange =
    (field: keyof FormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFormData((prev) => ({ ...prev, [field]: e.target.value }));
      if (errors[field as keyof FormErrors]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    };

  const handleSaveHeader = () => {
    const newErrors: FormErrors = {};

    if (!formData.supplierId) newErrors.supplierId = "Supplier is required";
    if (!formData.saleorWarehouseId) newErrors.saleorWarehouseId = "Warehouse is required";
    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      updateMutation.mutate({
        id: id as string,
        data: {
          supplierId: formData.supplierId,
          saleorWarehouseId: formData.saleorWarehouseId,
          expectedDeliveryAt: formData.expectedDeliveryAt
            ? new Date(formData.expectedDeliveryAt).toISOString()
            : null,
          externalReference: formData.externalReference.trim() || null,
          notes: formData.notes.trim() || null,
        },
      });
    }
  };

  const handleAddLine = (params: {
    variant: {
      id: string;
      sku: string | null;
      name: string;
      product: { name: string };
    };
    qty: number;
    unitCost: number;
    currency: string;
  }) => {
    addLineMutation.mutate({
      purchaseOrderId: id as string,
      line: {
        saleorVariantId: params.variant.id,
        saleorVariantSku: params.variant.sku,
        saleorVariantName: `${params.variant.product.name} - ${params.variant.name}`,
        qtyOrdered: params.qty,
        expectedUnitCost: params.unitCost,
        currency: params.currency,
      },
    });
  };

  const handleDeleteLine = (lineId: string) => {
    removeLineMutation.mutate({ lineId });
  };

  // Format options
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

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" padding={10}>
        <Text>Loading...</Text>
      </Box>
    );
  }

  if (error || !po) {
    return (
      <Box>
        <Text color="critical1">Error: {error?.message || "Purchase order not found"}</Text>
        <Button onClick={() => router.push("/purchase-orders")} marginTop={4}>
          Back to Purchase Orders
        </Button>
      </Box>
    );
  }

  // Only allow editing DRAFT orders
  if (po.status !== "DRAFT") {
    return (
      <Box>
        <Text color="critical1">
          This purchase order is in {po.status} status and cannot be edited.
        </Text>
        <Button onClick={() => router.push(`/purchase-orders/${po.id}`)} marginTop={4}>
          View Order
        </Button>
      </Box>
    );
  }

  const totalValue = po.lines.reduce((sum, line) => {
    return sum + line.qtyOrdered * parseFloat(line.expectedUnitCost.toString());
  }, 0);
  const currency = po.lines[0]?.currency || "USD";

  return (
    <Box>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" marginBottom={6}>
        <Box display="flex" alignItems="center" gap={4}>
          <Text as="h1" size={10} fontWeight="bold">
            Edit {po.orderNumber}
          </Text>
          <Box paddingX={3} paddingY={1} borderRadius={4} style={{ backgroundColor: "#6B7280" }}>
            <Text size={2} color="buttonDefaultPrimary">
              Draft
            </Text>
          </Box>
        </Box>
        <Box display="flex" gap={2}>
          <Button variant="secondary" onClick={() => router.push(`/purchase-orders/${po.id}`)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => router.push(`/purchase-orders/${po.id}`)}
            disabled={po.lines.length === 0}
          >
            Done Editing
          </Button>
        </Box>
      </Box>

      {/* Order Details */}
      <Layout.AppSection
        heading="Order Details"
        sideContent={
          <Box display="flex" flexDirection="column" gap={2}>
            <Text>Update the supplier and delivery information.</Text>
          </Box>
        }
      >
        <Layout.AppSectionCard>
          <Box display="flex" flexDirection="column" gap={4} padding={4}>
            <Box display="flex" gap={4}>
              <Box __flex="1">
                <Text size={2} fontWeight="bold" marginBottom={1}>
                  Supplier *
                </Text>
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
                {errors.supplierId && (
                  <Text size={1} color="critical1" marginTop={1}>
                    {errors.supplierId}
                  </Text>
                )}
              </Box>
              <Box __flex="1">
                <Text size={2} fontWeight="bold" marginBottom={1}>
                  Warehouse *
                </Text>
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
                {errors.saleorWarehouseId && (
                  <Text size={1} color="critical1" marginTop={1}>
                    {errors.saleorWarehouseId}
                  </Text>
                )}
              </Box>
            </Box>

            <Box display="flex" gap={4}>
              <Box __flex="1">
                <Input
                  label="Expected Delivery Date"
                  type="date"
                  value={formData.expectedDeliveryAt}
                  onChange={handleChange("expectedDeliveryAt")}
                />
              </Box>
              <Box __flex="1">
                <Input
                  label="External Reference"
                  value={formData.externalReference}
                  onChange={handleChange("externalReference")}
                  placeholder="e.g., Invoice #"
                />
              </Box>
            </Box>

            <Textarea
              label="Notes"
              value={formData.notes}
              onChange={handleChange("notes")}
              rows={3}
            />

            <Box display="flex" justifyContent="flex-end">
              <Button
                variant="secondary"
                onClick={handleSaveHeader}
                disabled={updateMutation.isLoading}
              >
                {updateMutation.isLoading ? "Saving..." : "Save Details"}
              </Button>
            </Box>

            {updateMutation.error && (
              <Text color="critical1">Error: {updateMutation.error.message}</Text>
            )}
            {updateMutation.isSuccess && (
              <Text color="success1">Details saved successfully</Text>
            )}
          </Box>
        </Layout.AppSectionCard>
      </Layout.AppSection>

      {/* Line Items */}
      <Layout.AppSection
        heading="Line Items"
        sideContent={
          <Box display="flex" flexDirection="column" gap={2}>
            <Text>{po.lines.length} item(s)</Text>
            <Text fontWeight="bold">{formatCurrency(totalValue, currency)}</Text>
          </Box>
        }
      >
        <Layout.AppSectionCard>
          <Box padding={4}>
            <Box display="flex" justifyContent="flex-end" marginBottom={4}>
              <Button variant="primary" onClick={() => setShowVariantModal(true)}>
                Add Item
              </Button>
            </Box>

            {po.lines.length === 0 ? (
              <Box
                padding={6}
                display="flex"
                flexDirection="column"
                alignItems="center"
                gap={4}
                style={{ backgroundColor: "#f9fafb", borderRadius: "4px" }}
              >
                <Text color="default2">No line items yet. Add products to this order.</Text>
                <Button variant="primary" onClick={() => setShowVariantModal(true)}>
                  Add First Item
                </Button>
              </Box>
            ) : (
              <Box as="table" width="100%">
                <Box as="thead">
                  <Box as="tr" style={{ backgroundColor: "#f9fafb" }}>
                    <Box as="th" padding={3} textAlign="left">
                      <Text fontWeight="bold" size={2}>
                        #
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="left">
                      <Text fontWeight="bold" size={2}>
                        SKU
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="left">
                      <Text fontWeight="bold" size={2}>
                        Product
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="right">
                      <Text fontWeight="bold" size={2}>
                        Qty
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="right">
                      <Text fontWeight="bold" size={2}>
                        Unit Cost
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="right">
                      <Text fontWeight="bold" size={2}>
                        Total
                      </Text>
                    </Box>
                    <Box as="th" padding={3} textAlign="center">
                      <Text fontWeight="bold" size={2}>
                        Actions
                      </Text>
                    </Box>
                  </Box>
                </Box>
                <Box as="tbody">
                  {po.lines.map((line) => (
                    <Box as="tr" key={line.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <Box as="td" padding={3}>
                        <Text>{line.lineNumber}</Text>
                      </Box>
                      <Box as="td" padding={3}>
                        <Text size={2} style={{ fontFamily: "monospace" }}>
                          {line.saleorVariantSku || "-"}
                        </Text>
                      </Box>
                      <Box as="td" padding={3}>
                        <Text>{line.saleorVariantName || "Unknown"}</Text>
                      </Box>
                      <Box as="td" padding={3} textAlign="right">
                        <Text>{line.qtyOrdered}</Text>
                      </Box>
                      <Box as="td" padding={3} textAlign="right">
                        <Text>{formatCurrency(line.expectedUnitCost, line.currency)}</Text>
                      </Box>
                      <Box as="td" padding={3} textAlign="right">
                        <Text fontWeight="bold">
                          {formatCurrency(
                            line.qtyOrdered * parseFloat(line.expectedUnitCost.toString()),
                            line.currency
                          )}
                        </Text>
                      </Box>
                      <Box as="td" padding={3} textAlign="center">
                        <Button
                          variant="tertiary"
                          size="small"
                          onClick={() => setLineToDelete(line.id)}
                        >
                          Remove
                        </Button>
                      </Box>
                    </Box>
                  ))}
                </Box>
                <Box as="tfoot">
                  <Box as="tr" style={{ backgroundColor: "#f9fafb" }}>
                    <Box as="td" colSpan={5} padding={3} textAlign="right">
                      <Text fontWeight="bold">Total:</Text>
                    </Box>
                    <Box as="td" padding={3} textAlign="right">
                      <Text fontWeight="bold" size={5}>
                        {formatCurrency(totalValue, currency)}
                      </Text>
                    </Box>
                    <Box as="td" />
                  </Box>
                </Box>
              </Box>
            )}

            {addLineMutation.error && (
              <Box marginTop={4}>
                <Text color="critical1">Error adding line: {addLineMutation.error.message}</Text>
              </Box>
            )}
          </Box>
        </Layout.AppSectionCard>
      </Layout.AppSection>

      {/* Variant Search Modal */}
      <VariantSearchModal
        isOpen={showVariantModal}
        onClose={() => setShowVariantModal(false)}
        onSelect={handleAddLine}
        defaultCurrency={currency}
      />

      {/* Delete Line Confirmation Modal */}
      {lineToDelete && (
        <Box
          position="fixed"
          inset={0}
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
              Remove Line Item?
            </Text>
            <Text marginBottom={4}>
              Are you sure you want to remove this line item from the purchase order?
            </Text>
            <Box display="flex" justifyContent="flex-end" gap={2}>
              <Button variant="secondary" onClick={() => setLineToDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="error"
                onClick={() => handleDeleteLine(lineToDelete)}
                disabled={removeLineMutation.isLoading}
              >
                {removeLineMutation.isLoading ? "Removing..." : "Remove"}
              </Button>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default EditPurchaseOrderPage;
