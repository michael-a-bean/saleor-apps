import { AppBridge } from "@saleor/app-sdk/app-bridge";
import { createHttpBatchLink } from "@saleor/apps-trpc/http-batch-link";
import { createTRPCNext } from "@trpc/next";

import { TrpcRouter } from "./trpc-router";

let appBridgeInstance: AppBridge | null = null;

export const setAppBridgeInstance = (instance: AppBridge) => {
  appBridgeInstance = instance;
};

export const trpcClient = createTRPCNext<TrpcRouter>({
  config() {
    return {
      links: [createHttpBatchLink(appBridgeInstance!)],
      queryClientConfig: {
        defaultOptions: {
          queries: {
            refetchOnMount: false,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
          },
        },
      },
    };
  },
  ssr: false,
});
