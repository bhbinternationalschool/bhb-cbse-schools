/**
 * Run: npx tsx src/lib/deskFeatureAuthRev.selftest.ts
 *
 * Data-layer 2.2b (review of 2.2a, item 3). Since 2.2a every Masters list
 * element carries a server-owned `_rev`. A function holder's browser may hold
 * an older `_rev` of a row it did not change — or none (a copy loaded before
 * 2.2a, or the teaching subset served before the trigger moved it). Such a
 * row has NOT been changed by them: comparing with `_rev` refused their whole
 * save as "You may not change …". These cases fail on the code before 2.2b.
 */
import assert from "node:assert/strict";
import { authorizeFeatureChange, deniedSliceChange } from "./deskFeatureAuth";

console.log("deskFeatureAuthRev.selftest.ts");

const link = (id: string, classId: string, subjectId: string, rev?: number) => ({
  id,
  classId,
  subjectId,
  periodsPerWeek: 5,
  isOptional: false,
  ...(rev === undefined ? {} : { _rev: rev }),
});

// Stored: someone else's save since moved the rows' _rev on.
const stored = {
  classSubjects: [link("l1", "c6", "eng", 3), link("l2", "c6", "hin", 2), link("l3", "c7", "eng", 5)],
};

// A teacher who may ADD class subjects in her own class (no edit, no delete).
const addOnly = (featureId: string, action: string) =>
  featureId === "masters.class_subjects" && (action === "create" || action === "view")
    ? { allowed: true, ownClassesOnly: true }
    : { allowed: false, ownClassesOnly: false };

/* ── 1. Re-push with the OLD _rev on rows she did not touch, plus one new row ── */
{
  const incoming = {
    classSubjects: [link("l1", "c6", "eng", 2), link("l2", "c6", "hin", 1), link("l3", "c7", "eng", 4), link("l4", "c6", "sci")],
  };
  const v = authorizeFeatureChange("masters", stored, incoming, addOnly, new Set(["c6"]));
  assert.ok(v.ok, `an older _rev on an unchanged row is not a change: ${v.ok ? "" : v.reason}`);
  assert.deepEqual(v.ok && v.changedSlices, ["classSubjects"]);
  console.log("  ✓ re-push with older _revs + one added subject → accepted (add only)");
}

/* ── 2. Re-push WITHOUT _rev at all (a copy from before 2.2a) ── */
{
  const incoming = {
    classSubjects: [link("l1", "c6", "eng"), link("l2", "c6", "hin"), link("l3", "c7", "eng"), link("l5", "c6", "art")],
  };
  const v = authorizeFeatureChange("masters", stored, incoming, addOnly, new Set(["c6"]));
  assert.ok(v.ok, `a missing _rev on an unchanged row is not a change: ${v.ok ? "" : v.reason}`);
  console.log("  ✓ re-push with no _rev + one added subject → accepted");
}

/* ── 3. Nothing but _rev differs: no change at all ── */
{
  const incoming = { classSubjects: [link("l1", "c6", "eng", 1), link("l2", "c6", "hin"), link("l3", "c7", "eng", 9)] };
  const v = authorizeFeatureChange("masters", stored, incoming, addOnly, new Set(["c6"]));
  assert.ok(v.ok);
  assert.deepEqual(v.ok && v.changedSlices, [], "only _rev differs → nothing changed");
  console.log("  ✓ only _rev differs → no changed slice");
}

/* ── 4. A REAL change is still refused (the check is not switched off) ── */
{
  const incoming = { classSubjects: [{ ...link("l1", "c6", "eng", 3), periodsPerWeek: 7 }, link("l2", "c6", "hin", 2), link("l3", "c7", "eng", 5)] };
  const v = authorizeFeatureChange("masters", stored, incoming, addOnly, new Set(["c6"]));
  assert.ok(!v.ok, "a changed periodsPerWeek without edit must still be refused");
  assert.match(v.ok ? "" : v.reason, /You may not change class subjects/);
  console.log("  ✓ a real edit without the edit action → still refused");
}

/* ── 5. Whole-module holder personally denied edit: an older _rev is not an edit ── */
{
  const denied = (featureId: string, action: string) => featureId === "masters.class_subjects" && action === "edit";
  const incoming = { classSubjects: [link("l1", "c6", "eng", 1), link("l2", "c6", "hin"), link("l3", "c7", "eng", 5), link("l9", "c7", "pe")] };
  assert.equal(deniedSliceChange("masters", stored, incoming, denied), null, "older _rev ≠ an edit for a denied holder");
  const edited = { classSubjects: [{ ...link("l1", "c6", "eng", 3), subjectId: "math" }] };
  assert.match(String(deniedSliceChange("masters", stored, edited, denied)), /You may not change class subjects/);
  console.log("  ✓ personally denied edit: older/absent _rev passes, a real edit is refused");
}

console.log("deskFeatureAuthRev.selftest: all passed");
