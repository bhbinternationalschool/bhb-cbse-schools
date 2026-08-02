#!/usr/bin/env npx tsx
/**
 * Seed timetable_desk_* — default bell template + working week.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-timetable-desk.ts
 */

import { emptyTimetableState } from "../src/lib/timetable";
import {
  fetchTimetableDeskFromDb,
  pushTimetableDeskToDb,
} from "../src/lib/timetableNormalized.server";

async function main() {
  const state = emptyTimetableState();

  console.log(
    `Seeding timetable desk — ${state.bellTemplate.length} bell periods, weekdays ${state.workingWeekdays.join(",")}`,
  );

  const before = await fetchTimetableDeskFromDb();
  console.log(`DB before: ${before.meta?.sliceCount ?? 0} slices`);

  const result = await pushTimetableDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchTimetableDeskFromDb();
  console.log(
    `Seed OK — ${after.meta?.sliceCount ?? 0} slices, bell periods ${after.bundle.bellTemplate.length}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
