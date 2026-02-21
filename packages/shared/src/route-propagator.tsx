import { actions, useAppBridge } from "@saleor/app-sdk/app-bridge";
import { useRouter } from "next/router";
import { useEffect } from "react";

/**
 * BasePath-aware RoutePropagator.
 *
 * The standard @saleor/app-sdk RoutePropagator passes the URL from
 * Next.js router.events.routeChangeComplete directly to the Dashboard.
 * In Next.js, that URL includes the basePath (e.g., /apps/mtg-import/import/new).
 *
 * When the Dashboard refreshes, it appends this route to the app's appUrl,
 * doubling the basePath and resulting in a 404.
 *
 * This component strips the basePath before dispatching to avoid the issue.
 * When basePath is not set, behavior is identical to the SDK's RoutePropagator.
 */
export function RoutePropagator() {
  const { appBridge, appBridgeState } = useAppBridge();
  const router = useRouter();
  const basePath = router.basePath || "";

  useEffect(() => {
    if (!appBridgeState?.ready || !appBridge) {
      return;
    }

    const handleRouteChange = (url: string) => {
      /*
       * Next.js routeChangeComplete includes basePath in the URL.
       * Strip it so the Dashboard doesn't double-prefix on refresh.
       */
      const route = basePath && url.startsWith(basePath) ? url.slice(basePath.length) || "/" : url;

      appBridge.dispatch(actions.UpdateRouting({ newRoute: route })).catch(() => {
        // Silently ignore dispatch errors (mirrors SDK behavior)
      });
    };

    router.events.on("routeChangeComplete", handleRouteChange);

    return () => {
      router.events.off("routeChangeComplete", handleRouteChange);
    };
  }, [appBridgeState, appBridge, basePath, router.events]);

  return null;
}
