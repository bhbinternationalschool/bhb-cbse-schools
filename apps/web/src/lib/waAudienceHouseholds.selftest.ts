/**
 * Run: npx tsx src/lib/waAudienceHouseholds.selftest.ts
 *
 * A parents send reaches this session's families. SIS leaves last year's
 * row of every child "active", so these check that a stale-year row never
 * adds a family, moves a family into last year's section, or doubles a child.
 */
import assert from "node:assert/strict";
import type { Household, SisStudent } from "./sis";
import { householdHits, sessionParentHits } from "./waAudienceHouseholds";

console.log("waAudienceHouseholds.selftest.ts");

const AY = "2026-27";
const OLD = "2025-26";

function hh(id: string): Household {
  return { id, guardianName: `Guardian ${id}` } as Household;
}
function st(
  id: string,
  householdId: string,
  academicYearCode: string,
  sectionId: string,
  extra: Partial<SisStudent> = {},
): SisStudent {
  return {
    id,
    householdId,
    academicYearCode,
    sectionId,
    admissionNo: `ADM-${id.split("@")[0]}`,
    fullName: `Child ${id.split("@")[0]}`,
    status: "active",
    ...extra,
  } as SisStudent;
}

const households = [hh("H1"), hh("H2"), hh("H3")];
const students = [
  // H1: enrolled both years — last year in V-A, now in VI-A.
  st("c1@old", "H1", OLD, "sec-5A"),
  st("c1@now", "H1", AY, "sec-6A"),
  // H2: left after last year, but the old row is still "active".
  st("c2@old", "H2", OLD, "sec-5A"),
  // H3: this session only; one inactive row that must never count.
  st("c3@now", "H3", AY, "sec-5A"),
  st("c4@now", "H3", AY, "sec-5A", { status: "withdrawn" as SisStudent["status"] }),
];
const sis = { households, students };

// --- whole school: a stale-year active row adds no family -----------------
{
  const hits = sessionParentHits(sis, AY, null);
  const ids = hits.map((h) => h.household.id).sort();
  assert.deepEqual(ids, ["H1", "H3"], "H2 only has a last-year row");

  // The pre-fix behaviour, for contrast: every active row of every year.
  const legacy = householdHits(() => true, students, households);
  assert.equal(legacy.length, 3, "the bug this guards: 3 families, not 2");

  // A child enrolled two years is one child, not two.
  const h1 = hits.find((h) => h.household.id === "H1")!;
  assert.deepEqual(h1.students.map((s) => s.id), ["c1@now"]);
}

// --- section filter matches the child's THIS-session section --------------
{
  const fiveA = sessionParentHits(sis, AY, new Set(["sec-5A"]));
  assert.deepEqual(
    fiveA.map((h) => h.household.id),
    ["H3"],
    "H1 was V-A last year and H2 left — neither is a V-A family now",
  );
  const sixA = sessionParentHits(sis, AY, new Set(["sec-6A"]));
  assert.deepEqual(sixA.map((h) => h.household.id), ["H1"]);
}

// --- the sender's session decides, both ways -----------------------------
{
  const last = sessionParentHits(sis, OLD, null);
  assert.deepEqual(
    last.map((h) => h.household.id).sort(),
    ["H1", "H2"],
    "aimed at last year, last year's families",
  );
}

// --- a household missing from SIS is skipped, not invented ----------------
{
  const orphan = sessionParentHits(
    { households, students: [st("c9@now", "H9", AY, "sec-5A")] },
    AY,
    null,
  );
  assert.equal(orphan.length, 0);
}

console.log("  ok");
