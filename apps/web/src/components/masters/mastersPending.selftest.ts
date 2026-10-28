/**
 * Run: npm run test:masters-pending
 *
 * data-layer 2.1h review fixes — the Masters editor's overlay
 * (components/masters/mastersPending.ts) and its read-time normalisation
 * (lib/masters normalizeMastersRead), on the e2e fixture's school (15 classes,
 * 44 subjects, the 2026-27 fee structures):
 *
 *  1. Edit A survives a stale answer. Commit A (a campus renamed) is saved
 *     (revision R1); the next answer of the masters view is the book from
 *     BEFORE the save (built from R0 — another instance's cache). It must not
 *     replace the overlay; commit B (school profile, another panel) is built
 *     from what the screen shows. An answer built from R1 then replaces the
 *     overlay. (The section save B once made through the old whole-book
 *     path — mastersSectionSave — is gone since data-layer 2.2f.)
 *  2. A failed save drops the overlay once nothing else is saving (the tab
 *     takes the server's answer again); with a later commit still in flight
 *     that commit's answer decides.
 *  3. No answer replaces the overlay while a commit is saving.
 *  4. A save with no revision (function-only, no database) is proven by the
 *     answer reading back every changed key as sent — and only then.
 *  5. normalizeMastersRead is deterministic: the same book twice gives
 *     identical books (ids included), also a book with gaps the normalisation
 *     fills (a class missing, no installments); Math.random is restored.
 *
 * Needs Supabase env (a real tenant: the normalisation must not seed a demo
 * school) — the npm script supplies placeholders.
 */
import assert from "node:assert/strict";
import { buildFixture } from "../../../e2e/fixture";
import { normalizeMastersRead, type MastersState } from "@/lib/masters";
import {
  answerHoldsOverlay,
  changedMastersKeys,
  overlayOnCommit,
  overlayOnSaved,
  type MastersOverlay,
} from "./mastersPending";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error("mastersPending.selftest: needs Supabase env — run `npm run test:masters-pending`.");
  process.exit(1);
}

const R0 = "2026-10-21T09:00:00.000Z";
const R1 = "2026-10-21T09:05:00.123Z";
const R1_PG = "2026-10-21T09:05:00.123+00:00"; // how erp_versions spells the same instant
const R2 = "2026-10-21T09:06:00.000Z";
const at = (iso: string) => ({ masters: { updated_at: iso, count: 15 } });

const book = (): MastersState => normalizeMastersRead(structuredClone(buildFixture().masters));

function renameFirstCampus(s: MastersState, name: string): MastersState {
  return { ...s, campuses: s.campuses.map((c, i) => (i === 0 ? { ...c, name } : c)) };
}
function setSchoolPhone(s: MastersState, phone: string): MastersState {
  const prof = (s as unknown as { schoolProfile: Record<string, unknown> }).schoolProfile;
  return { ...s, schoolProfile: { ...prof, phone } } as unknown as MastersState;
}

let checks = 0;
function check(name: string, fn: () => void) {
  fn();
  checks += 1;
  console.log(`  ok  ${name}`);
}

// ── 1. Edit A survives a stale answer.
check("a stale answer after a save does not replace the overlay", () => {
  const before = book();
  const shown0 = before;
  assert.ok(shown0.campuses.length > 0, "fixture has a campus");
  const a = renameFirstCampus(shown0, "Main campus — renamed (A)");
  let overlay: MastersOverlay | null = overlayOnCommit(null, shown0, a);
  assert.deepEqual(overlay.keys, ["campuses"]);
  overlay = overlayOnSaved(overlay, { ok: true, revision: R1 });
  assert.ok(overlay, "a saved commit keeps the overlay until an answer holds it");

  // The refetch lands on an instance whose cache still holds the book from R0.
  const stale = before;
  assert.equal(answerHoldsOverlay(overlay, stale, at(R0)), false, "built from R0 < R1: not proof");
  assert.equal(answerHoldsOverlay(overlay, stale, null), false, "no versions (stale copy) and A's key differs: not proof");
  const shown1 = overlay.state; // the screen keeps A
  assert.equal(shown1.campuses[0].name, "Main campus — renamed (A)");

  // Commit B in another panel, from what the screen shows.
  const b = setSchoolPhone(shown1, "05412-000000");
  overlay = overlayOnCommit(overlay, shown1, b);
  assert.deepEqual(overlay.keys, ["campuses", "schoolProfile"]);
  overlay = overlayOnSaved(overlay, { ok: true, revision: R2 });
  assert.ok(overlay);
  assert.equal(overlay.revision, R2, "the later revision is the one to wait for");
  assert.equal(answerHoldsOverlay(overlay, stale, at(R1_PG)), false, "built from R1 < R2: not proof of B");

  // The answer built after both saves replaces the overlay.
  assert.equal(answerHoldsOverlay(overlay, b, at(R2)), true);
});

check("an answer built from the save's own revision (Postgres spelling) is proof", () => {
  const shown = book();
  const a = renameFirstCampus(shown, "X");
  const o = overlayOnSaved(overlayOnCommit(null, shown, a), { ok: true, revision: R1 })!;
  assert.equal(answerHoldsOverlay(o, a, at(R1_PG)), true);
});

// ── 2. A failed save.
check("a failed save drops the overlay when nothing else is saving", () => {
  const shown = book();
  const o = overlayOnCommit(null, shown, renameFirstCampus(shown, "never stored"));
  assert.equal(overlayOnSaved(o, { ok: false }), null);
});

check("a failed save with a later commit in flight: the later answer decides", () => {
  const shown = book();
  let o: MastersOverlay | null = overlayOnCommit(null, shown, renameFirstCampus(shown, "A"));
  o = overlayOnCommit(o, o.state, setSchoolPhone(o.state, "1"));
  assert.equal(o.saving, 2);
  o = overlayOnSaved(o, { ok: false });
  assert.ok(o, "kept: the second commit carries the first edit too");
  assert.equal(o.saving, 1);
  assert.equal(overlayOnSaved(o, { ok: false }), null, "both failed: dropped");
});

// ── 3. Never mid-save.
check("no answer replaces the overlay while a commit is saving", () => {
  const shown = book();
  const a = renameFirstCampus(shown, "A");
  const o = overlayOnCommit(null, shown, a);
  assert.equal(o.saving, 1);
  assert.equal(answerHoldsOverlay(o, a, at(R2)), false, "even an answer that reads A back");
});

// ── 4. No revision: proof by value.
check("a save with no revision is proven by the answer reading every changed key back as sent", () => {
  const shown = book();
  const a = renameFirstCampus(shown, "A");
  const o = overlayOnSaved(overlayOnCommit(null, shown, a), { ok: true })!;
  assert.equal(o.revision, "");
  assert.equal(answerHoldsOverlay(o, shown, at(R2)), false, "old campus name: not proof (no revision to compare)");
  assert.equal(answerHoldsOverlay(o, a, null), true, "campus name read back: proof");
  assert.deepEqual(changedMastersKeys(shown, shown), []);
});

// ── 5. Deterministic normalisation.
check("normalizeMastersRead: the same book twice gives the same ids", () => {
  const raw = buildFixture().masters;
  const x = normalizeMastersRead(structuredClone(raw));
  const y = normalizeMastersRead(structuredClone(raw));
  assert.deepEqual(changedMastersKeys(x, y), [], "full fixture book");

  const gaps = structuredClone(raw);
  gaps.classes = gaps.classes.filter((c) => c.name !== "UKG");
  gaps.installments = [];
  gaps.departments = [];
  gaps.designations = [];
  const g1 = normalizeMastersRead(structuredClone(gaps));
  const g2 = normalizeMastersRead(structuredClone(gaps));
  assert.ok(g1.classes.some((c) => c.name === "UKG"), "the gap is filled");
  assert.deepEqual(changedMastersKeys(g1, g2), [], "book with gaps");
  assert.equal(
    g1.classes.find((c) => c.name === "UKG")!.id,
    g2.classes.find((c) => c.name === "UKG")!.id,
    "the minted class id is the same both times",
  );

  // Math.random is the real one again: two draws differ, and are not the seeded sequence.
  const r1 = Math.random();
  const r2 = Math.random();
  assert.notEqual(r1, r2);
});

console.log(`mastersPending.selftest: ok (${checks} checks)`);
