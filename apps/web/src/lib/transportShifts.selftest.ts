/**
 * Self-test: which timed run a child is on, and whether the runs add up.
 * Run: npx tsx apps/web/src/lib/transportShifts.selftest.ts
 */

import assert from "node:assert/strict";

import { defaultSchoolTimingConfig } from "./schoolTiming";
import { normalizeShift, type TransportRoute, type TransportShift } from "./transport";
import {
  buildShiftRiders,
  checkRouteShiftFeasibility,
  listRouteShifts,
  resolveRiderShift,
  routeShiftCoverage,
  shiftRunsOn,
  strictClassGroup,
  suggestShiftsFromTiming,
} from "./transportShifts";

console.log("transportShifts.selftest.ts");

function shift(p: Partial<TransportShift>): TransportShift {
  return normalizeShift(p);
}

function route(shifts: TransportShift[], roundTripMinutes = 0): TransportRoute {
  return {
    id: "r1",
    code: "R-01",
    name: "Ayar",
    busNo: "Bus 1",
    vehicleReg: "UP65 AB 1234",
    vehicleId: "",
    monthlyFeePaise: 50000,
    isActive: true,
    stops: [],
    shifts,
    ...(roundTripMinutes > 0 ? { roundTripMinutes } : {}),
  };
}

/* ── normalizeShift: a bad time must not become a plausible one ── */
{
  assert.equal(normalizeShift({ departTime: "7:5" }).departTime, "");
  assert.equal(normalizeShift({ departTime: "25:00" }).departTime, "");
  assert.equal(normalizeShift({ departTime: "07:05" }).departTime, "07:05");
  // Single-digit hour is padded, not rejected — clerks type 7:05.
  assert.equal(normalizeShift({ departTime: "7:05" }).departTime, "07:05");
  assert.equal(normalizeShift({}).departTime, "", "no time must stay unset");
  assert.equal(normalizeShift({ direction: "drop" }).direction, "drop");
  assert.equal(
    normalizeShift({ direction: "nonsense" as never }).direction,
    "pickup",
  );
  assert.deepEqual(
    normalizeShift({ weekdays: [3, 1, 1, 9, -2] }).weekdays,
    [1, 3],
    "weekdays are de-duplicated, sorted and bounded",
  );
}

/* ── listRouteShifts: an untimed run must not head the list ── */
{
  const runs = listRouteShifts(
    route([
      shift({ id: "b", name: "Main drop", direction: "drop", departTime: "15:40" }),
      shift({ id: "a", name: "Unset", direction: "drop", departTime: "" }),
      shift({ id: "c", name: "Early drop", direction: "drop", departTime: "13:40" }),
      shift({ id: "d", name: "Morning", direction: "pickup", departTime: "06:45" }),
      shift({ id: "e", name: "Retired", direction: "drop", departTime: "12:00", isActive: false }),
    ]),
    "drop",
  );
  assert.deepEqual(
    runs.map((r) => r.id),
    ["c", "b", "a"],
    "earliest first, untimed last, inactive and wrong-direction excluded",
  );
}

/* ── A route with no runs behaves exactly as it did before shifts ── */
{
  const res = resolveRiderShift({
    route: route([]),
    direction: "drop",
    groupCode: "PRIMARY",
  });
  assert.equal(res.shift, null);
  assert.equal(res.reason, "no-shifts");
  assert.equal(res.needsAttention, false, "an unconfigured route is not a fault");
}

/* ── One run carries everyone ── */
{
  const only = shift({ id: "s1", name: "Afternoon", direction: "drop", departTime: "15:40" });
  const res = resolveRiderShift({
    route: route([only]),
    direction: "drop",
    groupCode: "MIDDLE",
  });
  assert.equal(res.shift?.id, "s1");
  assert.equal(res.reason, "only-run");
  assert.equal(res.needsAttention, false);
}

/* ── One run that disclaims the child still carries them, but flags it ── */
{
  const only = shift({
    id: "s1",
    name: "Early drop",
    direction: "drop",
    departTime: "13:40",
    classGroups: ["PRE_PRIMARY"],
  });
  const res = resolveRiderShift({
    route: route([only]),
    direction: "drop",
    groupCode: "MIDDLE",
  });
  assert.equal(res.shift?.id, "s1", "the child must still appear on a driver's list");
  assert.equal(res.reason, "only-run-unclaimed");
  assert.equal(res.needsAttention, true, "and the contradiction must be visible");
}

/* ── The class group picks the run ── */
{
  const early = shift({
    id: "early",
    name: "Early drop",
    direction: "drop",
    departTime: "13:40",
    classGroups: ["PRE_PRIMARY"],
  });
  const main = shift({
    id: "main",
    name: "Main drop",
    direction: "drop",
    departTime: "15:40",
    classGroups: ["PRIMARY", "MIDDLE"],
  });
  const r = route([early, main]);

  assert.equal(
    resolveRiderShift({ route: r, direction: "drop", groupCode: "PRE_PRIMARY" }).shift?.id,
    "early",
  );
  assert.equal(
    resolveRiderShift({ route: r, direction: "drop", groupCode: "MIDDLE" }).shift?.id,
    "main",
  );
  assert.equal(
    resolveRiderShift({ route: r, direction: "drop", groupCode: "MIDDLE" }).reason,
    "class-group",
  );

  // A group nobody carries is reported, never dropped onto a run.
  const orphan = resolveRiderShift({
    route: r,
    direction: "drop",
    groupCode: "SECONDARY",
  });
  assert.equal(orphan.shift, null);
  assert.equal(orphan.reason, "no-run-for-group");
  assert.equal(orphan.needsAttention, true);

  // Unknown class → no rule can apply.
  const noClass = resolveRiderShift({ route: r, direction: "drop", groupCode: null });
  assert.equal(noClass.shift, null);
  assert.equal(noClass.reason, "unknown-group");
  assert.equal(noClass.needsAttention, true);
}

/* ── Two runs claiming the same group is a contradiction, not a coin toss ── */
{
  const a = shift({
    id: "a",
    name: "Drop A",
    direction: "drop",
    departTime: "13:40",
    classGroups: ["PRIMARY"],
  });
  const b = shift({
    id: "b",
    name: "Drop B",
    direction: "drop",
    departTime: "15:40",
    classGroups: ["PRIMARY"],
  });
  const res = resolveRiderShift({
    route: route([a, b]),
    direction: "drop",
    groupCode: "PRIMARY",
  });
  assert.equal(res.shift, null, "must not silently pick the earlier one");
  assert.equal(res.reason, "ambiguous-group");
  assert.equal(res.needsAttention, true);
}

/* ── The override beats the rule; a dead override does NOT fall back ── */
{
  const early = shift({
    id: "early",
    name: "Early drop",
    direction: "drop",
    departTime: "13:40",
    classGroups: ["PRE_PRIMARY"],
  });
  const main = shift({
    id: "main",
    name: "Main drop",
    direction: "drop",
    departTime: "15:40",
    classGroups: ["PRIMARY"],
  });
  const r = route([early, main]);

  // A Class II child who waits for an elder sister.
  const pinned = resolveRiderShift({
    route: r,
    direction: "drop",
    overrideShiftId: "main",
    groupCode: "PRE_PRIMARY",
  });
  assert.equal(pinned.shift?.id, "main");
  assert.equal(pinned.reason, "override");
  assert.equal(pinned.needsAttention, false);

  // The pinned run is deleted. Falling back to the rule would move the child
  // to a different journey with nobody told.
  const dead = resolveRiderShift({
    route: route([early]),
    direction: "drop",
    overrideShiftId: "main",
    groupCode: "PRE_PRIMARY",
  });
  assert.equal(dead.shift, null);
  assert.equal(dead.reason, "override-missing");
  assert.equal(dead.needsAttention, true);
}

/* ── An override pointing at the other direction is not honoured ── */
{
  const morning = shift({ id: "am", name: "Morning", direction: "pickup", departTime: "06:45" });
  const res = resolveRiderShift({
    route: route([morning]),
    direction: "drop",
    overrideShiftId: "am",
    groupCode: "PRIMARY",
  });
  assert.equal(res.reason, "no-shifts", "no drop run exists at all");
}

/* ── shiftRunsOn: empty weekdays means every day ── */
{
  assert.equal(shiftRunsOn(shift({ weekdays: [] }), 3), true);
  assert.equal(shiftRunsOn(shift({ weekdays: [1, 2, 3, 4, 5] }), 6), false);
  assert.equal(shiftRunsOn(shift({ weekdays: [6] }), 6), true);
}

/* ── Coverage names the children, not just the counts ── */
{
  const early = shift({
    id: "early",
    name: "Early drop",
    direction: "drop",
    departTime: "13:40",
    classGroups: ["PRE_PRIMARY"],
  });
  const main = shift({
    id: "main",
    name: "Main drop",
    direction: "drop",
    departTime: "",
    classGroups: ["PRIMARY"],
  });
  const cov = routeShiftCoverage(route([early, main]), [
    { studentId: "s1", studentName: "Aarav", groupCode: "PRE_PRIMARY" },
    { studentId: "s2", studentName: "Isha", groupCode: "PRIMARY" },
    { studentId: "s3", studentName: "Rehan", groupCode: "MIDDLE" },
    { studentId: "s4", studentName: "Nobody", groupCode: null },
  ]);

  assert.equal(cov.riderCount, 4);
  assert.equal(cov.dropRuns, 2);
  assert.equal(cov.pickupRuns, 0);
  assert.deepEqual(cov.unservedDropGroups, ["MIDDLE"]);
  assert.deepEqual(cov.contestedGroups, []);
  assert.deepEqual(
    cov.untimedRuns.map((u) => u.id),
    ["main"],
    "a run with no time cannot go on a parent's screen",
  );

  const names = cov.unresolved.map((u) => `${u.studentName}:${u.direction}:${u.reason}`);
  assert.ok(names.includes("Rehan:drop:no-run-for-group"), names.join(" | "));
  assert.ok(names.includes("Nobody:drop:unknown-group"), names.join(" | "));
  assert.ok(
    !names.some((n) => n.startsWith("Aarav:drop")),
    "a correctly routed child is not an exception",
  );
  assert.ok(
    !names.some((n) => n.endsWith(":pickup:no-shifts")),
    "an unconfigured direction is not per-child noise",
  );
}

/* ── Feasibility: the gap must beat the MEASURED round trip ── */
{
  const early = shift({ id: "e", name: "Early drop", direction: "drop", departTime: "13:40" });
  const main = shift({ id: "m", name: "Main drop", direction: "drop", departTime: "15:40" });

  // Never measured → refuses to judge rather than estimating.
  const unmeasured = checkRouteShiftFeasibility(route([early, main], 0));
  assert.equal(unmeasured.verdict, "unknown-round-trip");
  assert.deepEqual(unmeasured.pairs, []);

  // 120 min apart, 70 min round trip → comfortable.
  const ok = checkRouteShiftFeasibility(route([early, main], 70));
  assert.equal(ok.verdict, "ok");
  assert.equal(ok.pairs.length, 1);
  assert.equal(ok.pairs[0].gapMinutes, 120);

  // 120 min apart, 115 min round trip → possible, no slack.
  assert.equal(checkRouteShiftFeasibility(route([early, main], 115)).verdict, "tight");

  // 120 min apart, 130 min round trip → one vehicle cannot do both.
  const bad = checkRouteShiftFeasibility(route([early, main], 130));
  assert.equal(bad.verdict, "impossible");
  assert.match(bad.pairs[0].detail, /second vehicle/);

  // One run has no time → nothing to compare.
  const untimed = checkRouteShiftFeasibility(
    route([early, shift({ id: "x", name: "Late", direction: "drop", departTime: "" })], 70),
  );
  assert.equal(untimed.verdict, "unknown-times");

  assert.equal(checkRouteShiftFeasibility(route([early], 70)).verdict, "single-run");
}

/* ── Suggestions come from the school's own timings ── */
{
  const cfg = defaultSchoolTimingConfig();
  cfg.groupOverrides = [
    {
      id: "g1",
      groupCode: "PRE_PRIMARY",
      timing: {
        startTime: "09:00",
        endTime: "13:30",
        workingWeekdays: [1, 2, 3, 4, 5, 6],
        sundayExceptional: false,
        sundayStartTime: "09:00",
        sundayEndTime: "13:00",
      },
    },
  ];

  const drafts = suggestShiftsFromTiming({
    timing: cfg,
    groupsRiding: ["PRE_PRIMARY", "PRIMARY", "MIDDLE"],
  });

  const drops = drafts.filter((d) => d.direction === "drop");
  assert.equal(drops.length, 2, "two dismissal times → two drop runs");
  assert.equal(drops[0].departTime, "13:40", "13:30 bell + 10 min to load");
  assert.deepEqual(drops[0].classGroups, ["PRE_PRIMARY"]);
  assert.equal(drops[0].name, "Early drop");
  assert.equal(drops[1].departTime, "15:40", "15:30 default bell + 10 min");
  assert.deepEqual(drops[1].classGroups, ["PRIMARY", "MIDDLE"]);
  assert.equal(drops[1].name, "Main drop");

  const pickups = drafts.filter((d) => d.direction === "pickup");
  assert.equal(pickups.length, 1, "one start time → one morning run");
  assert.equal(
    pickups[0].departTime,
    "",
    "the morning departure depends on the measured journey out, so it is left unset rather than invented",
  );
  assert.deepEqual(pickups[0].classGroups.sort(), ["MIDDLE", "PRE_PRIMARY", "PRIMARY"]);

  assert.deepEqual(suggestShiftsFromTiming({ timing: cfg, groupsRiding: [] }), []);
}

/* ── strictClassGroup: an unknown class must NOT become Primary ── */
{
  assert.equal(strictClassGroup("Nursery"), "PRE_PRIMARY");
  assert.equal(strictClassGroup("ukg"), "PRE_PRIMARY");
  assert.equal(strictClassGroup("V"), "PRIMARY");
  assert.equal(strictClassGroup("VIII"), "MIDDLE");

  // masters.classGroupCodeForName answers PRIMARY for all of these, which is
  // fine for a timetable and dangerous for a bus: it would put the child on
  // the Primary drop and let them off at 15:40 in the wrong village.
  assert.equal(strictClassGroup("Balvatika"), null);
  assert.equal(strictClassGroup("Remedial"), null);
  assert.equal(strictClassGroup("VIII-A"), null);
  assert.equal(strictClassGroup(""), null);
  assert.equal(strictClassGroup("   "), null);
}

/* ── buildShiftRiders joins the desk's own rows to the rules ── */
{
  const riders = buildShiftRiders({
    assignments: [
      { studentId: "s1", routeId: "r1", academicYearCode: "2026-27", effectiveTo: null },
      // Closed assignment — not on the bus.
      { studentId: "s2", routeId: "r1", academicYearCode: "2026-27", effectiveTo: "2026-08-31" },
      // Another year.
      { studentId: "s3", routeId: "r1", academicYearCode: "2025-26", effectiveTo: null },
      // Another bus.
      { studentId: "s4", routeId: "r2", academicYearCode: "2026-27", effectiveTo: null },
      // Class the group list does not know.
      { studentId: "s5", routeId: "r1", academicYearCode: "2026-27", effectiveTo: null, dropShiftId: "main" },
      // On the roster's route but missing from the roster entirely.
      { studentId: "ghost", routeId: "r1", academicYearCode: "2026-27", effectiveTo: null },
    ],
    students: [
      { id: "s1", fullName: "Aarav", classId: "c1" },
      { id: "s2", fullName: "Bina", classId: "c1" },
      { id: "s3", fullName: "Chand", classId: "c1" },
      { id: "s4", fullName: "Devi", classId: "c1" },
      { id: "s5", fullName: "Esha", classId: "c9" },
    ],
    classes: [
      { id: "c1", name: "V" },
      { id: "c9", name: "Balvatika" },
    ],
    academicYearCode: "2026-27",
    routeId: "r1",
  });

  assert.deepEqual(
    riders.map((r) => r.studentId),
    ["s1", "s5", "ghost"],
    "live riders on this route in this year only",
  );
  assert.equal(riders[0].groupCode, "PRIMARY");
  assert.equal(riders[1].groupCode, null, "an unknown class name must not become Primary");
  assert.equal(riders[1].dropShiftId, "main", "the hand-placement is carried through");
  assert.equal(riders[2].groupCode, null, "a child missing from the roster has no group");
  assert.equal(riders[2].studentName, "ghost", "and is still named, never dropped");
}

console.log("  ✓ transport shifts — resolution, coverage, feasibility, suggestions");
