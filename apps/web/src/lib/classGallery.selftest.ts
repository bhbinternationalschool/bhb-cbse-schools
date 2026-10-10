import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  albumVisibleTo,
  classGalleryDriveFolder,
  classGalleryFileProblem,
  classGalleryPath,
  classGalleryType,
  cleanEventName,
  CLASS_GALLERY_TYPES,
} from "./classGallery";

console.log("classGallery.selftest.ts");

/**
 * Class gallery: a class teacher's photos and videos are seen only by that
 * class's families (and staff), stored privately, and copied to Drive under
 * Class gallery / year / class / event.
 */

// ── Who sees an album ─────────────────────────────────────────────────────
const parentOf = (...secs: string[]) => ({ staff: false as const, sections: new Set(secs) });
assert.equal(albumVisibleTo({ sectionIds: [] }, parentOf("c3|A")), true, "a school-wide album: everyone");
assert.equal(albumVisibleTo({}, parentOf()), true, "an old album (no field): school-wide as before");
assert.equal(albumVisibleTo({ sectionIds: ["c3|A"] }, parentOf("c3|A")), true, "that class's family");
assert.equal(albumVisibleTo({ sectionIds: ["c3|A"] }, parentOf("c3|B")), false, "another section of the same class: no");
assert.equal(albumVisibleTo({ sectionIds: ["c3|A"] }, parentOf("c4|A", "c3|A")), true, "siblings: any child's class");
assert.equal(albumVisibleTo({ sectionIds: ["c3|A"] }, parentOf()), false, "a family with no child on roll: no");
assert.equal(albumVisibleTo({ sectionIds: ["c3|A"] }, { staff: true }), true, "staff: yes");

// ── Files ──────────────────────────────────────────────────────────────────
assert.equal(classGalleryType("", "IMG_1234.JPG"), "image/jpeg", "type from the name when the phone gives none");
assert.equal(classGalleryType("video/mp4", "x"), "video/mp4");
assert.equal(classGalleryType("", "clip.mov"), "video/quicktime");
assert.equal(classGalleryType("application/pdf", "a.pdf"), "", "not a photo or video");
assert.equal(classGalleryFileProblem("image/jpeg", 2_000_000), "");
assert.match(classGalleryFileProblem("video/mp4", 150 * 1024 * 1024), /limit is 100 MB/);
assert.match(classGalleryFileProblem("image/jpeg", 20 * 1024 * 1024), /limit is 15 MB/);
assert.match(classGalleryFileProblem("", 10), /Only photos/);
assert.equal(CLASS_GALLERY_TYPES["video/mp4"]!.maxBytes, 100 * 1024 * 1024);

// ── Paths and folders ──────────────────────────────────────────────────────
assert.equal(classGalleryPath("cls_x|sec_a", "alb_1", "pho_2", "jpg"), "cls_x_sec_a/alb_1/pho_2.jpg", "no '|' or '..' in a storage key");
assert.equal(classGalleryPath("../x|y", "a", "b", "mp4").includes(".."), false);
assert.deepEqual(classGalleryDriveFolder("2026-27", "Class III-A", "Sports day / prize"), ["Class gallery", "2026-27", "Class III-A", "Sports day - prize"]);
assert.equal(cleanEventName("   "), "");

// ── Wiring ─────────────────────────────────────────────────────────────────
const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const albums = read("../app/api/v1/gallery/albums/route.ts");
assert.ok(/fetchGalleryDeskFromDb\(\)/.test(albums) && /albumVisibleTo\(a, viewer\)/.test(albums), "parents get only their children's classes' albums, read from the tables");
const media = read("../app/api/v1/gallery/media/[id]/route.ts");
assert.ok(/albumVisibleTo\(\{ sectionIds: media\.sectionIds \}/.test(media) && /This photo is for another class's families/.test(media), "every file request is checked");
assert.ok(/createSignedUrl\(path, 10 \* 60\)/.test(read("classGallery.server.ts")), "links last ten minutes and are never stored");
const server = read("classGallery.server.ts");
assert.ok(/assertMaySection\(ctx, album\.sectionIds!\[0\]!\)/.test(server), "only that class's teacher (or leadership) adds");
assert.ok(/opts\.path !== classGalleryPath\(/.test(server), "only a path the server issued is recorded");
assert.ok(/classGalleryDriveFolder\(album\.academicYearCode, album\.classLabel/.test(server), "Drive: Class gallery / year / class / event");
assert.ok(/\.eq\("section_ids", "\{\}"\)/.test(read("../app/api/website/publishable/route.ts")), "never on the website");
assert.ok(/!a\.sectionIds\?\.length/.test(read("../components/parent/ParentCommsPortal.tsx")), "not in the web parent portal's school albums");
const comms = read("schoolCommsNormalized.server.ts");
assert.ok(/keepStoredAudience\(sb, tenantId, rows\)/.test(comms), "a save from an older browser keeps a class album's audience");
assert.ok(/section_ids: Array\.isArray\(a\.sectionIds\) \? a\.sectionIds : undefined/.test(comms));
assert.ok(/features\.push\("class_gallery"\)/.test(read("../app/api/v1/staff/features/route.ts")), "class teachers get the tile");
const mig = readFileSync(join(__dirname, "../../../../supabase/migrations/20261010210000_class_gallery_bucket.sql"), "utf8");
assert.ok(/'class-gallery',\s*'class-gallery',\s*false/.test(mig), "the bucket is private");
for (const t of Object.keys(CLASS_GALLERY_TYPES)) assert.ok(mig.includes(`'${t}'`), `bucket allows ${t}`);

console.log("classGallery.selftest: all assertions passed");
