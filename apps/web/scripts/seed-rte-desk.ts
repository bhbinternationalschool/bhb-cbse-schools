#!/usr/bin/env npx tsx
/**
 * Seed rte_desk_* — default RTE settings row.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-rte-desk.ts
 */

import { emptyRteState } from "../src/lib/rteEws";
import {
  fetchRteDeskFromDb,
  pushRteDeskToDb,
} from "../src/lib/rteNormalized.server";

async function main() {
  const state = emptyRteState();

  console.log("Seeding RTE desk settings (25% mandated quota)");

  const before = await fetchRteDeskFromDb();
  console.log(
    `DB before: ${before.bundle.seats.length} seats, ${before.bundle.applications.length} applications`,
  );

  const result = await pushRteDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchRteDeskFromDb();
  console.log(
    `Seed OK — settings mandatedPct=${after.bundle.settings.mandatedPct}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
