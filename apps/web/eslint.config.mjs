import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    // Dev-only QA harnesses and one-off scripts: these stub globals
    // (globalThis.window/localStorage) and narrow string literals to tag
    // unions, where `any` is the pragmatic choice. Shipped code under
    // src/ keeps the strict rule.
    files: ["scripts/**/*.{ts,mts,mjs,js}", "src/**/*.selftest.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default eslintConfig;
