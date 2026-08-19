import assert from "node:assert/strict";
import { type BirthdayState, alreadySent, appendBirthdayLog, birthdayMessageFor, birthdayMessageLanguageFor, defaultBirthdaySettings, monthDay, normalizeBirthdaySettings, renderBirthdayMessage, studentsWithBirthday, upcomingBirthdays } from "./birthdayCards";

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
st = appendBirthdayLog(st, [{ key: "a:2026-08-20", studentId: "a", date: "2026-08-20", channel: "whatsapp", status: "sent", detail: "", at: "2026-08-20T03:30:00Z" }]);
assert.equal(alreadySent(st, "a", "2026-08-20", "whatsapp"), true);
assert.equal(alreadySent(st, "a", "2026-08-20", "social"), false);
st = appendBirthdayLog(st, [{ key: "a:2026-08-20", studentId: "a", date: "2026-08-20", channel: "whatsapp", status: "failed", detail: "x", at: "2026-08-20T04:00:00Z" }]);
assert.equal(st.log.length, 1, "same key+channel replaced, not duplicated");
console.log("OK — birthdayCards.selftest.ts");
