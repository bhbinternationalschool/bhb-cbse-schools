import assert from "node:assert/strict";
import { type BirthdayState, alreadySent, appendBirthdayLog, birthdayCardSignature, birthdayFallsOn, birthdayMessageFor, birthdayMessageLanguageFor, defaultBirthdaySettings, monthDay, normalizeBirthdayState, normalizeBirthdaySettings, renderBirthdayMessage, staffBirthdayMessageFor, staffWithBirthday, studentsWithBirthday, upcomingBirthdays, upcomingStaffBirthdays } from "./birthdayCards";

console.log("birthdayCards.selftest.ts");
const students = [
  { id: "a", fullName: "Aarav Sharma", dob: "2015-08-20", status: "active", admissionNo: "ADM1", academicYearCode: "2026-27" },
  { id: "a_old", fullName: "Aarav Sharma", dob: "2015-08-20", status: "active", admissionNo: "ADM1", academicYearCode: "2025-26" },
  { id: "b", fullName: "Riya Das", dob: "2016-08-20", status: "left" },
  { id: "c", fullName: "Zoya Khan", dob: "2014-02-29", status: "active" },
  { id: "d", fullName: "No Dob", dob: "", status: "active" },
  { id: "e", fullName: "Bad Dob", dob: "20-08-2015", status: "active" },
];
assert.equal(monthDay("2015-08-20"), "08-20");
assert.equal(monthDay("20-08-2015"), "");
assert.deepEqual(studentsWithBirthday(students, "2026-08-20").map((s) => s.id), ["a"], "inactive and bad DOBs excluded; per-session duplicate rows counted once (latest session kept)");
assert.deepEqual(studentsWithBirthday(students, "2026-02-28").map((s) => s.id), ["c"], "29-Feb celebrated on 28-Feb in a non-leap year");
assert.deepEqual(studentsWithBirthday(students, "2028-02-28").map((s) => s.id), [], "…but not in a leap year");
assert.deepEqual(studentsWithBirthday(students, "2028-02-29").map((s) => s.id), ["c"]);
const up = upcomingBirthdays(students, "2026-08-19", 3);
assert.deepEqual(up.map((u) => [u.date, u.student.id, u.age]), [["2026-08-20", "a", 11]]);

assert.equal(renderBirthdayMessage("Hi {{firstName}} {{missing}}!", { firstName: "Aarav" }), "Hi Aarav !".replace(" !", " !"));
const s = defaultBirthdaySettings();
const msg = birthdayMessageFor({ settings: s, language: "en", childName: "Aarav Sharma", guardianName: "Mr Sharma", className: "VI-A", age: 11, schoolName: "BHB", cardLink: "https://x/card" });
assert.match(msg, /Dear Mr Sharma/);
assert.match(msg, /Aarav Sharma \(VI-A\)/);
assert.match(msg, /https:\/\/x\/card/);
const hi = birthdayMessageFor({ settings: { ...s, messageHi: "{{firstName}} को बधाई {{cardLink}}" }, language: "hi", childName: "Aarav Sharma", guardianName: "", className: "", age: null, schoolName: "BHB", cardLink: "L" });
assert.equal(hi, "Aarav को बधाई L");
// Language: family pref wins; unknown → school default; regional → hi.
assert.equal(birthdayMessageLanguageFor({ preferredLanguage: "" }, "hi"), "hi");
assert.equal(birthdayMessageLanguageFor({ preferredLanguage: "en" }, "hi"), "en");
assert.equal(birthdayMessageLanguageFor({ preferredLanguage: "bn" }, "en"), "hi");
// Settings normalise garbage.
const n = normalizeBirthdaySettings({ design: "neon", format: "poster", sendHour: 27, autoSend: "yes", waTemplateVars: ["childName", "", 5] });
assert.equal(n.design, "confetti");
assert.equal(n.format, "square");
assert.equal(n.sendHour, 9);
assert.equal(n.autoSend, false);
assert.deepEqual(n.waTemplateVars, ["childName", "5"]);
// Log: never twice.
let st: BirthdayState = { settings: s, log: [] };
st = appendBirthdayLog(st, [{ key: "a:2026-08-20", subjectId: "a", subject: "student", date: "2026-08-20", channel: "whatsapp", status: "sent", detail: "", at: "2026-08-20T03:30:00Z" }]);
assert.equal(alreadySent(st, "a", "2026-08-20", "whatsapp"), true);
assert.equal(alreadySent(st, "a", "2026-08-20", "social"), false);
st = appendBirthdayLog(st, [{ key: "a:2026-08-20", subjectId: "a", subject: "student", date: "2026-08-20", channel: "whatsapp", status: "failed", detail: "x", at: "2026-08-20T04:00:00Z" }]);
assert.equal(st.log.length, 1, "same key+channel replaced, not duplicated");
/* ─── Staff birthdays ──────────────────────────────────────────────── */

const staff = [
  { id: "s1", fullName: "Vishnu Om Tripathi", dateOfBirth: "1988-09-22", status: "active", designationId: "d1", mobile: "9000000001" },
  { id: "s2", fullName: "Left Already", dateOfBirth: "1990-09-22", status: "inactive", mobile: "9000000002" },
  { id: "s3", fullName: "Leap Day", dateOfBirth: "1992-02-29", status: "active", mobile: "9000000003" },
  { id: "s4", fullName: "No Dob", dateOfBirth: "", status: "active", mobile: "9000000004" },
];
assert.deepEqual(staffWithBirthday(staff, "2026-09-22").map((x) => x.id), ["s1"], "inactive staff and blank dates of birth are never greeted");
assert.deepEqual(staffWithBirthday(staff, "2026-02-28").map((x) => x.id), ["s3"], "29-Feb greeted on 28-Feb in a non-leap year");
assert.deepEqual(staffWithBirthday(staff, "2028-02-28").map((x) => x.id), [], "…but not in a leap year");
assert.equal(birthdayFallsOn("1992-02-29", "2028-02-29"), true);
assert.deepEqual(upcomingStaffBirthdays(staff, "2026-09-21", 3).map((u) => [u.date, u.member.id, u.age]), [["2026-09-22", "s1", 38]]);

const staffMsg = staffBirthdayMessageFor({ settings: s, language: "en", name: "Vishnu Om Tripathi", designation: "Teacher", age: 38, schoolName: "BHB", cardLink: "https://x/card" });
assert.match(staffMsg, /Dear Vishnu Om Tripathi/);
assert.doesNotMatch(staffMsg, /38/, "a colleague's age is not announced unless the school puts it back in the template");
assert.match(staffMsg, /https:\/\/x\/card/);
assert.equal(
  staffBirthdayMessageFor({ settings: { ...s, staffMessageHi: "{{firstName}} जी को बधाई — {{designation}}" }, language: "hi", name: "Vishnu Om Tripathi", designation: "शिक्षक", age: null, schoolName: "BHB", cardLink: "L" }),
  "Vishnu जी को बधाई — शिक्षक",
);

// Who signs: a child hears from the Principal, a colleague from the Director.
assert.equal(birthdayCardSignature(s, "student"), "With warm wishes — Principal");
assert.equal(birthdayCardSignature(s, "staff"), "With warm regards — Director");
assert.equal(birthdayCardSignature({ ...s, principalName: "A Principal", directorName: "Ashish Singh" }, "student"), "With warm wishes — A Principal, Principal");
assert.equal(birthdayCardSignature({ ...s, principalName: "A Principal", directorName: "Ashish Singh" }, "staff"), "With warm regards — Ashish Singh, Director");

// A staff greeting and a student greeting on the same day are separate rows.
let st2: BirthdayState = { settings: s, log: [] };
st2 = appendBirthdayLog(st2, [
  { key: "x:2026-09-22", subjectId: "x", subject: "student", date: "2026-09-22", channel: "whatsapp", status: "sent", detail: "", at: "2026-09-22T03:30:00Z" },
  { key: "staff:x:2026-09-22", subjectId: "x", subject: "staff", date: "2026-09-22", channel: "whatsapp", status: "sent", detail: "", at: "2026-09-22T03:31:00Z" },
]);
assert.equal(st2.log.length, 2, "a student and a staff member sharing an id do not collide");
assert.equal(alreadySent(st2, "x", "2026-09-22", "whatsapp", "staff"), true);
assert.equal(alreadySent(st2, "y", "2026-09-22", "whatsapp", "staff"), false);

// Rows written before staff birthdays existed carry `studentId` and no subject.
const migrated = normalizeBirthdayState({ log: [{ key: "old:2026-08-20", studentId: "old", date: "2026-08-20", channel: "whatsapp", status: "sent", detail: "", at: "2026-08-20T03:30:00Z" }] });
assert.equal(migrated.log[0].subjectId, "old", "an old log row keeps its name rather than going blank");
assert.equal(migrated.log[0].subject, "student");
assert.equal(alreadySent(migrated, "old", "2026-08-20", "whatsapp"), true, "and still counts as sent, so an upgrade never re-sends yesterday");

// Staff settings normalise garbage the same way the student ones do.
const ns = normalizeBirthdaySettings({ staffEnabled: "yes", staffWaTemplateVars: ["name", "", 7], directorName: "  Ashish Singh  " });
assert.equal(ns.staffEnabled, false, "only a real true turns staff greetings on");
assert.deepEqual(ns.staffWaTemplateVars, ["name", "7"]);
assert.equal(ns.directorName, "Ashish Singh");

console.log("OK — birthdayCards.selftest.ts");
