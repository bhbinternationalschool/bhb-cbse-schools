#!/usr/bin/env npx tsx
/**
 * Seed school_comms_desk_* — welcome notice + news item.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-school-comms-desk.ts
 */

import { DEFAULT_AY } from "../src/lib/masters";
import { TENANT } from "../src/lib/types";
import type {
  SchoolCommsState,
  SchoolNewsItem,
  SchoolNotice,
} from "../src/lib/schoolComms";
import {
  fetchSchoolCommsDeskFromDb,
  pushSchoolCommsDeskToDb,
} from "../src/lib/schoolCommsNormalized.server";

function nowIso(): string {
  return new Date().toISOString();
}

async function main() {
  const now = nowIso();
  const notices: SchoolNotice[] = [
    {
      id: "ntc_seed_welcome",
      title: `Welcome to ${TENANT.nameDisplay}`,
      body: "Circulars and school notices will appear here for staff and parents.",
      audience: "all",
      status: "published",
      pinned: true,
      academicYearCode: DEFAULT_AY,
      publishedAt: now,
      createdAt: now,
      createdBy: "seed-school-comms-desk",
      updatedAt: now,
    },
  ];
  const news: SchoolNewsItem[] = [
    {
      id: "nws_seed_highlights",
      title: "School year highlights",
      summary: "Stay tuned for events, achievements and campus updates.",
      body: "This is your school news feed. Office can publish stories with optional cover images.",
      coverUrl: "",
      status: "published",
      academicYearCode: DEFAULT_AY,
      publishedAt: now,
      createdAt: now,
      createdBy: "seed-school-comms-desk",
      updatedAt: now,
    },
  ];

  const state: SchoolCommsState = {
    version: 1,
    notices,
    news,
    albums: [],
    photos: [],
  };

  console.log(`Seeding ${notices.length} notices, ${news.length} news items`);

  const before = await fetchSchoolCommsDeskFromDb();
  console.log(`DB before: ${before.bundle.notices.length} notices`);

  const result = await pushSchoolCommsDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchSchoolCommsDeskFromDb();
  console.log(
    `Seed OK — DB now ${after.bundle.notices.length} notices, ${after.bundle.news.length} news`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
