import { FileAPL } from "@saleor/app-sdk/APL/file";
import { SaleorApp } from "@saleor/app-sdk/saleor-app";

/*
 * For local development and production, we use FileAPL
 * The app installation state is persisted in data/.saleor-app-auth.json
 * The data directory is mounted as a Docker volume for persistence
 */
export const apl = new FileAPL({
  fileName: "data/.saleor-app-auth.json",
});

export const saleorApp = new SaleorApp({
  apl,
});
