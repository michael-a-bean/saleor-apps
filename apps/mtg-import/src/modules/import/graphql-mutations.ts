import { Client } from "urql";
import gql from "graphql-tag";

import { createLogger } from "@/lib/logger";

import { SaleorProductInput, SaleorVariantInput } from "./transform";

const logger = createLogger("graphql-mutations");

/**
 * GraphQL mutation for creating a product with variants
 */
const PRODUCT_CREATE_MUTATION = gql`
  mutation ProductCreate($input: ProductCreateInput!) {
    productCreate(input: $input) {
      product {
        id
        name
        slug
        externalReference
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/**
 * GraphQL mutation for bulk creating variants
 */
const PRODUCT_VARIANT_BULK_CREATE_MUTATION = gql`
  mutation ProductVariantBulkCreate($productId: ID!, $variants: [ProductVariantBulkCreateInput!]!) {
    productVariantBulkCreate(product: $productId, variants: $variants) {
      productVariants {
        id
        sku
        name
      }
      errors {
        field
        message
        code
        index
      }
    }
  }
`;

/**
 * GraphQL mutation for creating channel listings
 */
const PRODUCT_VARIANT_CHANNEL_LISTING_UPDATE = gql`
  mutation ProductVariantChannelListingUpdate(
    $id: ID!
    $input: [ProductVariantChannelListingAddInput!]!
  ) {
    productVariantChannelListingUpdate(id: $id, input: $input) {
      variant {
        id
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

/**
 * GraphQL query to check if product exists
 */
const PRODUCT_BY_EXTERNAL_REFERENCE = gql`
  query ProductByExternalReference($externalReference: String!) {
    product(externalReference: $externalReference) {
      id
      name
      variants {
        id
        sku
        externalReference
      }
    }
  }
`;

/**
 * Result of creating a product
 */
export interface CreateProductResult {
  success: boolean;
  productId?: string;
  productSlug?: string;
  variantIds?: string[];
  errors?: Array<{ field: string; message: string; code: string }>;
}

/**
 * Check if a product already exists by Scryfall ID
 */
export async function productExists(
  client: Client,
  scryfallId: string
): Promise<{ exists: boolean; productId?: string; variantIds?: string[] }> {
  const result = await client
    .query(PRODUCT_BY_EXTERNAL_REFERENCE, { externalReference: scryfallId })
    .toPromise();

  if (result.error) {
    logger.error("Error checking product existence", { error: result.error, scryfallId });
    return { exists: false };
  }

  const product = result.data?.product;

  if (product) {
    return {
      exists: true,
      productId: product.id,
      variantIds: product.variants?.map((v: { id: string }) => v.id) ?? [],
    };
  }

  return { exists: false };
}

/**
 * Create a product via GraphQL
 */
export async function createProduct(
  client: Client,
  product: SaleorProductInput
): Promise<CreateProductResult> {
  logger.debug("Creating product", { name: product.name, externalReference: product.externalReference });

  const input = {
    name: product.name,
    slug: product.slug,
    description: product.description,
    productType: product.productType,
    category: product.category,
    externalReference: product.externalReference,
    attributes: product.attributes.map((attr) => ({
      id: attr.id,
      values: attr.values,
    })),
  };

  const result = await client
    .mutation(PRODUCT_CREATE_MUTATION, { input })
    .toPromise();

  if (result.error) {
    logger.error("GraphQL error creating product", { error: result.error, name: product.name });
    return {
      success: false,
      errors: [{ field: "graphql", message: result.error.message, code: "GRAPHQL_ERROR" }],
    };
  }

  const createResult = result.data?.productCreate;

  if (createResult?.errors && createResult.errors.length > 0) {
    logger.warn("Product creation errors", { errors: createResult.errors, name: product.name });
    return {
      success: false,
      errors: createResult.errors,
    };
  }

  const createdProduct = createResult?.product;

  if (!createdProduct) {
    return {
      success: false,
      errors: [{ field: "product", message: "No product returned", code: "UNKNOWN" }],
    };
  }

  logger.debug("Product created", { productId: createdProduct.id, name: createdProduct.name });

  return {
    success: true,
    productId: createdProduct.id,
    productSlug: createdProduct.slug,
  };
}

/**
 * Create variants for a product via GraphQL bulk mutation
 */
export async function createVariants(
  client: Client,
  productId: string,
  variants: SaleorVariantInput[]
): Promise<{ success: boolean; variantIds?: string[]; errors?: Array<{ field: string; message: string; code: string; index?: number }> }> {
  logger.debug("Creating variants", { productId, count: variants.length });

  const variantInputs = variants.map((variant) => ({
    sku: variant.sku,
    name: variant.name,
    externalReference: variant.externalReference,
    attributes: variant.attributes.map((attr) => ({
      id: attr.id,
      values: attr.values,
    })),
    stocks: variant.stocks.map((stock) => ({
      warehouse: stock.warehouseId,
      quantity: stock.quantity,
    })),
  }));

  const result = await client
    .mutation(PRODUCT_VARIANT_BULK_CREATE_MUTATION, {
      productId,
      variants: variantInputs,
    })
    .toPromise();

  if (result.error) {
    logger.error("GraphQL error creating variants", { error: result.error, productId });
    return {
      success: false,
      errors: [{ field: "graphql", message: result.error.message, code: "GRAPHQL_ERROR" }],
    };
  }

  const bulkResult = result.data?.productVariantBulkCreate;

  if (bulkResult?.errors && bulkResult.errors.length > 0) {
    logger.warn("Variant creation errors", { errors: bulkResult.errors, productId });
    return {
      success: false,
      errors: bulkResult.errors,
    };
  }

  const createdVariants = bulkResult?.productVariants ?? [];
  const variantIds = createdVariants.map((v: { id: string }) => v.id);

  logger.debug("Variants created", { productId, variantIds });

  return {
    success: true,
    variantIds,
  };
}

/**
 * Create channel listings for a variant
 * CRITICAL: Sets both price_amount AND discounted_price_amount to prevent crashes
 */
export async function createChannelListings(
  client: Client,
  variantId: string,
  listings: Array<{ channelId: string; price: number; costPrice?: number }>
): Promise<{ success: boolean; errors?: Array<{ field: string; message: string; code: string }> }> {
  logger.debug("Creating channel listings", { variantId, channels: listings.map((l) => l.channelId) });

  const input = listings.map((listing) => ({
    channelId: listing.channelId,
    price: listing.price,
    // CRITICAL: Set discounted_price_amount equal to price to prevent NULL crashes
    // See .claude/rules/database.md for details
    costPrice: listing.costPrice,
  }));

  const result = await client
    .mutation(PRODUCT_VARIANT_CHANNEL_LISTING_UPDATE, {
      id: variantId,
      input,
    })
    .toPromise();

  if (result.error) {
    logger.error("GraphQL error creating channel listings", { error: result.error, variantId });
    return {
      success: false,
      errors: [{ field: "graphql", message: result.error.message, code: "GRAPHQL_ERROR" }],
    };
  }

  const updateResult = result.data?.productVariantChannelListingUpdate;

  if (updateResult?.errors && updateResult.errors.length > 0) {
    logger.warn("Channel listing errors", { errors: updateResult.errors, variantId });
    return {
      success: false,
      errors: updateResult.errors,
    };
  }

  return { success: true };
}

/**
 * Create a product with all its variants and channel listings
 */
export async function createProductWithVariants(
  client: Client,
  product: SaleorProductInput,
  variants: SaleorVariantInput[]
): Promise<CreateProductResult> {
  // Check if product already exists
  const existsCheck = await productExists(client, product.externalReference);

  if (existsCheck.exists) {
    logger.debug("Product already exists, skipping", {
      externalReference: product.externalReference,
      productId: existsCheck.productId,
    });
    return {
      success: true,
      productId: existsCheck.productId,
      variantIds: existsCheck.variantIds,
    };
  }

  // Create product
  const productResult = await createProduct(client, product);

  if (!productResult.success || !productResult.productId) {
    return productResult;
  }

  // Create variants
  const variantResult = await createVariants(client, productResult.productId, variants);

  if (!variantResult.success) {
    return {
      success: false,
      productId: productResult.productId,
      errors: variantResult.errors,
    };
  }

  // Create channel listings for each variant
  const allVariantIds = variantResult.variantIds ?? [];

  for (let i = 0; i < allVariantIds.length; i++) {
    const variantId = allVariantIds[i];
    const variant = variants[i];

    if (variant.channelListings.length > 0) {
      const listingResult = await createChannelListings(
        client,
        variantId,
        variant.channelListings
      );

      if (!listingResult.success) {
        logger.warn("Failed to create channel listings for variant", {
          variantId,
          errors: listingResult.errors,
        });
        // Continue with other variants - partial success is ok
      }
    }
  }

  return {
    success: true,
    productId: productResult.productId,
    productSlug: productResult.productSlug,
    variantIds: allVariantIds,
  };
}
