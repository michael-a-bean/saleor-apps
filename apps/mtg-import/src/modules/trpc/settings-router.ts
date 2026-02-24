/**
 * tRPC router for import settings management.
 *
 * Endpoints:
 * - getSettings — Get current settings (lazy-create with defaults if missing)
 * - updateSettings — Upsert settings
 * - getSaleorOptions — Fetch all channels, product types, categories, warehouses for dropdowns
 * - createChannel / createProductType / createCategory / createWarehouse — Inline entity creation
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createLogger } from "@/lib/logger";
import { SaleorImportClient } from "../saleor";
import {
  CHANNELS_QUERY,
  PRODUCT_TYPES_QUERY,
  CATEGORIES_QUERY,
  WAREHOUSES_QUERY,
  CHANNEL_CREATE_MUTATION,
  PRODUCT_TYPE_CREATE_MUTATION,
  CATEGORY_CREATE_MUTATION,
  WAREHOUSE_CREATE_MUTATION,
  type SaleorChannel,
  type SaleorProductType,
  type SaleorCategory,
  type SaleorWarehouse,
} from "../saleor/graphql-operations";
import { protectedClientProcedure } from "./protected-client-procedure";
import { router } from "./trpc-server";

const logger = createLogger("SettingsRouter");

const importSettingsSchema = z.object({
  channelSlugs: z.array(z.string()).min(1),
  productTypeSlug: z.string().min(1),
  categorySlug: z.string().min(1),
  warehouseSlugs: z.array(z.string()),
  conditionNm: z.number().min(0).max(2),
  conditionLp: z.number().min(0).max(2),
  conditionMp: z.number().min(0).max(2),
  conditionHp: z.number().min(0).max(2),
  conditionDmg: z.number().min(0).max(2),
  defaultPrice: z.number().min(0),
  costPriceRatio: z.number().min(0).max(1),
  isPublished: z.boolean(),
  visibleInListings: z.boolean(),
  isAvailableForPurchase: z.boolean(),
  trackInventory: z.boolean(),
  importableSetTypes: z.array(z.string()).min(1),
  physicalOnly: z.boolean(),
});

export const settingsRouter = router({
  getSettings: protectedClientProcedure.query(async ({ ctx }) => {
    let settings = await ctx.prisma.importSettings.findUnique({
      where: { installationId: ctx.installationId },
    });

    if (!settings) {
      settings = await ctx.prisma.importSettings.create({
        data: { installationId: ctx.installationId },
      });
      logger.info("Created default import settings", {
        installationId: ctx.installationId,
      });
    }

    return settings;
  }),

  updateSettings: protectedClientProcedure
    .input(importSettingsSchema.partial())
    .mutation(async ({ ctx, input }) => {
      const settings = await ctx.prisma.importSettings.upsert({
        where: { installationId: ctx.installationId },
        update: input,
        create: {
          installationId: ctx.installationId,
          ...input,
        },
      });

      logger.info("Import settings updated", {
        installationId: ctx.installationId,
        fields: Object.keys(input),
      });

      return settings;
    }),

  getSaleorOptions: protectedClientProcedure.query(async ({ ctx }) => {
    const client = ctx.apiClient!;

    const [channelsResult, productTypesResult, categoriesResult, warehousesResult] =
      await Promise.allSettled([
        client.query(CHANNELS_QUERY, {}).toPromise(),
        client.query(PRODUCT_TYPES_QUERY, { filter: {} }).toPromise(),
        client.query(CATEGORIES_QUERY, { filter: {} }).toPromise(),
        client.query(WAREHOUSES_QUERY, {}).toPromise(),
      ]);

    const channels: SaleorChannel[] =
      channelsResult.status === "fulfilled"
        ? channelsResult.value.data?.channels ?? []
        : [];

    const productTypes: SaleorProductType[] =
      productTypesResult.status === "fulfilled"
        ? (productTypesResult.value.data?.productTypes?.edges ?? []).map(
            (e: { node: SaleorProductType }) => e.node
          )
        : [];

    const categories: SaleorCategory[] =
      categoriesResult.status === "fulfilled"
        ? (categoriesResult.value.data?.categories?.edges ?? []).map(
            (e: { node: SaleorCategory }) => e.node
          )
        : [];

    const warehouses: SaleorWarehouse[] =
      warehousesResult.status === "fulfilled"
        ? (warehousesResult.value.data?.warehouses?.edges ?? []).map(
            (e: { node: SaleorWarehouse }) => e.node
          )
        : [];

    return { channels, productTypes, categories, warehouses };
  }),

  createChannel: protectedClientProcedure
    .input(
      z.object({
        name: z.string().min(1),
        slug: z.string().min(1),
        currencyCode: z.string().min(3).max(3).default("USD"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.apiClient!
        .mutation(CHANNEL_CREATE_MUTATION, {
          input: {
            name: input.name,
            slug: input.slug,
            currencyCode: input.currencyCode,
          },
        })
        .toPromise();

      if (result.error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create channel: ${result.error.message}`,
        });
      }

      const data = result.data?.channelCreate;
      if (data?.errors?.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: data.errors.map((e: { message: string }) => e.message).join("; "),
        });
      }

      logger.info("Channel created", { slug: input.slug });
      return data.channel as SaleorChannel;
    }),

  createProductType: protectedClientProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.apiClient!
        .mutation(PRODUCT_TYPE_CREATE_MUTATION, {
          input: { name: input.name },
        })
        .toPromise();

      if (result.error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create product type: ${result.error.message}`,
        });
      }

      const data = result.data?.productTypeCreate;
      if (data?.errors?.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: data.errors.map((e: { message: string }) => e.message).join("; "),
        });
      }

      logger.info("Product type created", { name: input.name });
      return data.productType as SaleorProductType;
    }),

  createCategory: protectedClientProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.apiClient!
        .mutation(CATEGORY_CREATE_MUTATION, {
          input: { name: input.name },
        })
        .toPromise();

      if (result.error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create category: ${result.error.message}`,
        });
      }

      const data = result.data?.categoryCreate;
      if (data?.errors?.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: data.errors.map((e: { message: string }) => e.message).join("; "),
        });
      }

      logger.info("Category created", { name: input.name });
      return data.category as SaleorCategory;
    }),

  createWarehouse: protectedClientProcedure
    .input(
      z.object({
        name: z.string().min(1),
        companyName: z.string().optional(),
        streetAddress1: z.string().min(1).default("123 Main St"),
        city: z.string().min(1).default("Default City"),
        country: z.string().min(2).max(2).default("US"),
        postalCode: z.string().default("00000"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.apiClient!
        .mutation(WAREHOUSE_CREATE_MUTATION, {
          input: {
            name: input.name,
            companyName: input.companyName,
            address: {
              streetAddress1: input.streetAddress1,
              city: input.city,
              country: input.country,
              postalCode: input.postalCode,
            },
          },
        })
        .toPromise();

      if (result.error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create warehouse: ${result.error.message}`,
        });
      }

      const data = result.data?.warehouseCreate;
      if (data?.errors?.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: data.errors.map((e: { message: string }) => e.message).join("; "),
        });
      }

      logger.info("Warehouse created", { name: input.name });
      return data.warehouse as SaleorWarehouse;
    }),
});
