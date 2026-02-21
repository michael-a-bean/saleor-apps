import { Permission } from "@saleor/app-sdk/types";
import { REQUIRED_SALEOR_PERMISSIONS } from "@saleor/apps-shared/permissions";

export const REQUIRED_CLIENT_PERMISSIONS: Permission[] = [
  ...REQUIRED_SALEOR_PERMISSIONS,
  "MANAGE_PRODUCTS", // Required for product creation and variant management
  "MANAGE_PRODUCT_TYPES_AND_ATTRIBUTES", // Required for attribute creation and assignment
];
