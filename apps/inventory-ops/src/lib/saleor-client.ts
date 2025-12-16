import { Client, gql } from "urql";

import { createLogger } from "./logger";

const logger = createLogger("saleor-client");

// GraphQL Queries
const WAREHOUSES_QUERY = gql`
  query Warehouses($first: Int!) {
    warehouses(first: $first) {
      edges {
        node {
          id
          name
          slug
          shippingZones(first: 100) {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    }
  }
`;

const SEARCH_VARIANTS_QUERY = gql`
  query SearchVariants($first: Int!, $search: String, $channel: String!) {
    productVariants(first: $first, filter: { search: $search }, channel: $channel) {
      edges {
        node {
          id
          sku
          name
          product {
            id
            name
            thumbnail {
              url
            }
          }
          pricing {
            price {
              gross {
                amount
                currency
              }
            }
          }
        }
      }
    }
  }
`;

const GET_VARIANT_BY_ID_QUERY = gql`
  query GetVariantById($id: ID!, $channel: String!) {
    productVariant(id: $id, channel: $channel) {
      id
      sku
      name
      product {
        id
        name
        thumbnail {
          url
        }
      }
      pricing {
        price {
          gross {
            amount
            currency
          }
        }
      }
    }
  }
`;

const GET_VARIANTS_BY_IDS_QUERY = gql`
  query GetVariantsByIds($ids: [ID!]!, $channel: String!) {
    productVariants(first: 100, filter: { ids: $ids }, channel: $channel) {
      edges {
        node {
          id
          sku
          name
          product {
            id
            name
            thumbnail {
              url
            }
          }
          pricing {
            price {
              gross {
                amount
                currency
              }
            }
          }
        }
      }
    }
  }
`;

// Stock Queries
const GET_VARIANT_STOCKS_QUERY = gql`
  query GetVariantStocks($variantId: ID!, $channel: String!) {
    productVariant(id: $variantId, channel: $channel) {
      id
      sku
      name
      stocks {
        id
        warehouse {
          id
          name
        }
        quantity
      }
    }
  }
`;

// Note: GET_STOCKS_QUERY is defined for future use but not currently used
const _GET_STOCKS_QUERY = gql`
  query GetStocks($first: Int!) {
    stocks(first: $first) {
      edges {
        node {
          id
          quantity
          warehouse {
            id
            name
          }
          productVariant {
            id
            sku
            name
          }
        }
      }
    }
  }
`;

// Stock Mutation - Creates stock if it doesn't exist, updates if it does
const PRODUCT_VARIANT_STOCKS_UPDATE_MUTATION = gql`
  mutation ProductVariantStocksUpdate($variantId: ID!, $stocks: [StockInput!]!) {
    productVariantStocksUpdate(variantId: $variantId, stocks: $stocks) {
      productVariant {
        id
        sku
        stocks {
          id
          quantity
          warehouse {
            id
            name
          }
        }
      }
      errors {
        field
        message
        code
      }
    }
  }
`;

// Type definitions
export interface SaleorWarehouse {
  id: string;
  name: string;
  slug: string;
  shippingZones: {
    edges: Array<{
      node: {
        id: string;
        name: string;
      };
    }>;
  };
}

export interface SaleorVariant {
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

export interface SaleorStock {
  id: string;
  quantity: number;
  warehouse: {
    id: string;
    name: string;
  };
  productVariant: {
    id: string;
    sku: string | null;
    name: string;
  };
}

export interface SaleorVariantWithStocks extends SaleorVariant {
  stocks: Array<{
    id: string;
    warehouse: {
      id: string;
      name: string;
    };
    quantity: number;
  }>;
}


// Response types
interface WarehousesResponse {
  warehouses: {
    edges: Array<{
      node: SaleorWarehouse;
    }>;
  } | null;
}

interface SearchVariantsResponse {
  productVariants: {
    edges: Array<{
      node: SaleorVariant;
    }>;
  } | null;
}

interface GetVariantResponse {
  productVariant: SaleorVariant | null;
}

interface GetVariantStocksResponse {
  productVariant: SaleorVariantWithStocks | null;
}

// Note: _GetStocksResponse is defined for future use but not currently used
interface _GetStocksResponse {
  stocks: {
    edges: Array<{
      node: SaleorStock;
    }>;
  } | null;
}

interface ProductVariantStocksUpdateResponse {
  productVariantStocksUpdate: {
    productVariant: {
      id: string;
      sku: string | null;
      stocks: Array<{
        id: string;
        quantity: number;
        warehouse: {
          id: string;
          name: string;
        };
      }>;
    } | null;
    errors: Array<{
      field: string | null;
      message: string;
      code: string;
    }>;
  } | null;
}

/**
 * Saleor API client helper functions
 * These wrap the GraphQL queries for use in tRPC procedures
 */
export class SaleorClient {
  private client: Client;
  private channel: string;

  constructor(client: Client, channel: string = "webstore") {
    this.client = client;
    this.channel = channel;
  }

  /**
   * List all warehouses
   */
  async listWarehouses(first: number = 100): Promise<SaleorWarehouse[]> {
    logger.debug("Fetching warehouses", { first });

    const result = await this.client.query<WarehousesResponse>(WAREHOUSES_QUERY, { first }).toPromise();

    if (result.error) {
      logger.error("Failed to fetch warehouses", { error: result.error.message });
      throw new Error(`Failed to fetch warehouses: ${result.error.message}`);
    }

    const warehouses = result.data?.warehouses?.edges.map((e) => e.node) ?? [];

    logger.debug("Fetched warehouses", { count: warehouses.length });

    return warehouses;
  }

  /**
   * Search for product variants by SKU or name
   */
  async searchVariants(search: string, first: number = 20): Promise<SaleorVariant[]> {
    logger.debug("Searching variants", { search, first });

    const result = await this.client
      .query<SearchVariantsResponse>(SEARCH_VARIANTS_QUERY, {
        first,
        search,
        channel: this.channel,
      })
      .toPromise();

    if (result.error) {
      logger.error("Failed to search variants", { error: result.error.message });
      throw new Error(`Failed to search variants: ${result.error.message}`);
    }

    const variants = result.data?.productVariants?.edges.map((e) => e.node) ?? [];

    logger.debug("Found variants", { count: variants.length });

    return variants;
  }

  /**
   * Get a single variant by ID
   */
  async getVariantById(id: string): Promise<SaleorVariant | null> {
    logger.debug("Getting variant by ID", { id });

    const result = await this.client
      .query<GetVariantResponse>(GET_VARIANT_BY_ID_QUERY, {
        id,
        channel: this.channel,
      })
      .toPromise();

    if (result.error) {
      logger.error("Failed to get variant", { error: result.error.message });
      throw new Error(`Failed to get variant: ${result.error.message}`);
    }

    return result.data?.productVariant ?? null;
  }

  /**
   * Get multiple variants by their IDs
   */
  async getVariantsByIds(ids: string[]): Promise<SaleorVariant[]> {
    if (ids.length === 0) {
      return [];
    }

    logger.debug("Getting variants by IDs", { count: ids.length });

    const result = await this.client
      .query<SearchVariantsResponse>(GET_VARIANTS_BY_IDS_QUERY, {
        ids,
        channel: this.channel,
      })
      .toPromise();

    if (result.error) {
      logger.error("Failed to get variants", { error: result.error.message });
      throw new Error(`Failed to get variants: ${result.error.message}`);
    }

    const variants = result.data?.productVariants?.edges.map((e) => e.node) ?? [];

    logger.debug("Retrieved variants", { requested: ids.length, found: variants.length });

    return variants;
  }

  /**
   * Get stock levels for a variant across all warehouses
   */
  async getVariantStocks(variantId: string): Promise<SaleorVariantWithStocks | null> {
    logger.debug("Getting variant stocks", { variantId });

    const result = await this.client
      .query<GetVariantStocksResponse>(GET_VARIANT_STOCKS_QUERY, {
        variantId,
        channel: this.channel,
      })
      .toPromise();

    if (result.error) {
      logger.error("Failed to get variant stocks", { error: result.error.message });
      throw new Error(`Failed to get variant stocks: ${result.error.message}`);
    }

    return result.data?.productVariant ?? null;
  }

  /**
   * Get stock for a specific variant in a specific warehouse
   */
  async getStock(variantId: string, warehouseId: string): Promise<number> {
    const variantWithStocks = await this.getVariantStocks(variantId);

    if (!variantWithStocks) {
      logger.warn("Variant not found", { variantId });
      return 0;
    }

    const stock = variantWithStocks.stocks.find((s) => s.warehouse.id === warehouseId);

    return stock?.quantity ?? 0;
  }

  /**
   * Update stock for a single variant in a warehouse
   * Creates stock record if it doesn't exist, updates if it does
   * Returns the new quantity
   */
  async updateStock(
    variantId: string,
    warehouseId: string,
    quantity: number
  ): Promise<{ success: boolean; newQuantity: number; error?: string }> {
    logger.info("Updating stock", { variantId, warehouseId, quantity });

    const result = await this.client
      .mutation<ProductVariantStocksUpdateResponse>(PRODUCT_VARIANT_STOCKS_UPDATE_MUTATION, {
        variantId,
        stocks: [{ warehouse: warehouseId, quantity }],
      })
      .toPromise();

    if (result.error) {
      logger.error("Failed to update stock", { error: result.error.message });
      return { success: false, newQuantity: 0, error: result.error.message };
    }

    const response = result.data?.productVariantStocksUpdate;

    if (!response) {
      return { success: false, newQuantity: 0, error: "No response from mutation" };
    }

    // Check errors
    if (response.errors && response.errors.length > 0) {
      const errorMsg = response.errors.map((e) => e.message).join(", ");

      logger.error("Stock update errors", { errors: response.errors });
      return { success: false, newQuantity: 0, error: errorMsg };
    }

    // Find the stock for the warehouse we just updated
    const updatedStock = response.productVariant?.stocks.find((s) => s.warehouse.id === warehouseId);
    const newQuantity = updatedStock?.quantity ?? quantity;

    logger.info("Stock updated successfully", { variantId, warehouseId, newQuantity });

    return { success: true, newQuantity };
  }

  /**
   * Update stock by adding a delta (positive or negative)
   * Fetches current stock, calculates new quantity, then updates
   */
  async adjustStock(
    variantId: string,
    warehouseId: string,
    delta: number
  ): Promise<{ success: boolean; previousQuantity: number; newQuantity: number; error?: string }> {
    logger.info("Adjusting stock", { variantId, warehouseId, delta });

    // Get current stock
    const currentQuantity = await this.getStock(variantId, warehouseId);
    const newQuantity = currentQuantity + delta;

    if (newQuantity < 0) {
      logger.warn("Stock adjustment would result in negative quantity", {
        variantId,
        warehouseId,
        currentQuantity,
        delta,
        newQuantity,
      });
      // Allow negative for reversal scenarios - Saleor will validate
    }

    const result = await this.updateStock(variantId, warehouseId, newQuantity);

    return {
      success: result.success,
      previousQuantity: currentQuantity,
      newQuantity: result.success ? result.newQuantity : currentQuantity,
      error: result.error,
    };
  }

}

/**
 * Create a SaleorClient instance from an authenticated GraphQL client
 */
export function createSaleorClient(client: Client, channel?: string): SaleorClient {
  return new SaleorClient(client, channel);
}
