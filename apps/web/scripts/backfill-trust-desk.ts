#!/usr/bin/env npx tsx
/**
 * Backfill trust_desk_* from trust_state blob.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/backfill-trust-desk.ts
 */

import { fetchServerBlob } from "../src/lib/serverBlob";
import type { TrustState } from "../src/lib/trust";
import {
  fetchTrustDeskFromDb,
  pushTrustDeskToDb,
} from "../src/lib/trustNormalized.server";

async function main() {
  const blob = await fetchServerBlob<TrustState>("trust_state");
  if (!blob.state?.projects?.length) {
    console.log("No trust blob — run seed-trust-desk.ts instead");
    process.exit(0);
  }

  const before = await fetchTrustDeskFromDb();
  console.log(
    `Desk before: ${before.bundle.projects.length} projects; blob: ${blob.state.projects.length}`,
  );

  const result = await pushTrustDeskToDb(blob.state);
  if (!result.ok) {
    console.error("Backfill failed:", result.error);
    process.exit(1);
  }

  const after = await fetchTrustDeskFromDb();
  console.log(`Backfill OK — desk now ${after.bundle.projects.length} projects`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
