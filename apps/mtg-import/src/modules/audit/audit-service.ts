import { PrismaClient } from "@prisma/client";
import { Client } from "urql";
import gql from "graphql-tag";

import { createLogger } from "@/lib/logger";
import { getCardsForSet, getSet, ScryfallCard } from "@/modules/scryfall";

const logger = createLogger("audit-service");

/**
 * GraphQL query to get products for a set
 */
const PRODUCTS_BY_SET_QUERY = gql`
  query ProductsBySet($filter: ProductFilterInput!, $first: Int!, $after: String) {
    products(filter: $filter, first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          externalReference
          name
          variants {
            id
            sku
            externalReference
            channelListings {
              channel {
                slug
              }
              price {
                amount
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Audit result for a set
 */
export interface SetAuditResult {
  setCode: string;
  setName: string;

  // Scryfall counts
  scryfallCardCount: number;

  // Saleor counts
  saleorProductCount: number;
  saleorVariantCount: number;

  // Sellable completeness
  pricedCount: number;
  indexedCount: number;

  // Missing items
  missingCards: Array<{
    scryfallId: string;
    name: string;
    collectorNumber: string;
  }>;

  missingVariants: Array<{
    productId: string;
    productName: string;
    missingFinishes: string[];
  }>;

  pricingGaps: Array<{
    variantId: string;
    sku: string;
    missingChannels: string[];
  }>;

  // Is the set fully sellable?
  isFullySellable: boolean;
}

/**
 * Run an audit for a specific set
 */
export async function auditSet(
  installationId: string,
  setCode: string,
  prisma: PrismaClient,
  graphqlClient: Client
): Promise<SetAuditResult> {
  logger.info("Starting set audit", { setCode, installationId });

  // Get set info from Scryfall
  const scryfallSet = await getSet(setCode);
  const scryfallCards = await getCardsForSet(setCode);

  logger.info("Fetched Scryfall data", {
    setCode,
    setName: scryfallSet.name,
    cardCount: scryfallCards.length,
  });

  // Create a map of Scryfall cards by ID
  const scryfallCardMap = new Map<string, ScryfallCard>();
  for (const card of scryfallCards) {
    scryfallCardMap.set(card.id, card);
  }

  // Get imported products from our database
  const importedProducts = await prisma.importedProduct.findMany({
    where: {
      installationId,
      setCode,
    },
  });

  const importedScryfallIds = new Set(importedProducts.map((p) => p.scryfallId));

  logger.info("Found imported products", {
    setCode,
    importedCount: importedProducts.length,
  });

  // Find missing cards (in Scryfall but not in our database)
  const missingCards: SetAuditResult["missingCards"] = [];

  for (const card of scryfallCards) {
    if (!importedScryfallIds.has(card.id)) {
      missingCards.push({
        scryfallId: card.id,
        name: card.name,
        collectorNumber: card.collector_number,
      });
    }
  }

  logger.info("Found missing cards", {
    setCode,
    missingCount: missingCards.length,
  });

  // Get products from Saleor to check variants and pricing
  let saleorProductCount = 0;
  let saleorVariantCount = 0;
  let pricedCount = 0;
  const missingVariants: SetAuditResult["missingVariants"] = [];
  const pricingGaps: SetAuditResult["pricingGaps"] = [];

  // Query Saleor for products with this set code
  // Note: This assumes products have an attribute for set code that can be filtered
  // In practice, we might need to query by external reference instead
  let hasMore = true;
  let cursor: string | null = null;

  while (hasMore) {
    const result: { data?: { products?: { totalCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: Array<{ node: { id: string; externalReference: string | null; name: string; variants: Array<{ id: string; sku: string | null; externalReference: string | null; channelListings: Array<{ channel: { slug: string }; price: { amount: number } | null }> }> | null } }> } }; error?: { message: string } } = await graphqlClient
      .query(PRODUCTS_BY_SET_QUERY, {
        filter: {
          // Filter by external references that match our imported products
          // This is a simplified approach - in production you might filter differently
          ids: importedProducts.slice(0, 100).map((p) => p.saleorProductId),
        },
        first: 100,
        after: cursor,
      })
      .toPromise();

    if (result.error) {
      logger.warn("Error fetching products from Saleor", { error: result.error.message });
      break;
    }

    const products = result.data?.products;
    if (!products) {
      break;
    }

    saleorProductCount += products.edges.length;

    for (const edge of products.edges) {
      const product = edge.node;
      const variants = product.variants ?? [];

      saleorVariantCount += variants.length;

      // Check each variant for pricing
      for (const variant of variants) {
        const listings = variant.channelListings ?? [];
        const hasPrice = listings.some(
          (l: { price: { amount: number } | null }) => l.price && l.price.amount > 0
        );

        if (hasPrice) {
          pricedCount++;
        } else {
          // Find missing channels
          const missingChannels = listings
            .filter((l: { price: { amount: number } | null }) => !l.price || l.price.amount === 0)
            .map((l: { channel: { slug: string } }) => l.channel.slug);

          if (missingChannels.length > 0) {
            pricingGaps.push({
              variantId: variant.id,
              sku: variant.sku ?? "",
              missingChannels,
            });
          }
        }
      }

      // Check for missing finishes by comparing to Scryfall
      const scryfallId = product.externalReference;
      if (scryfallId && scryfallCardMap.has(scryfallId)) {
        const scryfallCard = scryfallCardMap.get(scryfallId)!;
        const expectedFinishes = scryfallCard.finishes;
        const actualFinishes = new Set(
          variants
            .map((v: { externalReference: string | null }) => v.externalReference?.split(":")?.[1])
            .filter(Boolean)
        );

        const missingFinishes = expectedFinishes.filter((f) => !actualFinishes.has(f));

        if (missingFinishes.length > 0) {
          missingVariants.push({
            productId: product.id,
            productName: product.name,
            missingFinishes,
          });
        }
      }
    }

    hasMore = products.pageInfo.hasNextPage;
    cursor = products.pageInfo.endCursor;
  }

  // Determine if set is fully sellable
  const isFullySellable =
    missingCards.length === 0 &&
    missingVariants.length === 0 &&
    pricingGaps.length === 0 &&
    pricedCount > 0;

  const auditResult: SetAuditResult = {
    setCode,
    setName: scryfallSet.name,
    scryfallCardCount: scryfallCards.length,
    saleorProductCount,
    saleorVariantCount,
    pricedCount,
    indexedCount: 0, // TODO: Query Meilisearch
    missingCards,
    missingVariants,
    pricingGaps,
    isFullySellable,
  };

  logger.info("Set audit completed", {
    setCode,
    scryfallCardCount: auditResult.scryfallCardCount,
    saleorProductCount: auditResult.saleorProductCount,
    missingCardsCount: auditResult.missingCards.length,
    missingVariantsCount: auditResult.missingVariants.length,
    pricingGapsCount: auditResult.pricingGaps.length,
    isFullySellable: auditResult.isFullySellable,
  });

  return auditResult;
}

/**
 * Save audit result to database
 */
export async function saveAuditResult(
  installationId: string,
  result: SetAuditResult,
  prisma: PrismaClient
): Promise<string> {
  const audit = await prisma.setAudit.upsert({
    where: {
      installationId_setCode: {
        installationId,
        setCode: result.setCode,
      },
    },
    update: {
      setName: result.setName,
      scryfallCardCount: result.scryfallCardCount,
      saleorProductCount: result.saleorProductCount,
      saleorVariantCount: result.saleorVariantCount,
      pricedCount: result.pricedCount,
      indexedCount: result.indexedCount,
      missingCards: result.missingCards,
      missingVariants: result.missingVariants,
      pricingGaps: result.pricingGaps,
      sellableTimestamp: result.isFullySellable ? new Date() : null,
      auditedAt: new Date(),
    },
    create: {
      installationId,
      setCode: result.setCode,
      setName: result.setName,
      scryfallCardCount: result.scryfallCardCount,
      saleorProductCount: result.saleorProductCount,
      saleorVariantCount: result.saleorVariantCount,
      pricedCount: result.pricedCount,
      indexedCount: result.indexedCount,
      missingCards: result.missingCards,
      missingVariants: result.missingVariants,
      pricingGaps: result.pricingGaps,
      sellableTimestamp: result.isFullySellable ? new Date() : null,
    },
  });

  return audit.id;
}
