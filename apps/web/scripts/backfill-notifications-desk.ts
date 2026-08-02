#!/usr/bin/env npx tsx
/**
 * Backfill notifications_desk_* from notifications_state blob.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/backfill-notifications-desk.ts
 */

import { fetchServerBlob } from "../src/lib/serverBlob";
import type { NotificationsState } from "../src/lib/notifications";
import {
  fetchNotificationsDeskFromDb,
  pushNotificationsDeskToDb,
} from "../src/lib/notificationsNormalized.server";

async function main() {
  const blob = await fetchServerBlob<NotificationsState>("notifications_state");
  if (!blob.state?.items?.length) {
    console.log("No blob data — run seed-notifications-desk.ts instead");
    process.exit(0);
  }

  const before = await fetchNotificationsDeskFromDb();
  console.log(`Desk before: ${before.bundle.items.length}, blob: ${blob.state.items.length}`);

  const result = await pushNotificationsDeskToDb(blob.state);
  if (!result.ok) {
    console.error("Backfill failed:", result.error);
    process.exit(1);
  }

  const after = await fetchNotificationsDeskFromDb();
  console.log(`Backfill OK — desk now ${after.bundle.items.length} items`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
