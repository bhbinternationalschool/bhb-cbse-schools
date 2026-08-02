#!/usr/bin/env npx tsx
/**
 * Seed masters_desk_* — default foundation + fee setup (defaultMasters()).
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-masters-desk.ts
 */

import { defaultMasters } from "../src/lib/masters";
import {
  fetchMastersDeskFromDb,
  pushMastersDeskToDb,
} from "../src/lib/mastersNormalized.server";

async function main() {
  const state = defaultMasters();

  const before = await fetchMastersDeskFromDb();
  if ((before.meta?.sliceCount ?? 0) > 0) {
    console.log(
      `Desk already has ${before.meta?.sliceCount ?? 0} slices — use backfill-masters-desk.ts to refresh from mirror.`,
    );
    process.exit(0);
  }

  console.log(
    `Seeding masters desk — ${state.classes.length} class(es), ${state.feeHeads.length} fee head(s), ${state.subjects.length} subject(s)`,
  );

  console.log(
    `DB before: ${before.meta?.sliceCount ?? 0} slices, ${before.bundle.classes.length} classes`,
  );

  const result = await pushMastersDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchMastersDeskFromDb();
  console.log(
    `Seed OK — DB now ${after.meta?.sliceCount ?? 0} slices, ${after.bundle.classes.length} classes, ${after.bundle.feeHeads.length} fee heads`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
