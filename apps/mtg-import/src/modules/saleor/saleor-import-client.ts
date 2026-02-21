/**
 * Saleor GraphQL client wrapper for MTG import operations.
 *
 * Resolves channels, product types, categories, and warehouses by slug.
 * Executes productBulkCreate with batching.
 */

import type { Client } from "urql";

import { SaleorApiError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";

import type { AttributeDef } from "../import/attribute-map";
import {
  ATTRIBUTE_BULK_CREATE_MUTATION,
  type AttributeBulkCreateResult,
  CATEGORIES_QUERY,
  CHANNELS_QUERY,
  PRODUCT_ATTRIBUTE_ASSIGN_MUTATION,
  PRODUCT_BULK_CREATE_MUTATION,
  PRODUCT_BULK_UPDATE_MUTATION,
  PRODUCT_BY_SLUG_QUERY,
  PRODUCT_TYPES_QUERY,
  type ProductAttributeAssignResult,
  type ProductBulkCreateResult,
  type ProductBulkUpdateResult,
  PRODUCTS_BY_METADATA_QUERY,
  type SaleorCategory,
  type SaleorChannel,
  type SaleorProductType,
  type SaleorProductWithAttributes,
  type SaleorWarehouse,
  WAREHOUSES_QUERY,
} from "./graphql-operations";

const logger = createLogger("SaleorImportClient");

export interface ImportContext {
  channels: SaleorChannel[];
  productType: SaleorProductType;
  category: SaleorCategory;
  warehouse: SaleorWarehouse;
}

export class SaleorImportClient {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  /** Resolve all channels */
  async getChannels(): Promise<SaleorChannel[]> {
    const result = await this.client.query(CHANNELS_QUERY, {}).toPromise();
    if (result.error) {
      throw new SaleorApiError(`Failed to fetch channels: ${result.error.message}`);
    }
    return result.data?.channels ?? [];
  }

  /** Find channels by slug list (e.g., ["webstore", "singles-builder"]) */
  async getChannelsBySlugs(slugs: string[]): Promise<SaleorChannel[]> {
    const all = await this.getChannels();
    const found = all.filter((ch) => slugs.includes(ch.slug));
    const missing = slugs.filter((s) => !found.some((ch) => ch.slug === s));
    if (missing.length > 0) {
      logger.warn("Some channels not found", { missing, available: all.map((ch) => ch.slug) });
    }
    return found;
  }

  /** Find or create the MTG Card product type */
  async getProductType(slug: string = "mtg-card"): Promise<SaleorProductType> {
    const result = await this.client
      .query(PRODUCT_TYPES_QUERY, { filter: { search: slug } })
      .toPromise();

    if (result.error) {
      throw new SaleorApiError(`Failed to fetch product types: ${result.error.message}`);
    }

    const types = result.data?.productTypes?.edges ?? [];
    const match = types.find(
      (e: { node: SaleorProductType }) => e.node.slug === slug
    );

    if (!match) {
      throw new SaleorApiError(
        `Product type "${slug}" not found. Create it in Saleor Dashboard first.`
      );
    }

    return match.node;
  }

  /** Find the MTG Cards category */
  async getCategory(slug: string = "mtg-singles"): Promise<SaleorCategory> {
    const result = await this.client
      .query(CATEGORIES_QUERY, { filter: { search: slug } })
      .toPromise();

    if (result.error) {
      throw new SaleorApiError(`Failed to fetch categories: ${result.error.message}`);
    }

    const categories = result.data?.categories?.edges ?? [];
    const match = categories.find(
      (e: { node: SaleorCategory }) => e.node.slug === slug
    );

    if (!match) {
      throw new SaleorApiError(
        `Category "${slug}" not found. Create it in Saleor Dashboard first.`
      );
    }

    return match.node;
  }

  /** Get the first warehouse (for stock entries) */
  async getWarehouse(): Promise<SaleorWarehouse> {
    const result = await this.client.query(WAREHOUSES_QUERY, {}).toPromise();

    if (result.error) {
      throw new SaleorApiError(`Failed to fetch warehouses: ${result.error.message}`);
    }

    const warehouses = result.data?.warehouses?.edges ?? [];
    if (warehouses.length === 0) {
      throw new SaleorApiError("No warehouses found. Create one in Saleor Dashboard first.");
    }

    return warehouses[0].node;
  }

  /** Resolve the full import context (channels, product type, category, warehouse) */
  async resolveImportContext(channelSlugs: string[] = ["webstore", "singles-builder"]): Promise<ImportContext> {
    const [channels, productType, category, warehouse] = await Promise.all([
      this.getChannelsBySlugs(channelSlugs),
      this.getProductType(),
      this.getCategory(),
      this.getWarehouse(),
    ]);

    logger.info("Import context resolved", {
      channels: channels.map((ch) => ch.slug),
      productType: productType.slug,
      category: category.slug,
      warehouse: warehouse.slug,
    });

    return { channels, productType, category, warehouse };
  }

  /** Check if a product already exists by slug */
  async productExists(slug: string, channelSlug: string = "webstore"): Promise<boolean> {
    const result = await this.client
      .query(PRODUCT_BY_SLUG_QUERY, { slug, channel: channelSlug })
      .toPromise();
    return !!result.data?.product;
  }

  /** Execute productBulkCreate mutation */
  async bulkCreateProducts(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    products: any[]
  ): Promise<ProductBulkCreateResult> {
    const result = await this.client
      .mutation(PRODUCT_BULK_CREATE_MUTATION, { products })
      .toPromise();

    if (result.error) {
      throw new SaleorApiError(`productBulkCreate failed: ${result.error.message}`);
    }

    const data = result.data?.productBulkCreate as ProductBulkCreateResult | undefined;
    if (!data) {
      throw new SaleorApiError("productBulkCreate returned no data");
    }

    // Log row-level errors (skip slug duplicates — handled by job processor as expected skips)
    for (const row of data.results) {
      if (row.errors.length > 0) {
        const isSlugDuplicate = row.errors.every(
          (e) => e.code === "UNIQUE" && (e.path === "slug" || e.message?.includes("Slug already exists"))
        );
        if (!isSlugDuplicate) {
          logger.warn("Product creation error", {
            product: row.product?.name ?? "unknown",
            errors: row.errors,
          });
        }
      }
    }

    return data;
  }

  /** Execute productBulkUpdate mutation */
  async bulkUpdateProducts(
    products: Array<{ id: string; input: Record<string, unknown> }>
  ): Promise<ProductBulkUpdateResult> {
    const result = await this.client
      .mutation(PRODUCT_BULK_UPDATE_MUTATION, { products })
      .toPromise();

    if (result.error) {
      throw new SaleorApiError(`productBulkUpdate failed: ${result.error.message}`);
    }

    const data = result.data?.productBulkUpdate as ProductBulkUpdateResult | undefined;
    if (!data) {
      throw new SaleorApiError("productBulkUpdate returned no data");
    }

    for (const row of data.results) {
      if (row.errors.length > 0) {
        logger.warn("Product update error", {
          product: row.product?.name ?? "unknown",
          errors: row.errors,
        });
      }
    }

    return data;
  }

  /** Fetch products by set_code metadata with full attributes */
  async getProductsBySetCode(
    setCode: string,
    channel: string = "webstore"
  ): Promise<SaleorProductWithAttributes[]> {
    const result = await this.client
      .query(PRODUCTS_BY_METADATA_QUERY, {
        filter: { metadata: [{ key: "set_code", value: setCode }] },
        channel,
        first: 100,
      })
      .toPromise();

    if (result.error) {
      throw new SaleorApiError(`Failed to fetch products by metadata: ${result.error.message}`);
    }

    const edges = result.data?.products?.edges ?? [];
    return edges.map((e: { node: SaleorProductWithAttributes }) => e.node);
  }

  /** Create missing attributes and assign them to the product type */
  async createMissingAttributes(
    missingDefs: AttributeDef[],
    productTypeId: string
  ): Promise<{ created: number; assigned: number; errors: string[] }> {
    const errors: string[] = [];

    // Step 1: Bulk-create the missing attributes
    const createInputs = missingDefs.map((def) => ({
      name: def.name,
      slug: def.slug,
      type: "PRODUCT_TYPE" as const,
      inputType: def.inputType,
    }));

    const createResult = await this.client
      .mutation(ATTRIBUTE_BULK_CREATE_MUTATION, { attributes: createInputs })
      .toPromise();

    if (createResult.error) {
      throw new SaleorApiError(`attributeBulkCreate failed: ${createResult.error.message}`);
    }

    const createData = createResult.data?.attributeBulkCreate as AttributeBulkCreateResult | undefined;
    if (!createData) {
      throw new SaleorApiError("attributeBulkCreate returned no data");
    }

    // Collect successfully created attribute IDs
    const createdIds: string[] = [];
    for (const row of createData.results) {
      if (row.attribute) {
        createdIds.push(row.attribute.id);
      }
      if (row.errors && row.errors.length > 0) {
        for (const err of row.errors) {
          errors.push(`Create ${err.path ?? "attribute"}: ${err.message ?? err.code}`);
        }
      }
    }

    // Also log top-level errors
    for (const err of createData.errors) {
      errors.push(`Bulk create: ${err.message ?? err.code}`);
    }

    logger.info("Attributes created", { count: createdIds.length, errors: errors.length });

    if (createdIds.length === 0) {
      return { created: 0, assigned: 0, errors };
    }

    // Step 2: Assign created attributes to the product type
    const assignOps = createdIds.map((id) => ({
      id,
      type: "PRODUCT" as const,
    }));

    const assignResult = await this.client
      .mutation(PRODUCT_ATTRIBUTE_ASSIGN_MUTATION, {
        productTypeId,
        operations: assignOps,
      })
      .toPromise();

    if (assignResult.error) {
      throw new SaleorApiError(`productAttributeAssign failed: ${assignResult.error.message}`);
    }

    const assignData = assignResult.data?.productAttributeAssign as ProductAttributeAssignResult | undefined;
    if (!assignData) {
      throw new SaleorApiError("productAttributeAssign returned no data");
    }

    for (const err of assignData.errors) {
      errors.push(`Assign: ${err.message ?? err.code}`);
    }

    const assignedCount = assignData.errors.length === 0 ? createdIds.length : 0;

    logger.info("Attributes assigned to product type", {
      productTypeId,
      assigned: assignedCount,
    });

    return { created: createdIds.length, assigned: assignedCount, errors };
  }
}
