/**
 * Self-test: which class + subject gets a Smart Teach link.
 * The portal account holds the add-on books only, so a link must never
 * appear for a subject whose book is not there.
 * Run: npx tsx apps/web/src/lib/smartTeach.selftest.ts
 */
import assert from "node:assert/strict";
import { SMART_TEACH_URL, smartTeachBookFor } from "@/lib/smartTeach";

// ── The books the account actually has ──────────────────────────────────
{
  assert.equal(smartTeachBookFor("VIII", "Computer")?.book, "Click Code Connect - 8");
  assert.equal(smartTeachBookFor("Class 1", "Computer")?.book, "Click Code Connect - 1");
  assert.equal(smartTeachBookFor("VI", "G.K.")?.book, "Know and Grow with Derek 6");
  assert.equal(
    smartTeachBookFor("III", "General Knowledge")?.book,
    "Know and Grow with Derek 3",
  );
  // Vistas stops at Class 5; 6–8 read Propel Social Science, which is not there.
  assert.equal(smartTeachBookFor("V", "Social Studies")?.book, "New Longman Vistas 5");
  assert.equal(smartTeachBookFor("VII", "Social Science"), null);
}

// ── "G.K. / Computer Practical" is the GK paper, not Computer ───────────
{
  assert.equal(
    smartTeachBookFor("VIII", "G.K. / Computer Practical")?.book,
    "Know and Grow with Derek 8",
  );
}

// ── No link where the account has nothing ───────────────────────────────
{
  for (const subject of ["Mathematics", "Science", "English", "हिंदी", "Sanskrit"]) {
    assert.equal(smartTeachBookFor("VIII", subject), null, subject);
  }
  // Pre-primary: the account's Tip-Tap-Toe set is not the school's book.
  assert.equal(smartTeachBookFor("Nursery", "Computer"), null);
  assert.equal(smartTeachBookFor("UKG", "G.K."), null);
  // Missing or empty inputs.
  assert.equal(smartTeachBookFor(undefined, "Computer"), null);
  assert.equal(smartTeachBookFor("VIII", ""), null);
  assert.equal(smartTeachBookFor("VIII", undefined), null);
}

// ── The link target ─────────────────────────────────────────────────────
{
  assert.equal(SMART_TEACH_URL, "https://teacher.pinnaclelearning.in");
  assert.ok(SMART_TEACH_URL.startsWith("https://"), "teacher portal must be https");
  assert.ok(smartTeachBookFor("VIII", "Computer")!.has.includes("lesson plans"));
}

console.log("smartTeach.selftest: all assertions passed");
