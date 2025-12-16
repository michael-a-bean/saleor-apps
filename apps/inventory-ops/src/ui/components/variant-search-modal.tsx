import { Box, Button, Input, Text } from "@saleor/macaw-ui";
import { useCallback, useState } from "react";

import { trpcClient } from "@/modules/trpc/trpc-client";

interface VariantSearchResult {
  id: string;
  sku: string | null;
  name: string;
  product: {
    id: string;
    name: string;
    thumbnail: {
      url: string;
    } | null;
  };
  pricing: {
    price: {
      gross: {
        amount: number;
        currency: string;
      };
    } | null;
  } | null;
}

interface VariantSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (params: { variant: VariantSearchResult; qty: number; unitCost: number; currency: string }) => void;
  defaultCurrency?: string;
}

export const VariantSearchModal = ({
  isOpen,
  onClose,
  onSelect,
  defaultCurrency = "USD",
}: VariantSearchModalProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVariant, setSelectedVariant] = useState<VariantSearchResult | null>(null);
  const [qty, setQty] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [errors, setErrors] = useState<{ qty?: string; unitCost?: string }>({});

  const { data: searchResults, isLoading: searching } =
    trpcClient.purchaseOrders.searchVariants.useQuery(
      { query: searchQuery, limit: 20 },
      { enabled: searchQuery.length >= 2 }
    );

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setSelectedVariant(null);
  }, []);

  const handleSelectVariant = (variant: VariantSearchResult) => {
    setSelectedVariant(variant);
    // Pre-fill unit cost from pricing if available
    if (variant.pricing?.price?.gross) {
      setUnitCost(variant.pricing.price.gross.amount.toString());
      setCurrency(variant.pricing.price.gross.currency);
    }
  };

  const handleAdd = () => {
    const newErrors: { qty?: string; unitCost?: string } = {};

    const qtyNum = parseInt(qty, 10);

    if (isNaN(qtyNum) || qtyNum < 1) {
      newErrors.qty = "Quantity must be at least 1";
    }

    const costNum = parseFloat(unitCost);

    if (isNaN(costNum) || costNum < 0) {
      newErrors.unitCost = "Cost must be a positive number";
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0 && selectedVariant) {
      onSelect({ variant: selectedVariant, qty: qtyNum, unitCost: costNum, currency });
      // Reset form
      setSearchQuery("");
      setSelectedVariant(null);
      setQty("1");
      setUnitCost("");
      setErrors({});
      onClose();
    }
  };

  const handleClose = () => {
    setSearchQuery("");
    setSelectedVariant(null);
    setQty("1");
    setUnitCost("");
    setErrors({});
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Box
      position="fixed"
      inset={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)", zIndex: 1000 }}
      onClick={handleClose}
    >
      <Box
        backgroundColor="default1"
        padding={6}
        borderRadius={4}
        __maxWidth="600px"
        __width="100%"
        boxShadow="defaultModal"
        onClick={(e) => e.stopPropagation()}
      >
        <Text as="h2" size={6} fontWeight="bold" marginBottom={4}>
          Add Line Item
        </Text>

        {!selectedVariant ? (
          // Search view
          <>
            <Box marginBottom={4}>
              <Input
                label="Search by SKU or product name"
                value={searchQuery}
                onChange={handleSearch}
                placeholder="Type at least 2 characters..."
                autoFocus
              />
            </Box>

            {searching && (
              <Box padding={4} display="flex" justifyContent="center">
                <Text color="default2">Searching...</Text>
              </Box>
            )}

            {searchQuery.length >= 2 && !searching && searchResults?.length === 0 && (
              <Box padding={4} display="flex" justifyContent="center">
                <Text color="default2">No products found</Text>
              </Box>
            )}

            {searchResults && searchResults.length > 0 && (
              <Box
                __maxHeight="300px"
                overflowY="auto"
                style={{ border: "1px solid #e5e7eb", borderRadius: "4px" }}
              >
                {searchResults.map((variant) => (
                  <Box
                    key={variant.id}
                    padding={3}
                    cursor="pointer"
                    display="flex"
                    alignItems="center"
                    gap={3}
                    onClick={() => handleSelectVariant(variant)}
                    className="hover-row"
                    style={{ borderBottom: "1px solid #e5e7eb" }}
                  >
                    {variant.product.thumbnail?.url && (
                      <Box
                        as="img"
                        __width="40px"
                        __height="40px"
                        style={{ objectFit: "cover", borderRadius: "4px" }}
                        src={variant.product.thumbnail.url}
                        alt={variant.product.name}
                      />
                    )}
                    <Box __flex="1">
                      <Text fontWeight="bold">{variant.product.name}</Text>
                      <Text size={2} color="default2">
                        {variant.sku || "No SKU"} - {variant.name}
                      </Text>
                    </Box>
                    {variant.pricing?.price?.gross && (
                      <Text size={2} color="default2">
                        {new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: variant.pricing.price.gross.currency,
                        }).format(variant.pricing.price.gross.amount)}
                      </Text>
                    )}
                  </Box>
                ))}
              </Box>
            )}

            <Box display="flex" justifyContent="flex-end" marginTop={4}>
              <Button variant="secondary" onClick={handleClose}>
                Cancel
              </Button>
            </Box>
          </>
        ) : (
          // Selected variant - enter quantity and cost
          <>
            <Box
              padding={4}
              marginBottom={4}
              style={{ backgroundColor: "#f9fafb", borderRadius: "4px" }}
            >
              <Box display="flex" alignItems="center" gap={3}>
                {selectedVariant.product.thumbnail?.url && (
                  <Box
                    as="img"
                    __width="60px"
                    __height="60px"
                    style={{ objectFit: "cover", borderRadius: "4px" }}
                    src={selectedVariant.product.thumbnail.url}
                    alt={selectedVariant.product.name}
                  />
                )}
                <Box>
                  <Text fontWeight="bold">{selectedVariant.product.name}</Text>
                  <Text size={2} color="default2">
                    {selectedVariant.sku || "No SKU"} - {selectedVariant.name}
                  </Text>
                </Box>
              </Box>
            </Box>

            <Box display="flex" gap={4} marginBottom={4}>
              <Box __flex="1">
                <Input
                  label="Quantity *"
                  type="number"
                  value={qty}
                  onChange={(e) => {
                    setQty(e.target.value);
                    if (errors.qty) setErrors((p) => ({ ...p, qty: undefined }));
                  }}
                  min={1}
                  error={!!errors.qty}
                  helperText={errors.qty}
                />
              </Box>
              <Box __flex="1">
                <Input
                  label="Expected Unit Cost *"
                  type="number"
                  value={unitCost}
                  onChange={(e) => {
                    setUnitCost(e.target.value);
                    if (errors.unitCost) setErrors((p) => ({ ...p, unitCost: undefined }));
                  }}
                  min={0}
                  step="0.01"
                  error={!!errors.unitCost}
                  helperText={errors.unitCost}
                />
              </Box>
              <Box __width="100px">
                <Input
                  label="Currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                />
              </Box>
            </Box>

            <Box display="flex" justifyContent="space-between">
              <Button
                variant="tertiary"
                onClick={() => {
                  setSelectedVariant(null);
                  setSearchQuery("");
                }}
              >
                Search again
              </Button>
              <Box display="flex" gap={2}>
                <Button variant="secondary" onClick={handleClose}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleAdd}>
                  Add Line
                </Button>
              </Box>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
};
