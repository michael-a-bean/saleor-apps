import "@saleor/macaw-ui/style";

import { AppBridge, AppBridgeProvider } from "@saleor/app-sdk/app-bridge";
import { RoutePropagator } from "@saleor/app-sdk/app-bridge/next";
import { GraphQLProvider } from "@saleor/apps-shared/graphql-provider";
import { IframeProtectedFallback } from "@saleor/apps-shared/iframe-protected-fallback";
import { IframeProtectedWrapper } from "@saleor/apps-shared/iframe-protected-wrapper";
import { NoSSRWrapper } from "@saleor/apps-shared/no-ssr-wrapper";
import { ThemeSynchronizer } from "@saleor/apps-shared/theme-synchronizer";
import { Box, ThemeProvider } from "@saleor/macaw-ui";
import { AppProps } from "next/app";

import { setAppBridgeInstance, trpcClient } from "@/modules/trpc/trpc-client";

/**
 * Ensure instance is a singleton.
 */
export const appBridgeInstance = typeof window !== "undefined" ? new AppBridge() : undefined;

if (appBridgeInstance) {
  setAppBridgeInstance(appBridgeInstance);
}

function NextApp({ Component, pageProps }: AppProps) {
  return (
    <NoSSRWrapper>
      <ThemeProvider>
        <IframeProtectedWrapper
          allowedPathNames={[
            "/",
            "/suppliers",
            "/suppliers/new",
            "/purchase-orders",
            "/purchase-orders/new",
            "/goods-receipts",
            "/goods-receipts/new",
          ]}
          fallback={<IframeProtectedFallback appName="Inventory Ops" />}
        >
          <AppBridgeProvider appBridgeInstance={appBridgeInstance}>
            <GraphQLProvider>
              <ThemeSynchronizer />
              <RoutePropagator />
              <Box padding={10}>
                <Component {...pageProps} />
              </Box>
            </GraphQLProvider>
          </AppBridgeProvider>
        </IframeProtectedWrapper>
      </ThemeProvider>
    </NoSSRWrapper>
  );
}

export default trpcClient.withTRPC(NextApp);
