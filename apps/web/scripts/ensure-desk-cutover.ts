#!/usr/bin/env npx tsx
/**
 * Automated desk cutover — backfill blobs → desk, seed defaults, validate.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/ensure-desk-cutover.ts
 *   cd apps/web && npx tsx scripts/ensure-desk-cutover.ts --validate-only
 */

import { loadEnvLocal } from "./lib/loadEnvLocal";

loadEnvLocal();

async function main() {
  const validateOnly = process.argv.includes("--validate-only");

  if (!validateOnly) {
    const { ensureDeskCutoverServer } = await import(
      "../src/lib/ensureDeskCutover.server"
    );
    const result = await ensureDeskCutoverServer();
    console.log("\n=== Desk ensure actions ===\n");
    for (const a of result.actions) {
      if (a.action === "skip") continue;
      console.log(`${a.module.padEnd(22)} ${a.action.padEnd(10)} ${a.detail}`);
    }
    if (!result.actions.some((a) => a.action !== "skip")) {
      console.log("(no changes needed)");
    }
  }

  const { execSync } = await import("node:child_process");
  execSync("npx tsx scripts/validate-desk-cutover.ts", {
    stdio: "inherit",
    cwd: process.cwd(),
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
