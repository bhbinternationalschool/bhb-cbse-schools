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
    // `no-html-link-for-pages` stopped being able to tell a page from an
    // API route the moment the public website gained its root catch-all
    // (src/app/[...slug]/page.tsx). Every path now resolves to a page, so
    // the rule flags anchors that MUST stay anchors:
    //
    //   - the OAuth redirects to /api/integrations/.../connect — a <Link>
    //     would client-navigate and the redirect would never happen;
    //   - the escape hatches in (erp)/error.tsx and not-found.tsx, where a
    //     full reload is the point, because the client state is the thing
    //     that broke.
    //
    // It reported six errors, none of them a real defect. Turned off rather
    // than silenced line by line, so the next deliberate anchor does not
    // have to argue with it too.
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
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
