/**
 * Self-test: the staff side of the school WhatsApp bot against what staff
 * actually sent on 29 Sep 2026 — the first day they were shown it — from
 * 13:57 to 14:20 IST. Every quoted message below is real; names and numbers
 * are left out.
 *
 * What went wrong that day, and what each block pins:
 *   - anything the command desk did not recognise got NO reply at all;
 *   - "take the register" was not a thing the desk knew, and when it asked
 *     "Which class and section?" it forgot what it had asked;
 *   - "my attendance" was read as a child called "my attendance";
 *   - a class list asked for in slightly different words went to the model,
 *     which said the names were "not available in the records";
 *   - teachers whose numbers were not on the staff record were put through
 *     the admission-enquiry menu, and a sentence was taken as a name.
 *
 * Run: npx tsx src/lib/staffWhatsAppRealChats.selftest.ts
 */

import assert from "node:assert/strict";

import {
  formatMarkAttendancePrompt,
  parseErpCommandLocal,
  parseMarkAskReply,
  parseStudentDetailsQuery,
  parseTakeAttendanceQuery,
  parseMyClassRosterQuery,
  markAskIsFresh,
  MY_SECTIONS_MARKER,
} from "./erpCommands";
import { detectOwnAttendanceAsk, staffAttAskLocationText } from "./waStaffAttendanceBotEngine";
import { shouldRouteStaffAttendance } from "./waStaffAttendanceBotServer";
import {
  shouldShowUnifiedMenu,
  composeStaffFallbackText,
  isStaffHumanAsk,
  looksLikeStaffAsk,
  readVisitorName,
} from "./waUnifiedBotEngine";
import { detectStaffBotKeyword } from "./waStaffBotPrompts";
import { roleFlowInteractiveMenu } from "./waUnifiedMenus";
import { isLikelyClassChannelPost } from "./waClassChannelEngine";
import { composeStaffLinkIntro } from "./staffOnboarding";

console.log("staffWhatsAppRealChats.selftest.ts");

/* ── A location pin is a punch, not a menu request ─────────────────── */

// Every punch on 29 Sep failed here: the pin has no text, and no text meant
// "show the menu". Five staff sent IN and then their location, some twice.
assert.equal(
  shouldShowUnifiedMenu({ text: "", staff: true, known: true, hasSession: true, hasAudio: false, hasLocation: true }),
  false,
  "a staff location pin must reach the attendance bot",
);
assert.equal(
  shouldShowUnifiedMenu({ text: "", staff: false, known: true, hasSession: true, hasAudio: false, hasLocation: true }),
  false,
  "nor is a parent's pin a menu request",
);
// A bare empty message with nothing attached still opens the menu, as before.
assert.equal(
  shouldShowUnifiedMenu({ text: "", staff: true, known: true, hasSession: true, hasAudio: false, hasLocation: false }),
  true,
);
for (const lang of ["en", "hi"] as const) {
  const t = staffAttAskLocationText("in", lang);
  assert.ok(t.includes("Send your current location"), "names the option that works");
  assert.ok(t.includes("Share live location"), "and warns off the one that does not");
  assert.ok(/1\./.test(t) && /3\./.test(t), "as numbered steps");
}

/* ── Their own attendance, not the class register ──────────────────── */

// Read as "my attendance" = a child's name, or as the class register.
assert.equal(detectOwnAttendanceAsk("My attendance record"), "status");
assert.equal(detectOwnAttendanceAsk("Show my attendance"), "status");
assert.equal(detectOwnAttendanceAsk("Mera attendance present karna hai"), "in", "marking yourself present is a punch IN");
assert.equal(detectOwnAttendanceAsk("Teacher attendance record", { staffSelf: true }), "status");
assert.equal(detectOwnAttendanceAsk("मेरी हाजिरी दिखाओ"), "status");
assert.equal(detectOwnAttendanceAsk("punch out my attendance"), "out");
// A principal asking for staff attendance is not asking about themself.
assert.equal(detectOwnAttendanceAsk("Teacher attendance record", { staffSelf: false }), null);
// Anything about a class is the class — "mere class" is not "mera".
for (const t of [
  "Mere class ka attendance lena hai",
  "Mere class ka attendance",
  "Show my class attendance",
  "Class 8 ka attendance lena hai",
  "Students attendence",
  "my 5A attendance",
  "attendance summary",
]) {
  assert.equal(detectOwnAttendanceAsk(t, { staffSelf: true }), null, `class, not self: "${t}"`);
}
// And the desk's parser no longer reads them as a child's name.
assert.equal(parseStudentDetailsQuery("My attendance record"), null);
assert.equal(parseStudentDetailsQuery("Teacher attendance record"), null);
assert.equal(parseStudentDetailsQuery("Riya Verma details"), "riya verma", "a real details ask still works");

// "1" answering the attendance bot's own language question is routed to it.
assert.equal(shouldRouteStaffAttendance({ text: "1", languageAskOpen: true }), true);
assert.equal(shouldRouteStaffAttendance({ text: "English", languageAskOpen: true }), true);
assert.equal(shouldRouteStaffAttendance({ text: "1" }), false, "without the question, 1 belongs to the desk's lists");
assert.equal(shouldRouteStaffAttendance({ text: "5A", languageAskOpen: true }), false);

/* ── Taking the register ───────────────────────────────────────────── */

{
  const p = parseErpCommandLocal("Class 8 ka attendance lena hai");
  assert.equal(p?.commandId, "mark_attendance");
  // Keyed as "8": the desk now reads that back instead of asking which class.
  assert.equal(p?.fields.section, "8");
}
for (const t of ["Mere class ka attendance lena hai", "Mere class ka attendence lena hai"]) {
  const p = parseErpCommandLocal(t);
  assert.equal(p?.commandId, "mark_attendance", t);
  assert.equal(p?.fields.section, MY_SECTIONS_MARKER, `the teacher's own section: "${t}"`);
}
assert.equal(parseErpCommandLocal("Take 5A attendance")?.commandId, "mark_attendance");
assert.equal(parseErpCommandLocal("5A attendance lagao")?.fields.section, "5A");
// Reading the register is still reading it.
assert.equal(parseErpCommandLocal("5A attendance")?.commandId, "absent_list");
assert.equal(parseErpCommandLocal("5A me aaj kaun absent hai")?.commandId, "absent_list");
assert.equal(parseErpCommandLocal("Show my class attendance")?.commandId, "attendance_summary");
assert.equal(parseTakeAttendanceQuery("5A attendance report"), null, "a report is not taking the register");
assert.equal(parseTakeAttendanceQuery("kaun absent hai 5A attendance lena"), null, "a question never marks");
// The one-line form keeps its own parse, list and all.
{
  const p = parseErpCommandLocal("Mark 5A attendance: absent roll 4, 11, 19");
  assert.equal(p?.commandId, "mark_attendance");
  assert.equal(p?.fields.text, "absent roll 4, 11, 19");
}

// The answer to "who is absent?".
assert.equal(parseMarkAskReply("4, 11"), "absent 4, 11");
assert.equal(parseMarkAskReply("4 11 19"), "absent 4, 11, 19");
assert.equal(parseMarkAskReply("roll 4 and 11"), "absent 4, 11");
assert.equal(parseMarkAskReply("absent 4, 11"), "absent 4, 11");
assert.equal(parseMarkAskReply("all present"), "all present");
assert.equal(parseMarkAskReply("sab present hain"), "all present");
assert.equal(parseMarkAskReply("koi absent nahi"), "all present");
assert.equal(parseMarkAskReply("0"), "all present");
assert.equal(parseMarkAskReply("absent 4 leave 7 late 9"), "absent 4 leave 7 late 9");
// Not an answer: left to whatever it would otherwise be.
assert.equal(parseMarkAskReply("Riya"), null, "a bare name may be a question about that child");
assert.equal(parseMarkAskReply("help"), null);
assert.equal(parseMarkAskReply("5A"), null);

{
  const now = Date.parse("2026-09-29T08:40:00Z");
  assert.equal(markAskIsFresh("2026-09-29T08:31:53Z", now), true, "counting heads takes a few minutes");
  assert.equal(markAskIsFresh("2026-09-29T08:00:00Z", now), false);
}

{
  const t = formatMarkAttendancePrompt({
    sectionLabel: "VIII A",
    date: "2026-09-29",
    todayIso: "2026-09-29",
    roster: [
      { rollNo: "1", fullName: "AMRIT MISHRA" },
      { rollNo: "4", fullName: "LAKSHYA KESHARI" },
      { rollNo: "", fullName: "SUJIT KUMAR" },
    ],
  });
  assert.ok(t.startsWith("*Take attendance · VIII A* · today · 3 students"), t);
  assert.ok(t.includes("4. LAKSHYA KESHARI"), "numbered by roll, so the roll is what they type");
  assert.ok(t.includes("– SUJIT KUMAR"), "a child with no roll number is still on the list");
  assert.ok(t.includes("absent 4, 11") || t.includes("_4, 11_"), "says how to answer");
  assert.ok(t.includes("all present"));
  assert.ok(t.includes("Nothing is saved until you confirm."), "the confirm card still stands between this and the register");
  assert.ok(t.includes("absent SUJIT"), "says how to name a child without a roll number");
}

/* ── The class list, however it is asked for ───────────────────────── */

for (const [t, section] of [
  ["Class 10 students namw", "10"],
  ["Class -3rd Sec A", "3A"],
  ["VIII A", "8A"],
  ["IXA", "9A"],
  ["Class ukg", "ukg"],
  ["5A", "5A"],
] as const) {
  const p = parseErpCommandLocal(t);
  assert.equal(p?.commandId, "class_roster", t);
  assert.equal(p?.fields.section, section, t);
}
for (const t of [
  "Show my class students name",
  "Show my class students names",
  "Show my class students",
  "mere class ke bachche",
]) {
  assert.equal(parseMyClassRosterQuery(t), true, t);
  const p = parseErpCommandLocal(t);
  assert.equal(p?.commandId, "class_roster", t);
  assert.equal(p?.fields.section, MY_SECTIONS_MARKER, `the teacher's own class: "${t}"`);
}
// "My class" plus another topic keeps that topic's reading.
assert.equal(parseMyClassRosterQuery("my class fees pending"), false);
assert.equal(parseMyClassRosterQuery("my class homework"), false);
// A bare number is still an answer to a numbered list, never a class.
assert.equal(parseErpCommandLocal("2"), null);

/* ── Never silence ─────────────────────────────────────────────────── */

for (const said of ["English", "??", "Show my class students names", "Class -3rd Sec A"]) {
  const t = composeStaffFallbackText({ firstName: "Ankita", text: said });
  assert.ok(t.startsWith("Sorry Ankita, I didn't understand"), t);
  assert.ok(t.includes(`"${said}"`), "echoes what they sent, so they can see what was not understood");
  assert.ok(t.includes("*help*"), "points at the full list");
  assert.ok(t.includes("*HUMAN*"), "and at a person");
  assert.ok(t.includes("*Take 5A attendance*"), "names the thing teachers came to do");
}
assert.ok(!composeStaffFallbackText({ text: "x".repeat(200) }).includes("xxxxxxxxxx"), "a long message is not echoed back whole");
for (const t of ["HUMAN", "human", "office", "Talk to office"]) assert.equal(isStaffHumanAsk(t), true, t);
assert.equal(isStaffHumanAsk("human resources policy"), false);

// The staff menu's own keywords, and nothing that merely contains them.
assert.equal(detectStaffBotKeyword("FEE"), "fee");
assert.equal(detectStaffBotKeyword("timing"), "timing");
assert.equal(detectStaffBotKeyword("Staff."), "staff");
assert.equal(detectStaffBotKeyword("Mere class ka attendance lena hai"), "unknown", "the old substring reading gave the staff snapshot");
assert.equal(detectStaffBotKeyword("which class"), "unknown", "'hi' inside 'which' is not the menu");
assert.equal(detectStaffBotKeyword(""), "unknown");

// A teacher's question is not a notice to parents. The class channel drafts
// any sentence over eight characters as one; only real posts go there now.
{
  const subjectNames = ["Maths", "English", "Hindi", "Science"];
  for (const t of [
    "how do I see marks",
    "Show my attendance please",
    "kya aaj school band hai?",
    "Mere bachcho ka result kab aayega",
    "please send the timetable pdf?",
  ]) {
    assert.equal(isLikelyClassChannelPost(t, { subjectNames }), false, `a question, not a post: "${t}"`);
  }
  for (const t of [
    "HW 5A Maths: ex 5.2 Q1-5",
    "Notice: PTM on Saturday",
    "5A bring drawing book tomorrow",
    "Maths ex 4.1 due kal",
    "yes",
    "cancel",
    "",
  ]) {
    assert.equal(isLikelyClassChannelPost(t, { subjectNames }), true, `a class post: "${t}"`);
  }
}

/* ── Staff whose number is not on the staff record ─────────────────── */

for (const t of [
  "Mere class ka attendance lena hai",
  "Show my class students name",
  "Show my class students",
]) {
  assert.equal(looksLikeStaffAsk(t), true, t);
}
// New parents must never be told they are not staff.
for (const t of [
  "class 5 admission",
  "my son attendance",
  "fees kitni hai class 3",
  "admission ke liye",
  "Rajesh Kumar",
  "hi",
]) {
  assert.equal(looksLikeStaffAsk(t), false, `a family, not staff: "${t}"`);
}
{
  const r = composeStaffLinkIntro();
  assert.ok(r.includes("not on the school's staff record"));
  assert.ok(r.includes("स्टाफ रिकॉर्ड"), "in Hindi too — an unknown number gets the school's default language");
  assert.ok(r.includes("employee code"), "asks for something that finds the record");
}
// Words parents use are not staff words, even though teachers use them too.
for (const t of ["homework kya hai", "class teacher ka number", "timetable of class 5", "how many students in class 3"]) {
  assert.equal(looksLikeStaffAsk(t), false, `a parent's question: "${t}"`);
}

// A sentence, a button tap or a menu word is not a name.
for (const t of [
  "Mere class ka attendance lena hai",
  "Show my class students name",
  "purpose_admission",
  "menu_main",
  "ADMISSION",
  "English",
  "help",
]) {
  assert.equal(readVisitorName(t).ok, false, `not a name: "${t}"`);
}
// Real names still are — including ones that contain a purpose word.
for (const [t, name] of [
  ["Payal Sharma", "Payal Sharma"],
  ["Sumeet Kumar", "Sumeet Kumar"],
  ["Rajesh Kumar", "Rajesh Kumar"],
  ["सुनीता शर्मा", "सुनीता शर्मा"],
  ["My name is Rajesh Kumar", "Rajesh Kumar"],
  ["Mera naam Sunita Devi hai", "Sunita Devi"],
] as const) {
  const r = readVisitorName(t);
  assert.ok(r.ok, `a name: "${t}"`);
  if (r.ok) assert.equal(r.name, name);
}

/* ── The menus say what works ──────────────────────────────────────── */

{
  const teacher = roleFlowInteractiveMenu("teacher", "Shweta");
  assert.ok(teacher);
  assert.ok(teacher!.textFallback.includes("*Take 5A attendance*"), "the teacher menu names taking the register");
  assert.ok(teacher!.textFallback.includes("*help*"));
  const staff = roleFlowInteractiveMenu("staff", "Ankita");
  assert.ok(staff);
  assert.ok(staff!.textFallback.includes("*help*"), "the staff menu names the command desk");
  const m = staff!.menu;
  assert.equal(m.kind, "list");
  if (m.kind === "list") {
    const rows = m.sections.flatMap((sec) => sec.rows);
    assert.equal(rows[0]!.id, "staff_help");
    assert.ok(rows.length <= 10, "WhatsApp allows ten rows in a list");
  }
  const owner = roleFlowInteractiveMenu("owner", "Director");
  if (owner && owner.menu.kind === "list") {
    assert.ok(owner.menu.sections.flatMap((sec) => sec.rows).length <= 10, "and the owner's list too");
  }
}

console.log("  ok");
