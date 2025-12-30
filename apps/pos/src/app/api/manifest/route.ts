import { createManifestHandler } from "@saleor/app-sdk/handlers/next-app-router";
import { AppManifest } from "@saleor/app-sdk/types";
import { withSpanAttributesAppRouter } from "@saleor/apps-otel/src/with-span-attributes";
import { compose } from "@saleor/apps-shared/compose";

import { env } from "@/lib/env";
import { withLoggerContext } from "@/lib/logger-context";
import packageJson from "@/package.json";

const handler = createManifestHandler({
  async manifestFactory({ appBaseUrl }) {
    const iframeBaseUrl = env.APP_IFRAME_BASE_URL ?? appBaseUrl;
    const apiBaseUrl = env.APP_API_BASE_URL ?? appBaseUrl;

    const manifest: AppManifest = {
      about:
        "Point of Sale app for Saleor - in-store transactions with barcode scanning, cash management, and full COGS integration.",
      appUrl: iframeBaseUrl,
      author: "Saleor Commerce",
      brand: {
        logo: {
          default: `${iframeBaseUrl}/logo.png`,
        },
      },
      dataPrivacyUrl: "https://saleor.io/legal/privacy/",
      extensions: [],
      homepageUrl: "https://github.com/saleor/apps",
      id: env.MANIFEST_APP_ID,
      name: env.APP_NAME,
      /*
       * Required permissions:
       * - MANAGE_PRODUCTS: Query variants by barcode/SKU, check stock
       * - MANAGE_ORDERS: Create draft orders, mark as paid
       * - MANAGE_USERS: Customer lookup and creation
       * - HANDLE_PAYMENTS: Process payments
       */
      permissions: ["MANAGE_PRODUCTS", "MANAGE_ORDERS", "MANAGE_USERS", "HANDLE_PAYMENTS"],
      requiredSaleorVersion: ">=3.21 <4",
      supportUrl: "https://saleor.io/discord",
      tokenTargetUrl: `${apiBaseUrl}/api/register`,
      version: packageJson.version,
      webhooks: [
        // Webhooks will be added as we implement them:
        // - ORDER_FULFILLED: Create POS_SALE cost layer events
        // - ORDER_REFUNDED: Create POS_SALE_RETURN cost layer events
      ],
    };

    return manifest;
  },
});

export const GET = compose(withLoggerContext, withSpanAttributesAppRouter)(handler);
