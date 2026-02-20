/**
 * Saleor GraphQL client wrapper for MTG import operations.
 *
 * Resolves channels, product types, categories, and warehouses by slug.
 * Executes productBulkCreate with batching.
 */

import type { Client } from "urql";

import { createLogger } from "@/lib/logger";
import { SaleorApiError } from "@/lib/errors";
import {
  CHANNELS_QUERY,
  PRODUCT_TYPES_QUERY,
  CATEGORIES_QUERY,
  WAREHOUSES_QUERY,
  PRODUCT_BULK_CREATE_MUTATION,
  PRODUCT_BULK_UPDATE_MUTATION,
  PRODUCT_BY_SLUG_QUERY,
  PRODUCTS_BY_METADATA_QUERY,
  type SaleorChannel,
  type SaleorProductType,
  type SaleorCategory,
  type SaleorWarehouse,
  type ProductBulkCreateResult,
  type ProductBulkUpdateResult,
  type SaleorProductWithAttributes,
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
}
