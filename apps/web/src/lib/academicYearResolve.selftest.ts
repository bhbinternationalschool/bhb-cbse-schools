/**
 * A session that has ended cannot still be "current".
 *
 * 2025-26 ran 2025-04-01 to 2026-03-31. The school operated inside it until
 * 2026-08-10 — four months past the end — because nothing ever compared the
 * year to today's date. `status: "current"` was a flag someone had to
 * remember to move, and when a frozen desk fabricated 2025-26 and PATCHed it
 * into the signed session cookie, nothing downstream could tell it was wrong.
 *
 * The rule: dates decide. `status` is honoured as a deliberate override only
 * where it does not contradict the calendar, and a disagreement is reported
 * rather than silently resolved — either answer can be right and only a human
 * knows which.
 *
 * Run: npx tsx src/lib/academicYearResolve.selftest.ts
 */
import assert from "node:assert/strict";
import {
  fallbackAcademicYear,
  resolveAcademicYear,
} from "./academicYearResolve";

const REAL = [
  { code: "2024-25", startsOn: "2024-04-01", endsOn: "2025-03-31", status: "closed" },
  { code: "2025-26", startsOn: "2025-04-01", endsOn: "2026-03-31", status: "closed" },
  { code: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", status: "current" },
];

// ── Today, with production's real data ────────────────────────────────────
{
  const r = resolveAcademicYear(REAL, "2026-08-10T11:00:00.000Z");
  assert.equal(r.code, "2026-27");
  assert.equal(r.reason, "date");
  assert.equal(r.conflict, undefined, "calendar and status agree — no noise");
}

// ── The incident: the flag was never moved ────────────────────────────────
// This is the state the school was actually in for four months.
{
  const stale = REAL.map((y) =>
    y.code === "2025-26" ? { ...y, status: "current" }
      : y.code === "2026-27" ? { ...y, status: "upcoming" }
      : y,
  );
  const r = resolveAcademicYear(stale, "2026-08-10T11:00:00.000Z");

  assert.equal(
    r.code,
    "2026-27",
    "the calendar wins: 2025-26 ended 2026-03-31 and cannot be current in August",
  );
  assert.ok(r.conflict, "the disagreement must be reported, not swallowed");
  assert.equal(r.conflict?.byStatus, "2025-26");
  assert.equal(r.conflict?.byDate, "2026-27");
}

// ── Boundaries are inclusive ──────────────────────────────────────────────
{
  assert.equal(resolveAcademicYear(REAL, "2026-03-31").code, "2025-26", "last day");
  assert.equal(resolveAcademicYear(REAL, "2026-04-01").code, "2026-27", "first day");
}

// ── Between sessions: status is the best available answer, and says so ────
{
  const gapped = [
    { code: "2025-26", startsOn: "2025-04-01", endsOn: "2026-03-31", status: "closed" },
    { code: "2026-27", startsOn: "2026-06-01", endsOn: "2027-03-31", status: "current" },
  ];
  const r = resolveAcademicYear(gapped, "2026-04-15");
  assert.equal(r.code, "2026-27");
  assert.equal(r.reason, "status", "reported as a flag, not as a fact");
}

// ── Unknown stays unknown ─────────────────────────────────────────────────
// The whole point: no plausible-looking default. See the DEFAULT_AY incident.
{
  assert.equal(resolveAcademicYear([], "2026-08-10").code, null);
  assert.equal(resolveAcademicYear(null, "2026-08-10").code, null);
  assert.equal(
    resolveAcademicYear(
      [{ code: "2025-26", startsOn: "2025-04-01", endsOn: "2026-03-31", status: "closed" }],
      "2026-08-10",
    ).code,
    null,
    "a single expired year with no current flag resolves to unknown, not to itself",
  );
  assert.equal(
    resolveAcademicYear([{ code: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", status: "current", isActive: false }], "2026-08-10").code,
    null,
    "isActive:false disqualifies a year",
  );
}

// ── Missing dates cannot be date-resolved ─────────────────────────────────
{
  const undated = [{ code: "2026-27", status: "current" }];
  const r = resolveAcademicYear(undated, "2026-08-10");
  assert.equal(r.code, "2026-27");
  assert.equal(r.reason, "status", "with no dates, only the flag remains");
}

// ── The fallback is derived, never hardcoded ──────────────────────────────
{
  assert.equal(
    fallbackAcademicYear(REAL),
    "2026-27",
    "latest by start date — from the school's own data, not a constant",
  );
  assert.equal(
    fallbackAcademicYear([]),
    null,
    "no years defined means no answer; a school with no academic year cannot " +
      "scope a query and the honest response is to say so",
  );
}

console.log("academicYearResolve.selftest: all assertions passed");
