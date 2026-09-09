/**
 * Self-test: an online class opens when it should, and a link goes only
 * where a class can be.
 * Run: npx tsx apps/web/src/lib/onlineClasses.selftest.ts
 *
 * Three things have to hold:
 *
 *  1. The join window is the clock's, not the client's. Ten minutes before
 *     the bell it opens; half an hour after the end it closes whether or
 *     not the teacher remembered to press End. A cancelled class never
 *     opens, whatever the time.
 *  2. A pasted link reaches every phone in a section, so only a meeting
 *     host the school would plausibly use is accepted — and only over
 *     https. "meet.google.com/abc-defg-hij" typed without a scheme is a
 *     teacher, not an attacker, and is normalised rather than refused.
 *  3. The Meet participant list matches to the roster only when there is
 *     exactly one child it could be. Two Aaravs is nobody; "Aarav K" is
 *     Aarav Kumar when he is the only Aarav.
 */

import assert from "node:assert/strict";

import {
  autoEndDue,
  canJoinNow,
  istInstant,
  matchParticipantToRoster,
  normalizeJoinUrl,
  onlineClassPhase,
  readOnlineClassInput,
  reminderDue,
} from "./onlineClasses";

console.log("onlineClasses.selftest.ts");

const base = {
  date: "2026-09-10",
  startTime: "10:00",
  endTime: "10:40",
  status: "scheduled" as const,
  remindedAt: "",
};
const at = (t: string) => istInstant("2026-09-10", t);

// 1. Join window.
assert.equal(onlineClassPhase(base, at("09:30")), "upcoming");
assert.equal(canJoinNow(base, at("09:49")), false, "eleven minutes early is too early");
assert.equal(canJoinNow(base, at("09:50")), true, "ten minutes early opens the door");
assert.equal(onlineClassPhase(base, at("10:20")), "joinable", "the clock says open even if nobody pressed Start");
assert.equal(onlineClassPhase({ ...base, status: "live" }, at("10:20")), "live");
assert.equal(canJoinNow(base, at("11:09")), true, "grace after the bell");
assert.equal(canJoinNow(base, at("11:10")), false, "half an hour after the end it is over");
assert.equal(onlineClassPhase(base, at("11:10")), "over");
assert.equal(canJoinNow({ ...base, status: "cancelled" }, at("10:05")), false, "cancelled never opens");
assert.equal(canJoinNow({ ...base, status: "ended" }, at("10:05")), false, "ended never opens");

// Reminder: once, inside the fifteen minutes before, never after the start.
assert.equal(reminderDue(base, at("09:44")), false);
assert.equal(reminderDue(base, at("09:46")), true);
assert.equal(reminderDue(base, at("10:00")), false, "a reminder for a class that has begun is noise");
assert.equal(reminderDue({ ...base, remindedAt: "x" }, at("09:50")), false, "sent once");
assert.equal(reminderDue({ ...base, status: "live" }, at("09:50")), false);

// Auto-end: scheduled or live, thirty minutes past the end.
assert.equal(autoEndDue(base, at("11:09")), false);
assert.equal(autoEndDue(base, at("11:10")), true);
assert.equal(autoEndDue({ ...base, status: "live" }, at("11:10")), true);
assert.equal(autoEndDue({ ...base, status: "ended" }, at("12:00")), false);

// 2. Links.
assert.equal(normalizeJoinUrl("meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij");
assert.equal(normalizeJoinUrl("https://us02web.zoom.us/j/123?pwd=x"), "https://us02web.zoom.us/j/123?pwd=x");
assert.equal(normalizeJoinUrl("http://meet.google.com/abc"), null, "plain http is refused");
assert.equal(normalizeJoinUrl("https://evil.example/meet.google.com"), null, "host, not path");
assert.equal(normalizeJoinUrl("https://meet.google.com.evil.example/x"), null, "suffix trick");
assert.equal(normalizeJoinUrl("javascript:alert(1)"), null);
assert.equal(normalizeJoinUrl(""), null);

const ok = readOnlineClassInput({
  classId: "c1",
  sectionId: "s1",
  date: "2026-09-10",
  startTime: "10:00",
  endTime: "10:40",
  provider: "link",
  joinUrl: "meet.google.com/abc-defg-hij",
  periodNo: "3",
});
assert.ok(ok.ok);
if (ok.ok) {
  assert.equal(ok.value.joinUrl, "https://meet.google.com/abc-defg-hij");
  assert.equal(ok.value.periodNo, 3);
}
const bad = (raw: Record<string, unknown>) => {
  const r = readOnlineClassInput(raw);
  return r.ok ? "ok" : r.error;
};
assert.equal(bad({ classId: "c1", sectionId: "", date: "2026-09-10", startTime: "10:00", endTime: "10:40" }), "section_required");
assert.equal(bad({ classId: "c1", sectionId: "s1", date: "10/09/2026", startTime: "10:00", endTime: "10:40" }), "date_invalid");
assert.equal(bad({ classId: "c1", sectionId: "s1", date: "2026-09-10", startTime: "10:00", endTime: "09:40", provider: "link", joinUrl: "meet.google.com/a" }), "time_order");
assert.equal(bad({ classId: "c1", sectionId: "s1", date: "2026-09-10", startTime: "10:00", endTime: "15:00", provider: "link", joinUrl: "meet.google.com/a" }), "too_long");
assert.equal(bad({ classId: "c1", sectionId: "s1", date: "2026-09-10", startTime: "10:00", endTime: "10:40", provider: "link", joinUrl: "" }), "link_required");
assert.equal(bad({ classId: "c1", sectionId: "s1", date: "2026-09-10", startTime: "10:00", endTime: "10:40", provider: "link", joinUrl: "https://example.com/x" }), "link_invalid");
// A Meet class needs no link — the room is made on the teacher's account.
assert.equal(bad({ classId: "c1", sectionId: "s1", date: "2026-09-10", startTime: "10:00", endTime: "10:40", provider: "google_meet" }), "ok");

// 3. Roster matching.
const roster = [
  { studentId: "a", fullName: "Aarav Kumar" },
  { studentId: "b", fullName: "Priya Singh" },
  { studentId: "c", fullName: "Priya Sharma" },
  { studentId: "d", fullName: "Rohan" },
];
assert.equal(matchParticipantToRoster("Aarav Kumar", roster), "a");
assert.equal(matchParticipantToRoster("aarav k", roster), "a");
assert.equal(matchParticipantToRoster("Aarav", roster), "a", "only one Aarav");
assert.equal(matchParticipantToRoster("Priya", roster), null, "two Priyas is nobody");
assert.equal(matchParticipantToRoster("Priya Singh", roster), "b");
assert.equal(matchParticipantToRoster("Priya Sh", roster), "c");
assert.equal(matchParticipantToRoster("Rohan Verma", roster), "d", "roster has no surname to disagree");
assert.equal(matchParticipantToRoster("Sunita Devi", roster), null);
assert.equal(matchParticipantToRoster("", roster), null);

console.log("ok");
