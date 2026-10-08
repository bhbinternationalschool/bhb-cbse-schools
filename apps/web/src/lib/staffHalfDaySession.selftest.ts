/**
 * Run: npx tsx src/lib/staffHalfDaySession.selftest.ts
 *
 * Director, 6 Oct 2026: a half-day leave says which half is taken off, and
 * the day counts as a half day (HD) only when the other half is actually
 * punched. Before this an approved half-day leave was filed "HD" — counted
 * present — even when the person never came in.
 */
import assert from "node:assert/strict";
import {
  halfDayLeaveMark,
  isHalfDayLeaveMark,
  staffMarkTotals,
  type StaffAttendanceMark,
} from "./staffAttendance";
import { normalizeHalfDaySession } from "./staffHr";
import { parseHalfDaySession, parseLeaveApplyStart } from "./staffLeaveWa";

console.log("staffHalfDaySession.selftest.ts");

/* ── Not punched: the day is absent, and says which half is still owed ── */
{
  const m = halfDayLeaveMark(undefined, { typeCode: "CL", halfDaySession: "morning" });
  assert.equal(m.status, "A", "a half-day leave alone is not a day at work");
  assert.equal(m.note, "Half-day leave (CL, morning off) · not punched for the afternoon");
  assert.equal(m.punchWay, "leave_sync");
  assert.ok(isHalfDayLeaveMark(m), "the punch must still recognise it as half-day leave");

  const pm = halfDayLeaveMark({ inTime: "", punchWay: "" }, { typeCode: "CL", halfDaySession: "afternoon" });
  assert.equal(pm.status, "A");
  assert.match(pm.note, /afternoon off\) · not punched for the morning$/);
}

/* ── Punched for the other half: HD, and the punch keeps its channel ── */
{
  const m = halfDayLeaveMark({ inTime: "13:05", punchWay: "self" }, { typeCode: "CL", halfDaySession: "morning" });
  assert.equal(m.status, "HD");
  assert.equal(m.note, "Half-day leave (CL, morning off) · worked the afternoon");
  assert.equal(m.punchWay, "self", "the punch's own channel is not overwritten");
}

/* ── Requests from before 6 Oct carry no session ── */
{
  const m = halfDayLeaveMark(undefined, { typeCode: "ML" });
  assert.equal(m.note, "Half-day leave (ML) · not punched for the other half");
  assert.equal(normalizeHalfDaySession(undefined), "");
  assert.equal(normalizeHalfDaySession("evening"), "", "only morning or afternoon");
  assert.equal(normalizeHalfDaySession("afternoon"), "afternoon");
}

/* ── Old leave-sync HD marks (note "Half-day leave (CL)") still match ── */
assert.ok(isHalfDayLeaveMark({ note: "Half-day leave (CL)" }));
assert.ok(!isHalfDayLeaveMark({ note: "Office QR punch-in · On time" }));

/* ── Totals: an unpunched half day is absent, a punched one present ── */
{
  const base = { inTime: "", outTime: "", punchWay: "" as const };
  const unpunched: StaffAttendanceMark = {
    staffId: "s1",
    ...base,
    ...halfDayLeaveMark(undefined, { typeCode: "CL", halfDaySession: "morning" }),
  };
  const punched: StaffAttendanceMark = {
    staffId: "s2",
    ...base,
    inTime: "13:00",
    ...halfDayLeaveMark({ inTime: "13:00", punchWay: "self" }, { typeCode: "CL", halfDaySession: "morning" }),
  };
  const t = staffMarkTotals([unpunched, punched]);
  assert.equal(t.present, 1, "only the half day that was worked counts present");
  assert.equal(t.absent, 1);
  assert.equal(t.halfDay, 1);
}

/* ── WhatsApp: only a plain statement of the half sets it ── */
assert.equal(parseHalfDaySession("CL tomorrow first half"), "morning");
assert.equal(parseHalfDaySession("kal second half leave chahiye"), "afternoon");
assert.equal(parseHalfDaySession("morning off kal"), "morning");
assert.equal(parseHalfDaySession("half day leave kal"), "", "\"half day\" alone could be either half");
assert.equal(parseHalfDaySession("leave kal"), "");
{
  const s = parseLeaveApplyStart("CL leave 2026-10-08 second half", "2026-10-06");
  assert.ok(s);
  assert.equal(s!.halfDay, true, "naming a half makes it a half day");
  assert.equal(s!.halfDaySession, "afternoon");
}

console.log("  ✓ half-day session — HD only once the other half is punched");
