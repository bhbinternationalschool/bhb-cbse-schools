#!/usr/bin/env npx tsx
/**
 * Seed gallery desk — demo album in school_comms_desk_albums.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-gallery-desk.ts
 */

import { DEFAULT_AY } from "../src/lib/masters";
import type { GalleryAlbum } from "../src/lib/schoolComms";
import {
  fetchGalleryDeskFromDb,
  pushGalleryDeskToDb,
} from "../src/lib/schoolCommsNormalized.server";

async function main() {
  const now = new Date().toISOString();
  const albums: GalleryAlbum[] = [
    {
      id: "alb_seed_campus",
      title: "Campus life",
      description: "School events and everyday moments.",
      coverUrl: "",
      status: "published",
      academicYearCode: DEFAULT_AY,
      publishedAt: now,
      createdAt: now,
      createdBy: "seed-gallery-desk",
      updatedAt: now,
    },
  ];

  console.log(`Seeding ${albums.length} gallery album(s)`);

  const before = await fetchGalleryDeskFromDb();
  console.log(`DB before: ${before.bundle.albums.length} albums`);

  const result = await pushGalleryDeskToDb({ albums, photos: before.bundle.photos });
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchGalleryDeskFromDb();
  console.log(`Seed OK — DB now ${after.bundle.albums.length} albums`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
