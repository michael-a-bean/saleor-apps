import { useAppBridge } from "@saleor/app-sdk/app-bridge";
import { Box, Text } from "@saleor/macaw-ui";
import { ReactNode } from "react";

interface AppBridgeReadyProps {
  children: ReactNode;
}

/**
 * Wrapper component that ensures app bridge is ready before rendering children.
 * This is necessary because tRPC calls require the token and API URL from the app bridge.
 */
export const AppBridgeReady = ({ children }: AppBridgeReadyProps) => {
  const { appBridgeState } = useAppBridge();

  if (!appBridgeState?.ready) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" padding={10}>
        <Text>Loading...</Text>
      </Box>
    );
  }

  return <>{children}</>;
};
