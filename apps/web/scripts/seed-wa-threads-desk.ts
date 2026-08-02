#!/usr/bin/env npx tsx
/**
 * Seed wa_desk_bot_slices — sample CRM admission bot thread.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-wa-threads-desk.ts
 */

import type { WaBotPersistBundle } from "../src/lib/waBotStore.server";
import type { WaCrmBotStore } from "../src/lib/waCrmBotServer";
import {
  fetchWaThreadsDeskFromDb,
  pushWaThreadsDeskToDb,
} from "../src/lib/waThreadsNormalized.server";

function nowIso(): string {
  return new Date().toISOString();
}

async function main() {
  const at = nowIso();
  const crm: WaCrmBotStore = {
    version: 1,
    threads: [
      {
        id: "wat_seed_demo",
        channel: "whatsapp",
        audience: "crm_admission_parent",
        mobile: "9876543210",
        parentName: "Demo Parent",
        status: "bot",
        messages: [
          {
            id: "wam_seed_1",
            role: "parent",
            text: "Hi, I want admission details for Class 6",
            at,
            by: "9876543210",
          },
          {
            id: "wam_seed_2",
            role: "bot",
            text: "Welcome to BHB International. Share your child name and class.",
            at,
            by: "crm-bot",
          },
        ],
        createdAt: at,
        updatedAt: at,
        unreadStaff: 1,
      },
    ],
  };

  const bundle: WaBotPersistBundle = {
    version: 1,
    updatedAt: at,
    crm,
    sis: null,
    survey: null,
    classChannel: null,
    unified: null,
    hub: null,
    staffAtt: null,
  };

  console.log(`Seeding CRM slice with ${crm.threads.length} thread(s)`);

  const before = await fetchWaThreadsDeskFromDb();
  console.log(`DB before: ${before.meta?.sliceCount ?? 0} slices`);

  const result = await pushWaThreadsDeskToDb(bundle);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchWaThreadsDeskFromDb();
  console.log(
    `Seed OK — DB now ${after.meta?.sliceCount ?? 0} slices, ${after.meta?.threadCount ?? 0} threads`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
