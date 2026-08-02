#!/usr/bin/env npx tsx
/**
 * Backfill transport_desk_* from transport_state blob.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/backfill-transport-desk.ts
 */

import { fetchServerBlob } from "../src/lib/serverBlob";
import type { TransportState } from "../src/lib/transport";
import {
  fetchTransportDeskFromDb,
  pushTransportDeskToDb,
} from "../src/lib/transportNormalized.server";

async function main() {
  const blob = await fetchServerBlob<TransportState>("transport_state");
  if (
    !blob.state ||
    ((blob.state.routes?.length ?? 0) === 0 &&
      (blob.state.vehicles?.length ?? 0) === 0)
  ) {
    console.log("No transport blob — run seed-transport-desk.ts instead");
    process.exit(0);
  }

  const before = await fetchTransportDeskFromDb();
  console.log(
    `Desk before: ${before.bundle.routes.length} routes; blob: ${blob.state.routes?.length ?? 0} routes`,
  );

  const result = await pushTransportDeskToDb(blob.state);
  if (!result.ok) {
    console.error("Backfill failed:", result.error);
    process.exit(1);
  }

  const after = await fetchTransportDeskFromDb();
  console.log(
    `Backfill OK — desk now ${after.bundle.routes.length} routes, ${after.meta?.sliceCount ?? 0} slices`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
