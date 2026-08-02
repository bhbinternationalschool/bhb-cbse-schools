#!/usr/bin/env npx tsx
/**
 * Seed notifications_desk_* — welcome system notification.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-notifications-desk.ts
 */

import { TENANT } from "../src/lib/types";
import type { AppNotification, NotificationsState } from "../src/lib/notifications";
import {
  fetchNotificationsDeskFromDb,
  pushNotificationsDeskToDb,
} from "../src/lib/notificationsNormalized.server";

async function main() {
  const now = new Date().toISOString();
  const items: AppNotification[] = [
    {
      id: "nf_seed_welcome",
      title: `Welcome to ${TENANT.nameDisplay}`,
      body: "Your notification inbox — circulars, fees, homework and system alerts appear here.",
      kind: "system",
      href: "/home",
      audience: "all",
      sourceId: "seed-notifications-desk",
      createdAt: now,
      readBy: [],
    },
  ];

  const state: NotificationsState = { version: 1, items };

  console.log(`Seeding ${items.length} notification(s)`);

  const before = await fetchNotificationsDeskFromDb();
  console.log(`DB before: ${before.bundle.items.length} items`);

  const result = await pushNotificationsDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchNotificationsDeskFromDb();
  console.log(`Seed OK — DB now ${after.bundle.items.length} items`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
