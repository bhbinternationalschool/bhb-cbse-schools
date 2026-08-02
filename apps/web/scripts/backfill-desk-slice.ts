#!/usr/bin/env npx tsx
/**
 * Backfill desk slices from jsonb blob for secondary modules.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/backfill-desk-slice.ts rbac
 *   cd apps/web && npx tsx scripts/backfill-desk-slice.ts all
 */

import type { DeskModuleId } from "../src/lib/deskCutover";
import { DESK_SLICE_MODULE_DEFS, deskSliceDef } from "../src/lib/deskSliceRegistry";
import { fetchServerBlob } from "../src/lib/serverBlob";
import {
  fetchDeskSliceFromDb,
  pushDeskSliceToDb,
} from "../src/lib/deskSliceNormalized.server";

async function backfillOne(id: DeskModuleId) {
  const def = deskSliceDef(id);
  if (!def) {
    console.error(`Unknown module: ${id}`);
    return false;
  }
  const blob = await fetchServerBlob<{ version: number } & Record<string, unknown>>(
    def.blobTable,
  );
  if (!blob.state) {
    console.log(`${id}: no blob — skipped`);
    return true;
  }
  const before = await fetchDeskSliceFromDb(id);
  const result = await pushDeskSliceToDb(id, blob.state);
  if (!result.ok) {
    console.error(`${id}: backfill failed`, result.error);
    return false;
  }
  const after = await fetchDeskSliceFromDb(id);
  console.log(
    `${id}: OK — ${before.meta?.sliceCount ?? 0} → ${after.meta?.sliceCount ?? 0} slices`,
  );
  return true;
}

async function main() {
  const arg = process.argv[2] || "all";
  const ids: DeskModuleId[] =
    arg === "all"
      ? DESK_SLICE_MODULE_DEFS.map((d) => d.id)
      : [arg as DeskModuleId];

  let ok = true;
  for (const id of ids) {
    if (!(await backfillOne(id))) ok = false;
  }
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
