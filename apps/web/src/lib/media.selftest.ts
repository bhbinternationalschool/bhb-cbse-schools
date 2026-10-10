/**
 * The upload contract — what may be stored, where, and what a stored
 * reference is allowed to look like.
 *
 * This exists because of a bug that hid for months. `school-files` is a
 * private bucket, `/api/upload` returned `getPublicUrl()` for it (a link that
 * 403s), and the image pickers answered the resulting failure by writing the
 * file into the database as a base64 `data:` URL and calling it a success.
 * Storage held zero objects the whole time, while a 45 kB favicon sat in
 * masters_desk_slices.schoolProfile as text.
 *
 * Three things have to stay true for that not to come back:
 *   1. a data: URL is never a storable value,
 *   2. a public file and a private file get different kinds of URL, and
 *      neither is a signed URL that expires,
 *   3. the browser's idea of what is allowed matches the server's.
 *
 * Run: npx tsx src/lib/media.selftest.ts
 */
import assert from "node:assert/strict";
import {
  MEDIA_BUCKETS,
  acceptFor,
  bucketFor,
  contentTypeFor,
  isStoredMediaUrl,
  maxBytesFor,
  privateMediaUrl,
  publicMediaUrl,
  sanitizeMediaPath,
  sanitizeStoredMediaUrl,
} from "./media";

// ── The thing this exists to stop ─────────────────────────────────────────
{
  const favicon = "data:image/png;base64," + "A".repeat(45_000);
  assert.equal(
    sanitizeStoredMediaUrl(favicon),
    "",
    "a data: URL is the file itself and must never be stored",
  );
  assert.equal(
    sanitizeStoredMediaUrl("DATA:image/png;base64,iVBOR"),
    "",
    "case does not change what it is",
  );
  assert.equal(
    sanitizeStoredMediaUrl("  data:image/jpeg;base64,abc  "),
    "",
    "nor does surrounding whitespace",
  );
  assert.equal(
    sanitizeStoredMediaUrl("blob:https://app/9f2c-11ee"),
    "",
    "a blob: URL is only valid in the tab that made it",
  );
  assert.equal(isStoredMediaUrl(favicon), false);
}

// ── Real references pass through ──────────────────────────────────────────
{
  const pub =
    "https://ymamhlcrjsuilzdonkzl.supabase.co/storage/v1/object/public/site-media/brand/2026-08-30-a1b2c3.png";
  assert.equal(sanitizeStoredMediaUrl(pub), pub, "a public storage URL is kept");
  assert.equal(
    sanitizeStoredMediaUrl("/api/file/staff/abc/photo.jpg"),
    "/api/file/staff/abc/photo.jpg",
    "our own file route is a URL too",
  );
  assert.equal(sanitizeStoredMediaUrl("/logo.png?v=2"), "/logo.png?v=2");
  assert.equal(isStoredMediaUrl(pub), true);
}

// ── Absent is absent, not an error ────────────────────────────────────────
{
  for (const empty of [undefined, null, "", "   "]) {
    assert.equal(sanitizeStoredMediaUrl(empty), "", "no image is not a fault");
  }
}

// ── Public and private get different URLs, and neither one expires ────────
{
  const supabase = "https://ymamhlcrjsuilzdonkzl.supabase.co";
  const pub = publicMediaUrl(supabase, "brand/crest.png");
  assert.equal(
    pub,
    `${supabase}/storage/v1/object/public/site-media/brand/crest.png`,
    "public files are served straight from the public bucket",
  );
  assert.ok(!pub.includes("token="), "a stored URL must not carry a signature");

  const priv = privateMediaUrl("staff/BHB001/photo.jpg");
  assert.equal(priv, "/api/file/staff/BHB001/photo.jpg");
  assert.ok(
    !priv.includes("supabase"),
    "private files go through our route, which re-checks the session, " +
      "not a Supabase signed URL that stops working after seven days",
  );

  // A trailing slash on the configured URL must not double up.
  assert.equal(
    publicMediaUrl(supabase + "/", "brand/crest.png"),
    pub,
    "the base URL is normalised",
  );
}

// ── Paths cannot climb out of the bucket ──────────────────────────────────
{
  assert.equal(sanitizeMediaPath("/brand/crest.png"), "brand/crest.png");
  assert.equal(
    sanitizeMediaPath("../../etc/passwd"),
    "etc/passwd",
    "a traversal attempt is flattened, not honoured",
  );
  assert.equal(
    sanitizeMediaPath("gallery//sports  day/01.jpg"),
    "gallery/sports__day/01.jpg",
    "spaces become underscores and repeated slashes collapse",
  );
}

// ── The two buckets allow different things, on purpose ────────────────────
{
  assert.equal(contentTypeFor("site-media", "clip.mp4"), "video/mp4");
  assert.equal(
    contentTypeFor("school-files", "clip.mp4"),
    null,
    "video has no business in the bucket holding student records",
  );
  assert.equal(contentTypeFor("site-media", "photo.JPG"), "image/jpeg");
  assert.equal(
    contentTypeFor("site-media", "payload.svg"),
    null,
    "SVG can carry script — not accepted anywhere",
  );
  assert.equal(contentTypeFor("site-media", "noextension"), null);

  assert.equal(bucketFor("public"), "site-media");
  assert.equal(bucketFor("private"), "school-files");
}

// ── Video gets its own, larger limit; stills do not ───────────────────────
{
  const video = maxBytesFor("site-media", "video/mp4");
  const still = maxBytesFor("site-media", "image/jpeg");
  assert.ok(video > still, "a clip may be larger than a photograph");
  assert.equal(
    maxBytesFor("school-files", "video/mp4"),
    0,
    "zero means refused, not unlimited",
  );
}

// ── The picker offers exactly what the server will take ───────────────────
{
  for (const bucket of ["site-media", "school-files"] as const) {
    const offered = acceptFor(bucket).split(",");
    const allowed = new Set(Object.values(MEDIA_BUCKETS[bucket].types));
    for (const type of offered) {
      assert.ok(
        allowed.has(type),
        `${bucket}: the file picker offers ${type}, which the server rejects`,
      );
    }
  }
  assert.ok(
    !acceptFor("site-media", "image").includes("video/"),
    "an image-only field must not invite a video",
  );
}

console.log("media.selftest: all assertions passed");
