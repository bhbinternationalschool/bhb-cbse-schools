/**
 * Self-test: bus register + driver's log book rules.
 * Run: npx tsx apps/web/src/lib/transportBoardingLog.selftest.ts
 *
 * What this pins, in the order it matters:
 *  1. An unmarked child is NOT MARKED — never absent, never boarded — in the
 *     counts, the exception list and the month report. An undo ("unmarked")
 *     reads the same as never tapped.
 *  2. A driver/attendant sees only their own bus: via Staff → Duties route
 *     links (dated) or the vehicle's driver, and a route brings its vehicle.
 *  3. The run list never drops a child: unknown stop → listed last; run not
 *     worked out → shown on every run, flagged; drop runs reverse the order.
 *  4. Km is end − start only when both exist and end ≥ start; ₹/km is null
 *     with no km, never a division by zero; GPS vs typed is tracked.
 */

import assert from "node:assert/strict";

import {
  boardingExceptions,
  boardingMonthReport,
  clampTappedAt,
  crewScope,
  dayKm,
  effectiveStatus,
  istDate,
  istDayBounds,
  liveRouteAssignments,
  monthCell,
  registerDayLabel,
  registerDayMarks,
  monthDates,
  odometerField,
  parseKm,
  ridersOnRun,
  runCounts,
  runsForRoute,
  rupeesToPaise,
  sourceForSave,
  statusAllowedOnTrip,
  vehicleMonthReport,
  type RiderAssignment,
  type RiderStudent,
} from "./transportBoardingLog";
import type { TransportShift } from "./transport";

console.log("transportBoardingLog.selftest.ts");

/* ── dates ─────────────────────────────────────────────────── */

// 00:30 UTC on 11 Oct is 06:00 IST on 11 Oct; 20:00 UTC on 10 Oct is 01:30 IST 11 Oct.
assert.equal(istDate(Date.parse("2026-10-11T00:30:00Z")), "2026-10-11");
assert.equal(istDate(Date.parse("2026-10-10T20:00:00Z")), "2026-10-11", "IST day starts at 18:30 UTC");
assert.deepEqual(istDayBounds("2026-10-11"), {
  fromIso: "2026-10-10T18:30:00.000Z",
  toIso: "2026-10-11T18:30:00.000Z",
});
assert.equal(monthDates("2026-02").length, 28);
assert.equal(monthDates("2028-02").length, 29);
assert.equal(monthDates("2026-13").length, 0);

const NOW = Date.parse("2026-10-11T03:00:00Z");
assert.equal(clampTappedAt("2026-10-11T02:59:00.000Z", NOW), "2026-10-11T02:59:00.000Z");
assert.equal(clampTappedAt("2027-01-01T00:00:00Z", NOW), new Date(NOW).toISOString(), "a future clock does not win forever");
assert.equal(clampTappedAt("garbage", NOW), new Date(NOW).toISOString());

/* ── statuses ──────────────────────────────────────────────── */

assert.equal(effectiveStatus("unmarked"), null, "an undo reads as no mark");
assert.equal(effectiveStatus(null), null);
assert.equal(effectiveStatus("boarded"), "boarded");
assert.equal(statusAllowedOnTrip("dropped", "AM"), false, "no 'dropped' on the morning pick-up");
assert.equal(statusAllowedOnTrip("dropped", "PM"), true);
assert.equal(statusAllowedOnTrip("unmarked", "AM"), true);

/* ── crew scope ────────────────────────────────────────────── */

const routes = [
  { id: "r1", vehicleId: "v1" },
  { id: "r2", vehicleId: "v2" },
  { id: "r3", vehicleId: "v1" }, // a second route run by the same vehicle
];
const vehicles = [
  { id: "v1", driverStaffId: "" },
  { id: "v2", driverStaffId: "drv2" },
];
const staff = [
  { id: "att1", status: "active", vehicleLinks: [{ routeId: "r1", role: "attendant", effectiveFrom: "2026-04-01", effectiveTo: null }] },
  { id: "old", status: "active", vehicleLinks: [{ routeId: "r1", role: "driver", effectiveFrom: "2026-04-01", effectiveTo: "2026-09-30" }] },
  { id: "gone", status: "inactive", vehicleLinks: [{ routeId: "r2", role: "driver" }] },
  { id: "drv2", status: "active", vehicleLinks: [] },
];
const scope = (id: string) => crewScope({ staffId: id, staff, routes, vehicles, date: "2026-10-11" });
assert.deepEqual(scope("att1"), { routeIds: ["r1", "r3"], vehicleIds: ["v1"] }, "route link brings its vehicle and that vehicle's other route");
assert.deepEqual(scope("drv2"), { routeIds: ["r2"], vehicleIds: ["v2"] }, "the vehicle's named driver");
assert.deepEqual(scope("old"), { routeIds: [], vehicleIds: [] }, "an ended link gives nothing");
assert.deepEqual(scope("gone"), { routeIds: [], vehicleIds: [] }, "inactive staff get nothing");
assert.deepEqual(scope(""), { routeIds: [], vehicleIds: [] }, "no staff id → nothing, never everything");

/* ── runs and riders ───────────────────────────────────────── */

const shift = (p: Partial<TransportShift> & { id: string }): TransportShift => ({
  name: p.id,
  direction: "drop",
  departTime: "13:30",
  classGroups: [],
  weekdays: [],
  isActive: true,
  ...p,
});
const route = {
  id: "r1",
  stops: [
    { id: "s1", name: "Ayar", sequence: 1 },
    { id: "s2", name: "Kurauli", sequence: 2 },
    { id: "s3", name: "Ekala", sequence: 3 },
  ],
  shifts: [
    shift({ id: "am", name: "Morning", direction: "pickup", departTime: "06:00" }),
    shift({ id: "early", name: "Early drop", departTime: "11:30", classGroups: ["PRE_PRIMARY"], weekdays: [1, 2, 3, 4, 5] }),
    shift({ id: "main", name: "Main drop", departTime: "13:30", classGroups: ["PRIMARY", "MIDDLE", "SECONDARY"] }),
  ],
};

// 2026-10-10 is a Saturday: the early drop does not run.
assert.deepEqual(runsForRoute(route, "PM", "2026-10-10").map((r) => r.shiftId), ["main"]);
assert.deepEqual(runsForRoute(route, "PM", "2026-10-12").map((r) => r.shiftId), ["early", "main"]);
assert.deepEqual(
  runsForRoute({ id: "x", stops: [], shifts: [] } as never, "AM", "2026-10-12").map((r) => [r.shiftId, r.name]),
  [["", "Morning pick-up"]],
  "a route with no runs makes one journey",
);

const asg = (p: Partial<RiderAssignment> & { id: string; studentId: string }): RiderAssignment => ({
  routeId: "r1",
  stopId: "s1",
  academicYearCode: "2026-27",
  effectiveFrom: "2026-04-01",
  effectiveTo: null,
  serviceMode: "both",
  ...p,
});
const assignments: RiderAssignment[] = [
  asg({ id: "a1", studentId: "kid_ukg", stopId: "s1" }),
  asg({ id: "a2", studentId: "kid_v", stopId: "s3" }),
  asg({ id: "a3", studentId: "kid_lost_stop", stopId: "st_gone" }),
  asg({ id: "a4", studentId: "kid_noclass", stopId: "s2" }),
  asg({ id: "a5", studentId: "kid_pickup_only", stopId: "s2", serviceMode: "pickup" }),
  asg({ id: "a6", studentId: "kid_ended", effectiveTo: "2026-09-01" }),
  asg({ id: "a7", studentId: "kid_suspended", boardingSuspended: true }),
  asg({ id: "a8", studentId: "kid_v", stopId: "s2", academicYearCode: "2025-26", effectiveFrom: "2025-04-01" }), // older duplicate
];
const students = new Map<string, RiderStudent>([
  ["kid_ukg", { id: "kid_ukg", fullName: "Aarav", classId: "c_ukg", sectionId: "sec_ukg" }],
  ["kid_v", { id: "kid_v", fullName: "Bhavna", classId: "c_v", sectionId: "sec_v" }],
  ["kid_lost_stop", { id: "kid_lost_stop", fullName: "Chetan", classId: "c_v", sectionId: "sec_v" }],
  ["kid_noclass", { id: "kid_noclass", fullName: "Divya", classId: "", sectionId: "" }],
  ["kid_pickup_only", { id: "kid_pickup_only", fullName: "Esha", classId: "c_v", sectionId: "sec_v" }],
]);
const classNameById = new Map([
  ["c_ukg", "UKG"],
  ["c_v", "V"],
]);

const live = liveRouteAssignments(assignments, "r1", "2026-10-12", "PM");
assert.deepEqual(
  live.map((a) => a.id).sort(),
  ["a1", "a2", "a3", "a4"],
  "ended, suspended and pickup-only riders are not on the drop; the older duplicate loses",
);

const main = ridersOnRun({
  route,
  assignments,
  students,
  classNameById,
  classesKnown: true,
  date: "2026-10-12",
  trip: "PM",
  shiftId: "main",
});
assert.deepEqual(
  main.map((r) => r.studentId),
  ["kid_v", "kid_noclass", "kid_lost_stop"],
  "drop order reverses (stop 3 first); unknown stop last; the UKG child is on the early drop",
);
assert.equal(main.find((r) => r.studentId === "kid_v")?.shiftId, "main", "Class V resolves to the main drop by class group");
assert.equal(main.find((r) => r.studentId === "kid_noclass")?.shiftUnresolved, true, "unknown class → flagged, still listed");
assert.equal(main.find((r) => r.studentId === "kid_lost_stop")?.stopName, "", "a broken stop link is listed, not hidden");

const early = ridersOnRun({
  route,
  assignments,
  students,
  classNameById,
  classesKnown: true,
  date: "2026-10-12",
  trip: "PM",
  shiftId: "early",
});
assert.deepEqual(early.map((r) => r.studentId), ["kid_noclass", "kid_ukg"], "the unresolved child appears on every run");

const amAll = ridersOnRun({
  route,
  assignments,
  students,
  classNameById,
  classesKnown: false, // the class list could not be read
  date: "2026-10-12",
  trip: "AM",
  shiftId: "am",
});
assert.equal(amAll.length, 5, "class list unknown → the whole route, never an empty list");
assert.deepEqual(amAll.slice(0, 1).map((r) => r.stopName), ["Ayar"], "morning order runs stop 1 first");

/* ── counts and exceptions ─────────────────────────────────── */

const marks: Record<string, "boarded" | "not_boarded" | "dropped" | null> = {
  kid_v: "boarded",
  kid_noclass: "not_boarded",
};
assert.deepEqual(
  runCounts(main, (id) => marks[id] ?? null),
  { riders: 3, boarded: 1, dropped: 0, notBoarded: 1, unmarked: 1 },
  "the unmarked child counts as unmarked, not as absent",
);

const withRoute = amAll.map((r) => ({ ...r, routeId: "r1" }));
const am: Record<string, "boarded" | "not_boarded"> = {
  kid_ukg: "boarded", // class register: absent
  kid_v: "not_boarded", // class register: present
  kid_lost_stop: "boarded", // class register: present → fine
  kid_pickup_only: "boarded", // section register taken but child has no mark → unchecked
};
const pm: Record<string, "not_boarded" | "dropped"> = { kid_lost_stop: "not_boarded" };
const classMarks: Record<string, "P" | "A"> = { kid_ukg: "A", kid_v: "P", kid_lost_stop: "P" };
const ex = boardingExceptions({
  riders: withRoute,
  amStatus: (id) => am[id as keyof typeof am] ?? null,
  pmStatus: (id) => pm[id as keyof typeof pm] ?? null,
  classMark: (id) => classMarks[id as keyof typeof classMarks] ?? null,
  sectionsWithRegister: new Set(["sec_ukg", "sec_v"]),
});
assert.deepEqual(
  ex.exceptions.map((e) => [e.kind, e.studentId]),
  [
    ["boarded_absent", "kid_ukg"],
    ["present_not_boarded", "kid_v"],
    ["no_return", "kid_lost_stop"],
  ],
);
assert.equal(ex.unchecked, 1, "bus-marked but no class mark → counted as unchecked, not an exception");

const noRegister = boardingExceptions({
  riders: withRoute,
  amStatus: (id) => am[id as keyof typeof am] ?? null,
  pmStatus: () => null,
  classMark: (id) => classMarks[id as keyof typeof classMarks] ?? null,
  sectionsWithRegister: new Set(), // class attendance not taken today
});
assert.equal(noRegister.exceptions.length, 0, "no class register → nobody is called absent");
assert.equal(noRegister.unchecked, 4);

/* ── log book ──────────────────────────────────────────────── */

assert.deepEqual(dayKm({ startKm: 26378, endKm: 26408 }), { ok: true, km: 30 });
assert.deepEqual(dayKm({ startKm: 26408, endKm: 26378 }), { ok: false, reason: "end_before_start" });
assert.deepEqual(dayKm({ startKm: 26378, endKm: null }), { ok: false, reason: "incomplete" });

assert.deepEqual(odometerField(null, 26378), { value: 26378, source: "gps", saved: false }, "GPS offered, labelled, not saved");
assert.deepEqual(odometerField({ value: 26380, source: "typed" }, 26378), { value: 26380, source: "typed", saved: true }, "a saved correction beats GPS");
assert.deepEqual(odometerField(null, null), { value: null, source: "", saved: false }, "no GPS, nothing saved → blank, not 0");
assert.equal(sourceForSave(26378, 26378, "gps"), "gps");
assert.equal(sourceForSave(26379, 26378, "gps"), "typed", "an edited GPS figure is typed");
assert.equal(sourceForSave(null, 26378, "gps"), "");

assert.equal(parseKm(""), null, "blank → not recorded");
assert.equal(parseKm("0"), 0);
assert.equal(parseKm("-3"), "invalid");
assert.equal(parseKm("12.34"), 12.3);
assert.equal(rupeesToPaise("₹1,250.50"), 125050);
assert.equal(rupeesToPaise(""), null);

const vm = vehicleMonthReport({
  vehicles: [
    { id: "v1", name: "Magic-1", registrationNo: "UP65PT3540" },
    { id: "v2", name: "Rajesh Van", registrationNo: "RAJESH VAN" },
  ],
  logs: [
    { vehicleId: "v1", logDate: "2026-10-09", startKm: 26324, endKm: 26378, startSource: "gps", endSource: "gps" },
    { vehicleId: "v1", logDate: "2026-10-10", startKm: 26378, endKm: 26408, startSource: "gps", endSource: "typed" },
    { vehicleId: "v1", logDate: "2026-10-11", startKm: 26408, endKm: null, startSource: "gps", endSource: "" },
    { vehicleId: "v2", logDate: "2026-10-10", startKm: 100, endKm: 50, startSource: "typed", endSource: "typed" },
  ],
  fills: [
    { vehicleId: "v1", fillDate: "2026-10-09", quantity: 10, unit: "kg", amountPaise: 90000, voided: false },
    { vehicleId: "v1", fillDate: "2026-10-10", quantity: 99, unit: "kg", amountPaise: 999900, voided: true },
  ],
});
assert.deepEqual(
  { km: vm[0]!.km, days: vm[0]!.daysWithKm, gps: vm[0]!.gpsDays, typed: vm[0]!.typedDays, problems: vm[0]!.problemDays, kg: vm[0]!.kg, rs: vm[0]!.amountPaise, perKm: vm[0]!.rupeesPerKm },
  { km: 84, days: 2, gps: 1, typed: 1, problems: 1, kg: 10, rs: 90000, perKm: 10.71 },
  "voided fills are out; an open day is a problem, not 0 km",
);
assert.equal(vm[1]!.rupeesPerKm, null, "no km → no ₹/km (never a division by zero)");
assert.equal(vm[1]!.km, 0);

/* ── month report ──────────────────────────────────────────── */

const month = boardingMonthReport({
  month: "2026-10",
  riders: [
    { studentId: "kid_v", fullName: "Bhavna", admissionNo: "1", className: "V", routeName: "Magic-1" },
    { studentId: "kid_ukg", fullName: "Aarav", admissionNo: "2", className: "UKG", routeName: "Magic-1" },
  ],
  marks: [
    { studentId: "kid_v", runDate: "2026-10-09", trip: "AM", status: "boarded" },
    { studentId: "kid_v", runDate: "2026-10-09", trip: "PM", status: "dropped" },
    { studentId: "kid_v", runDate: "2026-10-10", trip: "AM", status: "not_boarded" },
    { studentId: "kid_v", runDate: "2026-10-12", trip: "AM", status: "unmarked" },
    { studentId: "kid_v", runDate: "2026-09-30", trip: "AM", status: "boarded" }, // other month
  ],
});
const bhavna = month.find((r) => r.studentId === "kid_v")!;
assert.deepEqual(
  { am: bhavna.amRidden, pm: bhavna.pmRidden, nb: bhavna.notBoarded, days: bhavna.daysRidden },
  { am: 1, pm: 1, nb: 1, days: 1 },
);
assert.equal(monthCell(bhavna.days["2026-10-09"]), "B/D");
assert.equal(monthCell(bhavna.days["2026-10-10"]), "N/–");
assert.equal(monthCell(bhavna.days["2026-10-12"]), "", "an undone tap leaves the day blank");
const aarav = month.find((r) => r.studentId === "kid_ukg")!;
assert.equal(aarav.daysRidden, 0, "a rider with no marks is listed, with nothing claimed");
assert.equal(Object.keys(aarav.days).length, 0);

/* ── the register as other screens read it ── */

{
  const base = { runDate: "2026-10-13", routeId: "r1", studentId: "s1", tappedAt: "2026-10-13T02:00:00.000Z", markedByName: "Ram" };
  const out = registerDayMarks([
    { ...base, trip: "AM", status: "boarded", lat: 25.4, lng: 82.9, accuracyM: 8 },
    { ...base, trip: "PM", status: "unmarked" },
    { ...base, studentId: "s2", trip: "AM", status: "not_boarded", lat: null, lng: Number.NaN },
  ]);
  assert.equal(out.length, 2, "an undone tap is no mark at all");
  assert.deepEqual(
    out.map((m) => `${m.studentId}${m.trip}:${m.status}`),
    ["s1AM:boarded", "s2AM:not_boarded"],
  );
  assert.equal(out[0]!.date, "2026-10-13");
  assert.equal(out[0]!.lat, 25.4);
  assert.equal(out[1]!.lat, null, "no location stays null");
  assert.equal(out[1]!.lng, null, "a broken number is not a coordinate");
  assert.equal(out[1]!.accuracyM, null);

  assert.equal(registerDayLabel(null, null), "", "nothing marked → nothing said");
  assert.equal(registerDayLabel("boarded", "dropped"), "AM boarded · PM dropped");
  assert.equal(registerDayLabel("not_boarded", null), "AM not boarded · PM not marked");
  assert.equal(registerDayLabel(null, "boarded"), "AM not marked · PM boarded");
}

console.log("transportBoardingLog.selftest.ts: all assertions passed");
