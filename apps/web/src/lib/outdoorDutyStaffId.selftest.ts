/**
 * Regression test: an attendance mark may only be filed against a real
 * staff record.
 *
 * The chat actor (resolveChatActor / staffChatSelfId) manufactures a
 * synthetic `sess_…` key when a login resolves to no staff row. That is
 * fine for chat — a participant needs some stable key — but the
 * outdoor-duty flow carried it into staff attendance, and on 2026-09-04 a
 * mark was found in production filed against
 * `sess_director_bhbinternationa`. A mark keyed that way joins to nothing:
 * invisible to the roster, to every attendance report, and to payroll.
 *
 * Run: npx tsx src/lib/outdoorDutyStaffId.selftest.ts
 */
import assert from "node:assert/strict";
import type { StaffRecord } from "./foundationMasters";
import {
  endOutdoorDuty,
  loadStaffAttendance,
  NO_STAFF_RECORD_ERROR,
  ROSTER_UNAVAILABLE_ERROR,
  staffIdIsOnRoster,
  startOutdoorDuty,
} from "./staffAttendance";

console.log("outdoorDutyStaffId.selftest.ts");

const AY = "2026-27";
/** The exact id the fallback produces for director@bhbinternational.school. */
const SYNTHETIC_ID = "sess_director_bhbinternationa";

const staff = (id: string, fullName: string): StaffRecord =>
  ({
    id,
    empCode: id.toUpperCase(),
    fullName,
    status: "active",
  }) as StaffRecord;

const ROSTER: StaffRecord[] = [
  staff("stf_1", "VISHNU OM TRIPATHI"),
  staff("stf_2", "SURAJ KUMAR"),
];

// ── The predicate itself ───────────────────────────────────────────────
assert.equal(staffIdIsOnRoster(ROSTER, "stf_1"), true);
assert.equal(staffIdIsOnRoster(ROSTER, SYNTHETIC_ID), false);
assert.equal(staffIdIsOnRoster(ROSTER, ""), false);
assert.equal(staffIdIsOnRoster([], "stf_1"), false);
assert.equal(staffIdIsOnRoster(undefined, "stf_1"), false);

const marksFor = (staffId: string) =>
  loadStaffAttendance()
    .registers.flatMap((r) => r.marks)
    .filter((m) => m.staffId === staffId);

const sessionsFor = (staffId: string) =>
  loadStaffAttendance().outdoorDuty.filter((s) => s.staffId === staffId);

// ── A session WITH a staff record files an outdoor duty ────────────────
const started = startOutdoorDuty({
  academicYearCode: AY,
  staffId: "stf_1",
  purpose: "official_errand",
  destination: "SBI branch, Cantt",
  createdBy: "VISHNU OM TRIPATHI",
  roster: ROSTER,
});
assert.equal(started.ok, true, "real staff id is accepted");
assert.ok(started.ok && started.session.status === "active");
assert.equal(sessionsFor("stf_1").length, 1, "session recorded");
const mark = marksFor("stf_1")[0];
assert.ok(mark, "attendance mark written for the real staff id");
assert.equal(mark!.status, "P");
assert.equal(mark!.punchWay, "outdoor");
assert.match(mark!.note, /Outdoor duty/);

// ── A session WITHOUT one is refused, and writes no mark ───────────────
const beforeStart = JSON.stringify(loadStaffAttendance());
const refusedStart = startOutdoorDuty({
  academicYearCode: AY,
  staffId: SYNTHETIC_ID,
  purpose: "official_errand",
  destination: "SBI branch, Cantt",
  createdBy: "Director",
  roster: ROSTER,
});
assert.equal(refusedStart.ok, false, "synthetic session id is refused");
assert.equal(
  !refusedStart.ok && refusedStart.error,
  NO_STAFF_RECORD_ERROR,
  "refusal explains the login is not linked to a staff record",
);
assert.equal(marksFor(SYNTHETIC_ID).length, 0, "NO mark written");
assert.equal(sessionsFor(SYNTHETIC_ID).length, 0, "NO session written");
assert.equal(
  JSON.stringify(loadStaffAttendance()),
  beforeStart,
  "refused start leaves attendance state byte-identical",
);

// ── Check-in is guarded too — the mark it writes is keyed the same way ─
const foreignSessionId = started.ok ? started.session.id : "";
const beforeEnd = JSON.stringify(loadStaffAttendance());
const refusedEnd = endOutdoorDuty({
  academicYearCode: AY,
  sessionId: foreignSessionId,
  staffId: SYNTHETIC_ID,
  markedBy: "Director",
  roster: ROSTER,
});
assert.equal(refusedEnd.ok, false, "check-in with a synthetic id is refused");
assert.equal(!refusedEnd.ok && refusedEnd.error, NO_STAFF_RECORD_ERROR);
assert.equal(marksFor(SYNTHETIC_ID).length, 0, "still NO mark");
assert.equal(
  JSON.stringify(loadStaffAttendance()),
  beforeEnd,
  "refused check-in leaves attendance state byte-identical",
);

// ── An unloaded roster is "cannot verify", not "verified absent" ───────
// Both refuse the write; only the wording differs, so a real teacher on a
// cold client is not told they have no staff record.
const beforeCold = JSON.stringify(loadStaffAttendance());
const coldStart = startOutdoorDuty({
  academicYearCode: AY,
  staffId: "stf_2",
  purpose: "official_errand",
  destination: "Block office",
  createdBy: "SURAJ KUMAR",
  roster: [],
});
assert.equal(coldStart.ok, false, "empty roster cannot vouch for anyone");
assert.equal(!coldStart.ok && coldStart.error, ROSTER_UNAVAILABLE_ERROR);
assert.equal(sessionsFor("stf_2").length, 0, "cold client opens no session");
assert.equal(
  JSON.stringify(loadStaffAttendance()),
  beforeCold,
  "refused cold start leaves attendance state byte-identical",
);

// ── The real staff member can still close their own session ────────────
const ended = endOutdoorDuty({
  academicYearCode: AY,
  sessionId: foreignSessionId,
  staffId: "stf_1",
  markedBy: "VISHNU OM TRIPATHI",
  roster: ROSTER,
});
assert.equal(ended.ok, true, "the guard does not block the legitimate path");
assert.equal(ended.ok && ended.session.status, "ended");
assert.match(marksFor("stf_1")[0]!.note, /Outdoor duty closed/);

console.log("All outdoor-duty staff-id checks passed.");
