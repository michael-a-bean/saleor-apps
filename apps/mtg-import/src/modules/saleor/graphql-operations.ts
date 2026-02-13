/**
 * Saleor GraphQL operations for the MTG Import app.
 *
 * Uses inline gql`` from urql (matching inventory-ops pattern).
 * Covers: product bulk create, channel queries, product type lookup, attribute queries.
 */

import { gql } from "urql";

// --- Queries ---

export const CHANNELS_QUERY = gql`
  query Channels {
    channels {
      id
      name
      slug
      currencyCode
    }
  }
`;

export const PRODUCT_TYPES_QUERY = gql`
  query ProductTypes($filter: ProductTypeFilterInput) {
    productTypes(first: 10, filter: $filter) {
      edges {
        node {
          id
          name
          slug
          productAttributes {
            id
            name
            slug
            inputType
          }
          variantAttributes {
            id
            name
            slug
            inputType
          }
        }
      }
    }
  }
`;

export const CATEGORIES_QUERY = gql`
  query Categories($filter: CategoryFilterInput) {
    categories(first: 10, filter: $filter) {
      edges {
        node {
          id
          name
          slug
        }
      }
    }
  }
`;

export const WAREHOUSES_QUERY = gql`
  query Warehouses {
    warehouses(first: 10) {
      edges {
        node {
          id
          name
          slug
        }
      }
    }
  }
`;

export const PRODUCT_BY_SLUG_QUERY = gql`
  query ProductBySlug($slug: String!, $channel: String!) {
    product(slug: $slug, channel: $channel) {
      id
      name
      slug
    }
  }
`;

// --- Mutations ---

export const PRODUCT_BULK_CREATE_MUTATION = gql`
  mutation ProductBulkCreate($products: [ProductBulkCreateInput!]!) {
    productBulkCreate(
      products: $products,
      errorPolicy: REJECT_FAILED_ROWS
    ) {
      count
      results {
        product {
          id
          name
          slug
          variants {
            id
            sku
            name
          }
        }
        errors {
          field
          message
          code
          path
        }
      }
      errors {
        field
        message
        code
        path
      }
    }
  }
`;

// --- Types ---

export interface SaleorChannel {
  id: string;
  name: string;
  slug: string;
  currencyCode: string;
}

export interface SaleorProductType {
  id: string;
  name: string;
  slug: string;
  productAttributes: SaleorAttribute[];
  variantAttributes: SaleorAttribute[];
}

export interface SaleorAttribute {
  id: string;
  name: string;
  slug: string;
  inputType: string;
}

export interface SaleorCategory {
  id: string;
  name: string;
  slug: string;
}

export interface SaleorWarehouse {
  id: string;
  name: string;
  slug: string;
}

export interface ProductBulkCreateResult {
  count: number;
  results: Array<{
    product: {
      id: string;
      name: string;
      slug: string;
      variants: Array<{
        id: string;
        sku: string | null;
        name: string;
      }>;
    } | null;
    errors: Array<{
      field: string | null;
      message: string | null;
      code: string;
      path: string | null;
    }>;
  }>;
  errors: Array<{
    field: string | null;
    message: string | null;
    code: string;
    path: string | null;
  }>;
}
