#!/usr/bin/env npx tsx
/**
 * Backfill timetable_desk_* from timetable_state blob.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/backfill-timetable-desk.ts
 */

import { fetchServerBlob } from "../src/lib/serverBlob";
import { normalizeTimetableState } from "../src/lib/timetable";
import {
  fetchTimetableDeskFromDb,
  pushTimetableDeskToDb,
} from "../src/lib/timetableNormalized.server";

async function main() {
  const blob = await fetchServerBlob("timetable_state");
  if (!blob.state) {
    console.log("No timetable blob — run seed-timetable-desk.ts instead");
    process.exit(0);
  }

  const state = normalizeTimetableState(blob.state);

  const before = await fetchTimetableDeskFromDb();
  console.log(
    `Desk before: ${before.meta?.gridCount ?? 0} grids; blob: ${state.grids.length} grids`,
  );

  const result = await pushTimetableDeskToDb(state);
  if (!result.ok) {
    console.error("Backfill failed:", result.error);
    process.exit(1);
  }

  const after = await fetchTimetableDeskFromDb();
  console.log(
    `Backfill OK — desk now ${after.meta?.gridCount ?? 0} grids, ${after.meta?.sliceCount ?? 0} slices`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
