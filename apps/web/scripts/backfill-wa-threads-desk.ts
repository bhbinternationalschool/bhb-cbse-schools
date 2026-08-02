#!/usr/bin/env npx tsx
/** Backfill wa_desk_bot_slices from wa_bot_threads_state blob. */
import type { WaBotPersistBundle } from "../src/lib/waBotStore.server";
import { fetchServerBlob } from "../src/lib/serverBlob";
import {
  fetchWaThreadsDeskFromDb,
  pushWaThreadsDeskToDb,
} from "../src/lib/waThreadsNormalized.server";

async function main() {
  const remote = await fetchServerBlob<WaBotPersistBundle>("wa_bot_threads_state");
  if (!remote.state?.version) {
    console.log("No blob state — nothing to backfill");
    return;
  }
  const before = await fetchWaThreadsDeskFromDb();
  console.log(`Desk before: ${before.meta?.sliceCount ?? 0} slices`);
  const result = await pushWaThreadsDeskToDb(remote.state);
  if (!result.ok) {
    console.error("Backfill failed:", result.error);
    process.exit(1);
  }
  const after = await fetchWaThreadsDeskFromDb();
  console.log(
    `Backfill OK — ${after.meta?.sliceCount ?? 0} slices, ${after.meta?.threadCount ?? 0} threads`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
