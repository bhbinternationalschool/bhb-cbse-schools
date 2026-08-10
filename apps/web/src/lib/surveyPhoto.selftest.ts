/**
 * An image must never be stored inside a lead row.
 *
 * `surveyPhotoDataUrl` held base64 on the lead, inside `lead_json`. One
 * compressed survey photo is roughly 200 KB — more than the entire 919-lead
 * list projection (44 KB per 100-row page) — and `lead_json` is carried by
 * every admissions read and every localStorage write. On 2026-08-10 that
 * payload already exceeded the browser storage cap and cost the director's
 * phone its admissions saves; a single saved photo would have made it
 * dramatically worse.
 *
 * It was never populated: 0 of 919 rows held an image, despite the survey
 * producing every one of those leads. So the field became `surveyPhotoUrl`
 * and the image goes to object storage — the capability kept, the cost
 * removed, before anything had to be migrated.
 *
 * The specific trap: objectStorage.uploadSchoolObject has a `local` mode that
 * RETURNS a data URL when no bucket is configured. It is a perfectly good
 * preview and a disastrous stored value, and it succeeds — `ok: true` — so a
 * caller checking only for failure would persist it. The guard lives at the
 * boundary rather than in each caller.
 *
 * Run: npx tsx src/lib/surveyPhoto.selftest.ts
 */
import assert from "node:assert/strict";
import { sanitizeSurveyPhotoUrl } from "./admissions";

// ── The thing this exists to stop ─────────────────────────────────────────
{
  const base64Photo = "data:image/jpeg;base64," + "A".repeat(200_000);
  assert.equal(
    sanitizeSurveyPhotoUrl(base64Photo),
    "",
    "a data: URL is the image itself and must never be stored on a lead",
  );

  assert.equal(
    sanitizeSurveyPhotoUrl("DATA:image/png;base64,iVBOR"),
    "",
    "case does not change what it is",
  );
  assert.equal(
    sanitizeSurveyPhotoUrl("  data:image/jpeg;base64,abc  "),
    "",
    "nor does surrounding whitespace",
  );
}

// ── Real URLs pass through ────────────────────────────────────────────────
{
  const supabase =
    "https://ymamhlcrjsuilzdonkzl.supabase.co/storage/v1/object/public/school-files/survey/2026-08-10/photo_x.jpg";
  assert.equal(sanitizeSurveyPhotoUrl(supabase), supabase, "a public URL is kept");

  const signed = supabase + "?token=abc.def";
  assert.equal(sanitizeSurveyPhotoUrl(signed), signed, "a signed URL is kept intact");

  assert.equal(
    sanitizeSurveyPhotoUrl("/api/files/survey/photo_x.jpg"),
    "/api/files/survey/photo_x.jpg",
    "a relative path is a URL too",
  );
}

// ── Absent is absent, not an error ────────────────────────────────────────
// Most leads have no photo; that is ordinary, not a failure.
{
  assert.equal(sanitizeSurveyPhotoUrl(undefined), "");
  assert.equal(sanitizeSurveyPhotoUrl(null), "");
  assert.equal(sanitizeSurveyPhotoUrl(""), "");
  assert.equal(sanitizeSurveyPhotoUrl("   "), "");
}

console.log("surveyPhoto.selftest: all assertions passed");
