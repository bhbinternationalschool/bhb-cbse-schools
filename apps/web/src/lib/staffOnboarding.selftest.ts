/**
 * Self-test: how staff are walked through their day on WhatsApp — the
 * morning attendance question, the guide to what they teach, finishing open
 * work first, role switching, messages to the director, and adding a number
 * to a staff record. Built on 29 Sep 2026 from the director's brief after
 * the first day staff used the bot.
 *
 * Run: npx tsx src/lib/staffOnboarding.selftest.ts
 */

import assert from "node:assert/strict";

import {
  composeMorningAttendanceAsk,
  composeOpenWorkReminder,
  composeFeedbackRecipientAsk,
  composeRolesFooter,
  composeStaffFeedbackAck,
  composeStaffLinkFound,
  composeStaffLinkRequested,
  composeStaffWorkGuide,
  isCancelOpenWork,
  isPunchCodeOnly,
  isClassChannelPostPrefix,
  isRolesAsk,
  makeStaffLinkCode,
  maskMobile10,
  matchStaffForLink,
  parseRoleSwitch,
  parseFeedbackRecipient,
  parseSkipOwnAttendance,
  parseStaffFeedback,
  parseStaffLinkDecision,
  PRIVATE_FEEDBACK_LOG_TEXT,
  shortSection,
  shouldAskMorningAttendance,
  staffWorkProfile,
  switchableRoles,
  type StaffRoleNote,
} from "./staffOnboarding";
import { parseErpCommandLocal } from "./erpCommands";
import { detectClassChannelIntent } from "./waClassChannelEngine";
import type { MastersState } from "./masters";
import type { StaffRecord } from "./foundationMasters";

console.log("staffOnboarding.selftest.ts");

/* ── Morning: own attendance first ─────────────────────────────────── */

const morning = { flow: "teacher", todayIso: "2026-09-30", istHour: 8, lastAskedOn: "", punchedIn: false, workingDay: true };
assert.equal(shouldAskMorningAttendance(morning), true, "a teacher's first message on a working morning");
assert.equal(shouldAskMorningAttendance({ ...morning, flow: "staff" }), true, "office staff too");
assert.equal(shouldAskMorningAttendance({ ...morning, flow: "owner" }), false, "never the director");
assert.equal(shouldAskMorningAttendance({ ...morning, flow: "parent" }), false);
assert.equal(shouldAskMorningAttendance({ ...morning, punchedIn: true }), false, "already punched in");
assert.equal(shouldAskMorningAttendance({ ...morning, lastAskedOn: "2026-09-30" }), false, "once a day");
assert.equal(shouldAskMorningAttendance({ ...morning, lastAskedOn: "2026-09-29" }), true, "and again the next day");
assert.equal(shouldAskMorningAttendance({ ...morning, workingDay: false }), false, "not on a holiday or Sunday");
assert.equal(shouldAskMorningAttendance({ ...morning, istHour: 19 }), false, "not in the evening");
assert.equal(shouldAskMorningAttendance({ ...morning, istHour: 3 }), false, "not at night");

for (const t of ["SKIP", "skip", "later", "on leave", "already marked", "baad me", "biometric"]) {
  assert.equal(parseSkipOwnAttendance(t), true, t);
}
for (const t of ["5A", "skip school tomorrow?", "IN", ""]) assert.equal(parseSkipOwnAttendance(t), false, t);

{
  const t = composeMorningAttendanceAsk({ firstName: "Shweta", deferredText: "Show my class students" });
  assert.ok(t.startsWith("Good morning Shweta"), t);
  // Punching is by the office screen's code now; a location pin no longer punches.
  assert.ok(t.includes("_IN 482913_") && t.includes("office QR screen"), "the way that works");
  assert.ok(!/Send your current location/.test(t), "never sends staff round the retired pin route");
  assert.ok(t.includes('"Show my class students"'), "says their question will be answered");
  assert.ok(t.includes("*SKIP*"), "a way out for someone on leave");
  const hi = composeMorningAttendanceAsk({ firstName: "Shweta", hindi: true });
  assert.ok(hi.startsWith("सुप्रभात"), hi);
}

/* ── What you teach, and what to type ──────────────────────────────── */

const masters = {
  classes: [
    { id: "c6", name: "VI" },
    { id: "c7", name: "VII" },
    { id: "c8", name: "VIII" },
    { id: "c9", name: "IX" },
  ],
  sections: [
    { id: "s6", classId: "c6", name: "A" },
    { id: "s7", classId: "c7", name: "A" },
    { id: "s8", classId: "c8", name: "A" },
    { id: "s9a", classId: "c9", name: "A" },
    { id: "s9b", classId: "c9", name: "B" },
  ],
  subjects: [
    { id: "m", nameEn: "Maths" },
    { id: "sc", nameEn: "Science" },
  ],
} as unknown as MastersState;

// SANJAY PRATAP's real links, shape for shape: class teacher of one section,
// subject teacher of several, one link covering a whole class.
const sanjay = {
  classTeacherLinks: [{ id: "a", classId: "c8", sectionId: "s8", academicYearCode: "2026-27", isPrimary: true }],
  subjectTeachingLinks: [
    { id: "b", classId: "c7", sectionId: "s7", subjectId: "m", academicYearCode: "2026-27", periodsPerWeek: 6 },
    { id: "c", classId: "c6", sectionId: "s6", subjectId: "m", academicYearCode: "2026-27", periodsPerWeek: 6 },
    { id: "d", classId: "c9", sectionId: null, subjectId: "sc", academicYearCode: "2026-27", periodsPerWeek: 5 },
    { id: "e", classId: "c6", sectionId: "s6", subjectId: "sc", academicYearCode: "2025-26", periodsPerWeek: 5 },
  ],
} as unknown as StaffRecord;

const profile = staffWorkProfile(sanjay, masters, "2026-27");
assert.deepEqual(profile.classTeacherOf, ["VIII A"]);
assert.deepEqual(profile.subjects, [
  { subject: "Maths", sections: ["VI A", "VII A"] },
  { subject: "Science", sections: ["IX A", "IX B"] },
], "a class-wide link covers every section; last year's links are left out");
assert.equal(shortSection("VIII A"), "8A");
assert.equal(shortSection("UKG A"), "UKGA");

{
  const g = composeStaffWorkGuide({ firstName: "Sanjay", profile, office: false, punchedJustNow: true });
  const ct = g.indexOf("*Class teacher of:*");
  const st = g.indexOf("*Subject teacher:*");
  assert.ok(ct > 0 && st > ct, "class teacher and subject teacher, separately and in that order");
  assert.ok(g.includes("_Take 8A attendance_"), "their own class in the example");
  assert.ok(g.includes("_4, 11_") && g.includes("_all present_"), "how to answer the register");
  assert.ok(g.includes("• Maths — VI A, VII A") && g.includes("• Science — IX A, IX B"));
  assert.ok(g.includes("_HW 6A Maths:"), "homework in their first subject and section");
  assert.ok(g.includes("_CW 6A Maths:"), "classwork");
  assert.ok(g.includes("_Notice 8A:"), "notice to their class");
  assert.ok(g.includes("Suggestion") && g.includes("Requirement") && g.includes("Complaint"), "to the director");
  assert.ok(g.includes("*help*") && g.includes("*HUMAN*"));
  assert.ok(g.length < 3500, "fits a WhatsApp message comfortably");
  assert.ok(!g.includes("roles on this number"), "one role: no switching block");
}
{
  const office = composeStaffWorkGuide({ firstName: "Shreya", profile: { classTeacherOf: [], subjects: [] }, office: true });
  assert.ok(office.includes("*Office work:*") && office.includes("_collection today_"), office);
  const none = composeStaffWorkGuide({ firstName: "New", profile: { classTeacherOf: [], subjects: [] }, office: false });
  assert.ok(none.includes("Staff → Duties"), "a teacher with nothing linked is told who can fix it");
}

// Every example the guide gives works where it says it does.
{
  const subjects = { subjectNames: ["Maths", "Science"] };
  const hw = detectClassChannelIntent("HW 6A Maths: Ex 5.2 Q1-5, due tomorrow", subjects);
  assert.equal(hw.kind, "homework");
  assert.equal(hw.subjectHint, "Maths");
  assert.equal(detectClassChannelIntent("CW 6A Maths: Ex 5.1 done in class", subjects).kind, "classwork");
  assert.equal(detectClassChannelIntent("Notice 8A: PTM on Saturday at 10 am", subjects).kind, "notice");
  for (const t of ["HW 6A Maths: Ex 5.2 Q1-5, due tomorrow", "CW 6A Maths: x", "Notice 8A: y", "homework 5A: z"]) {
    assert.equal(isClassChannelPostPrefix(t), true, `a class post, which the desk leaves alone: "${t}"`);
  }
  assert.equal(isClassChannelPostPrefix("hwy"), false);
  assert.equal(isClassChannelPostPrefix("Riya Verma details"), false);
  assert.equal(parseErpCommandLocal("Take 8A attendance")?.commandId, "mark_attendance");
  assert.equal(parseErpCommandLocal("8A")?.commandId, "class_roster");
  assert.equal(parseErpCommandLocal("8A attendance")?.commandId, "absent_list");
  assert.equal(parseErpCommandLocal("leave requests")?.commandId, "pending_leaves");
  assert.equal(parseErpCommandLocal("collection today")?.commandId, "collection_today");
  assert.equal(parseErpCommandLocal("5A defaulters")?.commandId, "class_defaulters");
}

/* ── Finish open work first ────────────────────────────────────────── */

{
  const t = composeOpenWorkReminder(
    { kind: "register", what: "attendance for VIII A — who is absent?", how: "reply the absent roll numbers, e.g. _4, 11_ — or _all present_" },
    "Riya Verma details",
  );
  assert.ok(t.includes("attendance for VIII A"), "names what is open");
  assert.ok(t.includes("_4, 11_"), "how to finish it");
  assert.ok(t.includes("*CANCEL*"), "how to drop it");
  assert.ok(t.includes('"Riya Verma details"'), "and promises the question will be answered");
  const long = composeOpenWorkReminder({ kind: "punch", what: "x", how: "y" }, "z".repeat(200));
  assert.ok(!long.includes("z".repeat(100)), "a long question is shortened");
}
for (const t of ["CANCEL", "cancel", "stop", "chhodo"]) assert.equal(isCancelOpenWork(t), true, t);
assert.equal(isCancelOpenWork("cancel the PTM"), false);

/* ── More than one role ────────────────────────────────────────────── */

const teacherParent: StaffRoleNote[] = [
  { kind: "teacher", label: "Class teacher", switchWord: "TEACHER" },
  { kind: "parent", label: "Parent of AARAV (III A)", switchWord: "PARENT" },
];
assert.equal(parseRoleSwitch("PARENT", teacherParent, "teacher"), "parent");
assert.equal(parseRoleSwitch("parent", teacherParent, "teacher"), "parent");
assert.equal(parseRoleSwitch("switch to parent", teacherParent, "teacher"), "parent");
assert.equal(parseRoleSwitch("TEACHER", teacherParent, "parent"), "teacher");
assert.equal(parseRoleSwitch("PARENT", teacherParent, "parent"), null, "already there");
assert.equal(parseRoleSwitch("parent meeting kab hai", teacherParent, "teacher"), null, "a sentence is not a switch");
// One role: "STAFF" stays the staff snapshot keyword.
assert.equal(parseRoleSwitch("STAFF", [{ kind: "staff", label: "Staff / Office", switchWord: "STAFF" }], "staff"), null);
// An old admission enquiry on a teacher's number is not a role to switch to.
{
  const withLead: StaffRoleNote[] = [
    { kind: "teacher", label: "Class teacher", switchWord: "TEACHER" },
    { kind: "admission_lead", label: "Admission enquiry", switchWord: "ADMISSION" },
  ];
  assert.equal(switchableRoles(withLead).length, 1);
  assert.equal(parseRoleSwitch("ADMISSION", withLead, "teacher"), null);
  assert.equal(composeRolesFooter(withLead, "teacher"), "", "no roles block for one real role");
}
// Every word the roles list shows works as a switch.
{
  const three: StaffRoleNote[] = [
    { kind: "owner", label: "Director / Leadership", switchWord: "DIRECTOR" },
    { kind: "parent", label: "Parent", switchWord: "PARENT" },
    { kind: "transport", label: "Driver", switchWord: "DRIVER" },
  ];
  for (const r of three) {
    const from = three.find((x) => x.kind !== r.kind)!.kind;
    assert.equal(parseRoleSwitch(r.switchWord, three, from), r.kind, r.switchWord);
  }
  const footer = composeRolesFooter(three, "owner");
  assert.ok(footer.includes("*You have 3 roles"), footer);
  assert.ok(footer.includes("_(now using)_"));
}
{
  const g = composeStaffWorkGuide({ firstName: "Jyoti", profile, office: false, roles: teacherParent, currentKind: "teacher" });
  assert.ok(g.includes("*You have 2 roles"), "the guide says how to switch for a teacher-parent");
  assert.ok(g.includes("*PARENT*"));
}
for (const t of ["ROLE", "my roles", "switch", "profile"]) assert.equal(isRolesAsk(t), true, t);

// The punch code on its own answers an open punch — never held as a question.
for (const t of ["482913", " 482 913 ", "482-913"]) assert.equal(isPunchCodeOnly(t), true, t);
for (const t of ["4829", "IN 482913", "4829131", "abc123", ""]) assert.equal(isPunchCodeOnly(t), false, t);

/* ── To the director ───────────────────────────────────────────────── */

assert.deepEqual(parseStaffFeedback("Suggestion: we need a water cooler on the first floor"), {
  kind: "suggestion",
  body: "we need a water cooler on the first floor",
});
assert.equal(parseStaffFeedback("Requirement: 2 boxes of chalk for 5A")?.kind, "requirement");
assert.equal(parseStaffFeedback("Complaint to director: projector not working in 8A")?.kind, "complaint");
assert.equal(parseStaffFeedback("शिकायत: पंखा खराब है")?.kind, "complaint");
assert.equal(parseStaffFeedback("जरूरत: चॉक चाहिए")?.kind, "requirement");
assert.equal(parseStaffFeedback("sujhav - library timing badhayein")?.kind, "suggestion");
// Without the colon it is a sentence, not a message for the director.
assert.equal(parseStaffFeedback("need 5A class list"), null);
assert.equal(parseStaffFeedback("complaint"), null);
// Who gets it is asked every time: a complaint about the principal must
// reach the director alone.
{
  const ask = composeFeedbackRecipientAsk("complaint");
  assert.ok(ask.includes("*1* — Director only") && ask.includes("*2* — Principal only") && ask.includes("*3* — Both"), ask);
  assert.ok(ask.includes("nobody else sees it"));
}
for (const [t, want] of [
  ["1", "director"], ["Director", "director"], ["director only", "director"], ["2", "principal"], ["Principal.", "principal"],
  ["3", "both"], ["both", "both"], ["dono", "both"], ["4", null], ["yes", null], ["complaint", null],
] as const) {
  assert.equal(parseFeedbackRecipient(t), want, t);
}
assert.equal(composeStaffFeedbackAck("complaint", "director", true), "✅ Your complaint has been sent to the Director only.");
assert.ok(composeStaffFeedbackAck("suggestion", "both", true).includes("the Director and the Principal"));
assert.ok(!composeStaffFeedbackAck("suggestion", "principal", false).includes("✅"), "never claims a delivery that failed");
assert.ok(PRIVATE_FEEDBACK_LOG_TEXT.startsWith("[private"), "the inbox shows a placeholder, never the words");
{
  const g = composeStaffWorkGuide({ firstName: "A", profile: { classTeacherOf: [], subjects: [] }, office: false });
  assert.ok(g.includes("Director / Principal (privately)"), "the guide says it is private");
  assert.ok(g.includes("_CL tomorrow_") && g.includes("_my leave_"), "the guide shows how to apply for leave");
}

/* ── A number not on the staff record ──────────────────────────────── */

const roster = [
  { id: "r", empCode: "STF-007", fullName: "Ravindra Yadav", status: "active" as const },
  { id: "s", empCode: "STF-034", fullName: "SANJAY PRATAP", status: "active" as const },
  { id: "k", empCode: "STF-009", fullName: "Ravindra Kumar", status: "active" as const },
  { id: "x", empCode: "STF-050", fullName: "Old Teacher", status: "inactive" as const },
];
assert.equal(matchStaffForLink("Ravindra Yadav", roster).match?.id, "r");
assert.equal(matchStaffForLink("ravindra yadav", roster).match?.id, "r");
assert.equal(matchStaffForLink("STF-007", roster).match?.id, "r");
assert.equal(matchStaffForLink("stf 7", roster).match?.id, "r", "the code however it is typed");
assert.equal(matchStaffForLink("Mr. Sanjay Pratap", roster).match?.id, "s");
assert.equal(matchStaffForLink("Ravindra", roster).match, null, "one word is not enough to show someone's record");
assert.equal(matchStaffForLink("Yadav Ravindra Singh", roster).match, null, "an extra word is a different person");
assert.equal(matchStaffForLink("Old Teacher", roster).match, null, "never an inactive record");
{
  const twins = [...roster, { id: "r2", empCode: "STF-060", fullName: "Ravindra Yadav", status: "active" as const }];
  const m = matchStaffForLink("Ravindra Yadav", twins);
  assert.equal(m.match, null, "two people with one name: ask for the code");
  assert.equal(m.ambiguous, 2);
}
assert.equal(maskMobile10("8576096519"), "••••6519");
assert.equal(maskMobile10(""), "—");
{
  const t = composeStaffLinkFound({
    fullName: "Ravindra Yadav",
    empCode: "STF-007",
    designation: "Teacher",
    registeredMobile: "8576096519",
    thisMobile: "9598028391",
  });
  assert.ok(t.includes("*Ravindra Yadav*") && t.includes("STF-007") && t.includes("Teacher"));
  assert.ok(t.includes("••••6519") && !t.includes("8576096519"), "the registered number is masked");
  assert.ok(t.includes("9598028391"), "the number being added is shown whole — it is theirs");
  assert.ok(t.includes("*YES*") && t.includes("*NO*"));
  const r = composeStaffLinkRequested("4821");
  assert.ok(r.includes("*4821*") && r.includes("approves"), "tells them it waits for approval");
}
assert.deepEqual(parseStaffLinkDecision("LINK OK 4821"), { approve: true, code: "4821" });
assert.deepEqual(parseStaffLinkDecision("link yes #4821"), { approve: true, code: "4821" });
assert.deepEqual(parseStaffLinkDecision("LINK NO 4821"), { approve: false, code: "4821" });
assert.equal(parseStaffLinkDecision("link ok"), null);
assert.equal(parseStaffLinkDecision("please link ok 4821"), null);
for (let i = 0; i < 50; i += 1) assert.match(makeStaffLinkCode(), /^\d{4}$/);
assert.equal(makeStaffLinkCode(() => 0), "1000");
assert.equal(makeStaffLinkCode(() => 0.99999), "9999");

console.log("  ok");
