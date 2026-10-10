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
  bucketCopyDue,
  CLASS_GALLERY_KEEP_DAYS,
  parentMaySee,
  parseModerationVerdict,
  reviewStatusOf,
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
assert.equal(classGalleryFileProblem("video/mp4", 450 * 1024 * 1024), "", "a five-minute video fits");
assert.match(classGalleryFileProblem("video/mp4", 600 * 1024 * 1024), /limit is 500 MB \(about 5 minutes\)/);
assert.match(classGalleryFileProblem("image/jpeg", 20 * 1024 * 1024), /limit is 15 MB/);
assert.match(classGalleryFileProblem("", 10), /Only photos/);
assert.equal(CLASS_GALLERY_TYPES["video/mp4"]!.maxBytes, 500 * 1024 * 1024);

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
const review = read("classGalleryReview.server.ts");
assert.ok(/classGalleryDriveFolder\(album\.academicYearCode, album\.classLabel/.test(review), "Drive: Class gallery / year / class / event");
assert.ok(/if \(photo\.reviewStatus !== "ok" \|\| !photo\.storagePath\) return false/.test(review), "only a passed item goes to Drive");
assert.ok(/review_status: "pending"/.test(server) && /reviewClassItem\(opts\.photoId, deadline\)/.test(server), "an upload starts pending and is checked");
assert.ok(/attempts \+ 1 < REVIEW_MAX_ATTEMPTS\) return "pending"/.test(review) && /"The AI check could not run/.test(review), "an AI that cannot answer never passes an item");
assert.ok(/\.eq\("review_attempts", attempts\)/.test(review), "one checker at a time");
assert.ok(/settle\(photoId, "removed"/.test(review) && /storage\.from\(CLASS_GALLERY_BUCKET\)\.remove/.test(review), "remove deletes the file, keeps the row");
assert.ok(/!p\.url \|\| !parentMaySee\(p\)/.test(albums), "albums list only passed items");
assert.ok(/media\.reviewStatus === "ok"/.test(media), "a parent's file request needs a passed item");
assert.ok(/review_status: p\.storagePath \? "pending" : "ok"/.test(read("schoolCommsNormalized.server.ts")), "a desk save never passes a class item");
assert.ok(/postableSections\(ctx\)\)\.unrestricted/.test(read("../app/api/v1/staff/class-gallery/review/route.ts")), "only leadership decides");
assert.ok(/sweepClassGallery\(/.test(read("../app/api/comms/scheduled-publish/tick/route.ts")), "the tick finishes checks");

// The verdict: only a clear "ok" passes.
assert.deepEqual(parseModerationVerdict('{"verdict":"ok","reason":"x"}'), { verdict: "ok", reason: "" });
assert.deepEqual(parseModerationVerdict('{"verdict":"hold","reason":"Child changing clothes"}'), { verdict: "hold", reason: "Child changing clothes" });
assert.equal(parseModerationVerdict('{"verdict":"hold"}')!.reason, "Flagged by the AI check");
assert.equal(parseModerationVerdict('{"verdict":"maybe"}'), null);
assert.equal(parseModerationVerdict("not json"), null);
assert.equal(parseModerationVerdict(""), null);
assert.equal(parentMaySee({ reviewStatus: "pending" }), false);
assert.equal(parentMaySee({ reviewStatus: "held" }), false);
assert.equal(parentMaySee({ reviewStatus: "removed" }), false);
assert.equal(parentMaySee({ reviewStatus: "ok" }), true);
assert.equal(parentMaySee({}), true, "school-wide photos from before the check");
assert.equal(reviewStatusOf("held"), "held");
assert.equal(reviewStatusOf(undefined), "ok");
assert.ok(/\.eq\("section_ids", "\{\}"\)/.test(read("../app/api/website/publishable/route.ts")), "never on the website");
assert.ok(/!a\.sectionIds\?\.length/.test(read("../components/parent/ParentCommsPortal.tsx")), "not in the web parent portal's school albums");
const comms = read("schoolCommsNormalized.server.ts");
assert.ok(/keepStoredAudience\(sb, tenantId, rows\)/.test(comms), "a save from an older browser keeps a class album's audience");
assert.ok(/section_ids: Array\.isArray\(a\.sectionIds\) \? a\.sectionIds : undefined/.test(comms));
assert.ok(/features\.push\("class_gallery"\)/.test(read("../app/api/v1/staff/features/route.ts")), "class teachers get the tile");
const mig = readFileSync(join(__dirname, "../../../../supabase/migrations/20261010210000_class_gallery_bucket.sql"), "utf8");
assert.ok(/'class-gallery',\s*'class-gallery',\s*false/.test(mig), "the bucket is private");
for (const t of Object.keys(CLASS_GALLERY_TYPES)) assert.ok(mig.includes(`'${t}'`), `bucket allows ${t}`);
assert.ok(/524288000/.test(mig), "the bucket takes a 500 MB video");
assert.ok(/review_status text not null default 'ok'/.test(mig), "items before the check stay visible");

// 30 days in the bucket, then Drive — never the only copy.
assert.equal(CLASS_GALLERY_KEEP_DAYS, 30);
const day = 86_400_000;
const t0 = Date.parse("2026-10-10T00:00:00Z");
const item = (days: number, extra: Record<string, unknown> = {}) => ({ uploadedAt: new Date(t0 - days * day).toISOString(), reviewStatus: "ok" as const, ...extra });
assert.equal(bucketCopyDue(item(31), true, t0), true, "past 30 days with a Drive copy: goes");
assert.equal(bucketCopyDue(item(29), true, t0), false, "inside 30 days: stays");
assert.equal(bucketCopyDue(item(90), false, t0), false, "no Drive copy: the only copy is never deleted");
assert.equal(bucketCopyDue(item(90, { reviewStatus: "held" }), true, t0), false, "a held item waits for the principal");
assert.equal(bucketCopyDue(item(90, { storageEvicted: true }), true, t0), false, "already gone");
assert.equal(bucketCopyDue({ uploadedAt: "", reviewStatus: "ok" }, true, t0), false, "no date: stays");
assert.ok(/\.is\("storage_evicted_at", null\)/.test(review) && /onDrive\.has\(/.test(review), "eviction needs a confirmed Drive copy");
assert.ok(/media\.evicted/.test(media) && /fromDrive\(media\.driveFileId, request\)/.test(media), "old items are served from Drive");
assert.ok(/verifyClassMediaLink\(id, q\.get\("exp"\), q\.get\("sig"\)\)/.test(media), "the player's link is signed");
assert.ok(/storage_evicted_at timestamptz/.test(mig));

console.log("classGallery.selftest: all assertions passed");
