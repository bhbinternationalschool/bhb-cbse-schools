/**
 * Self-test: riders grouped by class and section.
 * Run: npx tsx apps/web/src/lib/transportByClass.selftest.ts
 *
 * Two things this holds:
 *   1. Non-riders are COUNTED, not dropped. "18 of 24 ride" is the sentence a
 *      class teacher needs; six names alone do not say whether the rest walk
 *      or whether nobody got round to assigning them.
 *   2. Sections are ordered by the school's class sequence, not the alphabet.
 *      Sorting on labels puts X before II and makes the page unreadable.
 */

import assert from "node:assert/strict";

import { buildClassTransportRows } from "./transportPlanner";
import type { StudentTransportProfile } from "./transportPlanner";
import type { TransportState } from "./transport";

console.log("transportByClass.selftest.ts");

const state = {
  feePolicy: undefined,
  routes: [
    {
      id: "r1",
      code: "MAGIC-1",
      name: "Magic 1",
      busNo: "MAGIC 1",
      isActive: true,
      stops: [
        { id: "st1", name: "Ayar Mod", sequence: 1, distanceKm: 4, monthlyFeePaise: 50000 },
      ],
    },
  ],
} as unknown as TransportState;

let n = 0;
function profile(opts: {
  classId: string;
  classLabel: string;
  sectionLabel: string;
  rides: boolean;
  fee?: number;
  stopId?: string;
}): StudentTransportProfile {
  n += 1;
  const asg = opts.rides
    ? {
        id: `a${n}`,
        studentId: `s${n}`,
        routeId: "r1",
        stopId: opts.stopId ?? "st1",
        effectiveTo: null,
        monthlyFeePaise: opts.fee ?? 50000,
        serviceMode: "both",
        boardingSuspended: false,
        effectiveFrom: "2026-04-01",
      }
    : undefined;
  return {
    studentId: `s${n}`,
    fullName: `STUDENT ${String(n).padStart(2, "0")}`,
    admissionNo: `ADM${n}`,
    classId: opts.classId,
    classLabel: opts.classLabel,
    sectionId: `sec_${opts.classId}_${opts.sectionLabel}`,
    sectionLabel: opts.sectionLabel,
    householdId: `hh${n}`,
    hasAssignment: opts.rides,
    assignment: asg,
    hasGeo: false,
  } as unknown as StudentTransportProfile;
}

// Profiles arrive in masters' class order — that ordering is the input, and
// the function must preserve it rather than re-sort alphabetically.
const profiles = [
  profile({ classId: "c_nur", classLabel: "Nursery", sectionLabel: "A", rides: true }),
  profile({ classId: "c_nur", classLabel: "Nursery", sectionLabel: "A", rides: false }),
  profile({ classId: "c_nur", classLabel: "Nursery", sectionLabel: "B", rides: true }),
  profile({ classId: "c_ii", classLabel: "II", sectionLabel: "A", rides: true, fee: 70000 }),
  profile({ classId: "c_x", classLabel: "X", sectionLabel: "A", rides: false }),
  profile({ classId: "c_x", classLabel: "X", sectionLabel: "A", rides: false }),
];

const rows = buildClassTransportRows(profiles, state);

/* ── grouping ───────────────────────────────────────────────── */

assert.equal(rows.length, 4, "Nursery A, Nursery B, II A, X A");
const [nurA, nurB, iiA, xA] = rows;
assert.equal(nurA.classLabel, "Nursery");
assert.equal(nurA.sectionLabel, "A");
assert.equal(nurA.riders.length, 1);
assert.equal(nurA.totalStudents, 2);
assert.equal(nurA.nonRiderCount, 1, "the child who does not ride is counted");

/* ── THE ordering rule: school sequence, not the alphabet ───── */

assert.deepEqual(
  rows.map((r) => `${r.classLabel}-${r.sectionLabel}`),
  ["Nursery-A", "Nursery-B", "II-A", "X-A"],
  "X must not sort before II",
);
assert.equal(nurB.sectionLabel, "B", "sections within a class stay in order");

/* ── a section where nobody rides is still a row ────────────── */

assert.equal(xA.riders.length, 0);
assert.equal(xA.totalStudents, 2);
assert.equal(xA.nonRiderCount, 2);
assert.equal(xA.monthlyTotalPaise, 0);
// Kept so the screen can say "nobody in X A rides", which is information.
// Dropping the row would make the class simply absent, which is not.

/* ── money adds up per section ──────────────────────────────── */

assert.equal(iiA.monthlyTotalPaise, 70000);
assert.equal(nurA.monthlyTotalPaise, 50000);

/* ── a broken stop link is surfaced here too ────────────────── */

const broken = buildClassTransportRows(
  [profile({ classId: "c_i", classLabel: "I", sectionLabel: "A", rides: true, stopId: "st_GONE" })],
  state,
);
assert.equal(broken[0].riders[0].stopLinkBroken, true);
assert.equal(broken[0].riders[0].stopName, "", "no stop name is invented");
// Their own agreed fee still stands — only the stop-derived price was lost.
assert.equal(broken[0].riders[0].monthlyFeePaise, 50000);

/* ── students with no section are not silently merged ───────── */

const noSection = buildClassTransportRows(
  [
    profile({ classId: "c_iii", classLabel: "III", sectionLabel: "", rides: true }),
    profile({ classId: "c_iii", classLabel: "III", sectionLabel: "A", rides: true }),
  ],
  state,
);
assert.equal(noSection.length, 2, "no-section is its own bucket, not folded into A");

console.log("  ok");
