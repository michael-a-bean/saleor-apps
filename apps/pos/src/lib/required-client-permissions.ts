import { Permission } from "@saleor/app-sdk/types";
import { REQUIRED_SALEOR_PERMISSIONS } from "@saleor/apps-shared/permissions";

export const REQUIRED_CLIENT_PERMISSIONS: Permission[] = [
  ...REQUIRED_SALEOR_PERMISSIONS,
  "MANAGE_PRODUCTS", // Required for stock operations
  "MANAGE_ORDERS", // Required for creating draft orders and marking as paid
  "MANAGE_USERS", // Required for customer lookup/creation
  "HANDLE_PAYMENTS", // Required for payment processing
];
