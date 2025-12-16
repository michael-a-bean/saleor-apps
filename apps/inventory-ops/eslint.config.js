import { config } from "@saleor/eslint-config-apps/index.js";
import nodePlugin from "eslint-plugin-n";

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    name: "saleor-app-inventory-ops/custom-config",
    files: ["**/*.ts"],
    plugins: {
      n: nodePlugin,
    },
    rules: {
      "n/no-process-env": "error",
    },
  },
  {
    name: "saleor-app-inventory-ops/override-no-process-env",
    files: [
      "next.config.ts",
      "src/lib/env.ts",
      "src/__tests__/**/*setup.*.ts",
    ],
    rules: {
      "n/no-process-env": "off",
      "turbo/no-undeclared-env-vars": "off",
    },
  },
  {
    name: "saleor-app-inventory-ops/override-turbo-env-requirement",
    files: ["src/__tests__/**", "*.test.ts"],
    rules: {
      "turbo/no-undeclared-env-vars": "off",
    },
  },
  {
    name: "saleor-app-inventory-ops/allow-console-in-tests",
    files: ["src/__tests__/**", "*.test.ts"],
    rules: {
      "no-console": "off",
    },
  },
];
