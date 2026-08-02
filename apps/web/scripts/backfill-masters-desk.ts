#!/usr/bin/env npx tsx
/**
 * Backfill masters_desk_* from school_mirror_state.masters blob slice.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/backfill-masters-desk.ts
 */

import type { MastersState } from "../src/lib/masters";
import { fetchServerBlob } from "../src/lib/serverBlob";
import {
  fetchMastersDeskFromDb,
  pushMastersDeskToDb,
} from "../src/lib/mastersNormalized.server";

async function main() {
  const blob = await fetchServerBlob<{ masters?: MastersState }>(
    "school_mirror_state",
  );
  const masters = blob.state?.masters;
  if (
    !masters ||
    ((masters.classes?.length ?? 0) === 0 &&
      (masters.feeHeads?.length ?? 0) === 0)
  ) {
    console.log("No masters mirror slice — run seed-masters-desk.ts instead");
    process.exit(0);
  }

  const before = await fetchMastersDeskFromDb();
  console.log(
    `Desk before: ${before.meta?.sliceCount ?? 0} slices; blob: ${masters.classes?.length ?? 0} classes, ${masters.feeHeads?.length ?? 0} fee heads`,
  );

  const result = await pushMastersDeskToDb(masters);
  if (!result.ok) {
    console.error("Backfill failed:", result.error);
    process.exit(1);
  }

  const after = await fetchMastersDeskFromDb();
  console.log(
    `Backfill OK — desk now ${after.meta?.sliceCount ?? 0} slices, ${after.bundle.classes.length} classes`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
