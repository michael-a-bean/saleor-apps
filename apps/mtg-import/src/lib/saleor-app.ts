import { APL } from "@saleor/app-sdk/APL";
import { RedisAPL } from "@saleor/app-sdk/APL/redis";
import { SaleorApp } from "@saleor/app-sdk/saleor-app";
import { createClient } from "redis";

import { env } from "./env";
import { createLogger } from "./logger";
import { NormalizedFileAPL } from "./normalized-apl";

const logger = createLogger("saleor-app");

export let apl: APL;

switch (env.APL) {
  case "redis": {
    const redisUrl = env.REDIS_URL;

    if (!redisUrl) {
      throw new Error("APL=redis requires REDIS_URL environment variable");
    }

    logger.info("Using Redis APL", { redisUrl: redisUrl.replace(/\/\/.*@/, "//<redacted>@") });

    const client = createClient({
      url: redisUrl,
    });

    client.on("error", (err) => {
      logger.error("Redis APL connection error", { error: err.message });
    });

    apl = new RedisAPL({
      client,
      hashCollectionKey: "saleor_app_auth_mtg_import",
    });
    break;
  }

  default: {
    logger.info("Using File APL", { fileName: "data/.saleor-app-auth.json" });
    apl = new NormalizedFileAPL({
      fileName: "data/.saleor-app-auth.json",
    });
    break;
  }
}

export const saleorApp = new SaleorApp({
  apl,
});
