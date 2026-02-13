import { config } from "@saleor/eslint-config-apps/index.js";
import nodePlugin from "eslint-plugin-n";

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    name: "saleor-app-mtg-import/custom-config",
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      n: nodePlugin,
    },
    rules: {
      "n/no-process-env": "error",
      "padding-line-between-statements": "off",
    },
  },
  {
    name: "saleor-app-mtg-import/override-no-process-env",
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
    name: "saleor-app-mtg-import/override-turbo-env-requirement",
    files: ["src/__tests__/**", "*.test.ts"],
    rules: {
      "turbo/no-undeclared-env-vars": "off",
    },
  },
  {
    name: "saleor-app-mtg-import/allow-console-in-tests",
    files: ["src/__tests__/**", "*.test.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    name: "saleor-app-mtg-import/relaxed-test-rules",
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "vitest/prefer-strict-equal": "warn",
    },
  },
  {
    name: "saleor-app-mtg-import/relaxed-logger-leak",
    files: ["**/*.ts"],
    rules: {
      "@saleor/saleor-app/logger-leak": "warn",
    },
  },
];
