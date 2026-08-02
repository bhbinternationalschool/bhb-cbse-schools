#!/usr/bin/env npx tsx
/**
 * Backfill rte_desk_* from rte_state blob.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/backfill-rte-desk.ts
 */

import { fetchServerBlob } from "../src/lib/serverBlob";
import type { RteState } from "../src/lib/rteEws";
import {
  fetchRteDeskFromDb,
  pushRteDeskToDb,
} from "../src/lib/rteNormalized.server";

async function main() {
  const blob = await fetchServerBlob<RteState>("rte_state");
  if (
    !blob.state ||
    ((blob.state.seats?.length ?? 0) === 0 &&
      (blob.state.applications?.length ?? 0) === 0)
  ) {
    console.log("No RTE blob data — run seed-rte-desk.ts instead");
    process.exit(0);
  }

  const before = await fetchRteDeskFromDb();
  console.log(
    `Desk before: ${before.bundle.seats.length} seats, ${before.bundle.applications.length} apps; blob: ${blob.state.seats?.length ?? 0} seats, ${blob.state.applications?.length ?? 0} apps`,
  );

  const result = await pushRteDeskToDb(blob.state);
  if (!result.ok) {
    console.error("Backfill failed:", result.error);
    process.exit(1);
  }

  const after = await fetchRteDeskFromDb();
  console.log(
    `Backfill OK — desk now ${after.bundle.seats.length} seats, ${after.bundle.applications.length} apps`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
