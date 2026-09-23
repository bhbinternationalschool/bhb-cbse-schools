/**
 * Self-test: the exam-eve message and its button.
 * Run: npx tsx apps/web/src/lib/examEve.selftest.ts
 *
 * What must hold:
 *  - the template's button words and `isPracticeTap` are the SAME words. A
 *    tap arrives as the button's label; if the two drift, the tap reaches
 *    the generic quick-reply matcher, which answers every template button
 *    with "your reply has reached the office" — exactly what two parents got
 *    when they asked for the school's location on 14 and 16 Sep 2026;
 *  - every template value is one line (Meta refuses a newline — #132000);
 *  - the printed paper name wins over the subject ("English Rhymes" is not
 *    "English");
 *  - Nursery–UKG are told apart, because they get tips, not a tutor;
 *  - a family with no paper that day gets nothing.
 */

import assert from "node:assert/strict";

import {
  PRACTICE_BUTTON_EN,
  PRACTICE_BUTTON_HI,
  examDayLabel,
  examEveFreeText,
  examEveVariables,
  isPracticeTap,
  isPrePrimary,
  isTimetableRequest,
  nextExamDate,
  paperLabel,
  papersFromDate,
  practicePrompt,
  prePrimaryTips,
  timetableReply,
  tomorrowIso,
  type EveFamily,
  type EveSlot,
} from "./examEve";
import { matchSeedQuickReply } from "./waTemplates";

console.log("examEve.selftest.ts");

/* ── 1. The button and the detector are the same words ──────────────── */

for (const label of [PRACTICE_BUTTON_EN, PRACTICE_BUTTON_HI]) {
  const seed = matchSeedQuickReply(label);
  assert.ok(seed, `"${label}" must be a button on a registered template`);
  assert.equal(seed!.familyKey, "exams_tomorrow", "and on the exam-eve template");
  assert.ok(
    isPracticeTap(label),
    `a tap on "${label}" must be recognised — otherwise it falls to the office hand-off`,
  );
}

/* ── 2. Dates ───────────────────────────────────────────────────────── */

assert.equal(tomorrowIso("2026-09-17"), "2026-09-18");
assert.equal(tomorrowIso("2026-09-30"), "2026-10-01");
assert.equal(examDayLabel("2026-09-18", true), "शुक्रवार, 18 सितंबर");
assert.equal(examDayLabel("2026-09-18", false), "Friday, 18 Sep");

const slots: EveSlot[] = [
  { date: "2026-09-18", classId: "c4", subjectId: "sub_mat", note: "", startTime: "08:30" },
  { date: "2026-09-18", classId: "c7", subjectId: "sub_hin", note: "", startTime: "08:30" },
  { date: "2026-09-18", classId: "cn", subjectId: "sub_hin", note: "Hindi — Oral & Written", startTime: "08:30" },
  { date: "2026-09-22", classId: "cn", subjectId: "sub_eng", note: "English Rhymes", startTime: "08:30" },
  { date: "2026-09-22", classId: "c4", subjectId: "sub_hin", note: "", startTime: "08:30" },
];
const names = new Map([
  ["sub_mat", "Mathematics"],
  ["sub_hin", "Hindi"],
  ["sub_eng", "English"],
]);

// The 17th is a gap day; the next paper after it is the 18th, not the 22nd.
assert.equal(nextExamDate(slots, "2026-09-17"), "2026-09-18");
assert.equal(nextExamDate(slots, "2026-09-18"), "2026-09-22", "after today, not including it");
assert.equal(nextExamDate(slots, "2026-09-30"), null);

/* ── 3. The printed paper name wins ─────────────────────────────────── */

assert.equal(paperLabel(slots[3]!, "English", false), "English Rhymes");
assert.equal(paperLabel(slots[3]!, "English", true), "अंग्रेज़ी कविताएँ");
assert.equal(paperLabel(slots[0]!, "Mathematics", true), "गणित");
assert.equal(paperLabel(slots[2]!, "Hindi", true), "हिंदी — मौखिक व लिखित");

/* ── 4. Pre-primary is told apart ───────────────────────────────────── */

for (const c of ["Nursery", "LKG", "UKG", "nursery"]) assert.ok(isPrePrimary(c), c);
for (const c of ["I", "IV", "X"]) assert.equal(isPrePrimary(c), false, c);

/* ── 5. One family, siblings on one line each ───────────────────────── */

const family: EveFamily = {
  householdId: "hh1",
  guardianName: "Vijay Kumar Singh",
  mobile: "9000000000",
  hindi: true,
  children: [
    { studentId: "s1", name: "Ansh", classId: "c7", className: "VII" },
    { studentId: "s2", name: "Arav", classId: "c4", className: "IV" },
  ],
};

const vars = examEveVariables(family, slots, names, "2026-09-18");
assert.equal(vars.empty, false);
assert.equal(vars.examDay, "शुक्रवार, 18 सितंबर");
assert.equal(vars.childPapers, "Ansh (VII) — हिंदी  |  Arav (IV) — गणित");

for (const [k, v] of Object.entries(vars)) {
  if (typeof v !== "string") continue;
  assert.ok(!v.includes("\n"), `${k}: no newline — Meta refuses it`);
  assert.ok(!/ {4,}/.test(v), `${k}: no run of 4 spaces`);
  assert.ok(v.trim(), `${k}: never blank`);
}

// A family with no paper that day gets nothing at all.
const quiet: EveFamily = {
  ...family,
  children: [{ studentId: "s9", name: "Riya", classId: "c-none", className: "II" }],
};
assert.equal(examEveVariables(quiet, slots, names, "2026-09-18").empty, true);
assert.equal(examEveFreeText(quiet, slots, names, "2026-09-18"), "");

/* ── 6. The free-text version invites the tap in the family's language ─ */

const free = examEveFreeText(family, slots, names, "2026-09-18");
assert.ok(free.includes(PRACTICE_BUTTON_HI), "the Hindi text names the Hindi button");
assert.ok(free.includes("TIMETABLE"));

/* ── 7. What the tap and TIMETABLE recognise — and what they must not ── */

for (const yes of [PRACTICE_BUTTON_EN, PRACTICE_BUTTON_HI, "practice", "अभ्यास"]) {
  assert.ok(isPracticeTap(yes), yes);
}
// 21 Sep 2026: typed, not tapped — every one of these went to the office.
for (const yes of ["Abhyas shuru Karen", "Abhyas suru kre", "करो शुरू", "SST ka rivision kare", "अभ्यास शुरू करें।", "revision start", "Science ki taiyari shuru karo"]) {
  assert.ok(isPracticeTap(yes), `typed start: ${yes}`);
}
for (const no of ["practice karwao maths ka", "DUES", "", "PAY", "Hindi", "abhyas ka matlab kya hai", "kal ka paper"]) {
  assert.equal(isPracticeTap(no), false, `not a tap: ${no}`);
}

for (const yes of [
  "TIMETABLE", "time table", "date sheet", "exam kab hai timetable", "टाइम टेबल भेजिए", "पेपर कब है",
  // 21 Sep 2026: "Next exam" went to the office instead of the date sheet.
  "Next exam", "next exam kab hai", "agla paper kaun sa hai", "kal ka paper", "when is the exam", "Exam?",
  "exam date", "tomorrow paper", "अगला पेपर", "कल कौन सा पेपर है", "आज का पेपर",
  // 22 Sep 2026: written half in Devanagari, half in Latin — the father's
  // own words, twice, while the drill was waiting for a chapter number. Both
  // times he was told "यह समझ नहीं आया" instead of being given the date sheet.
  "कल मेरा SST का paper है", "यार आज क्या मेरा SST का paper कल है",
  "कल exam hai kya", "paper कब है",
]) {
  assert.ok(isTimetableRequest(yes), yes);
}
for (const no of ["fees kab jama kare", "DUES", "school kaha hai", "", "exam result kab aayega", "exam fees", "admit card", "exam ke marks", "परीक्षा का रिजल्ट", "next week fees",
  // The mixed-script branch must not swallow the questions that already have
  // their own answers — money and marks are not "when".
  "कल exam fees jama karni hai", "paper के marks कब आएंगे", "आज exam ka result kab aayega"]) {
  assert.equal(isTimetableRequest(no), false, `not a timetable ask: ${no}`);
}

/* ── 8. TIMETABLE lists only what is still to come ──────────────────── */

const tt = timetableReply(family, slots, names, "2026-09-19");
assert.ok(tt.includes("Arav (IV)"));
assert.ok(tt.includes("सोमवार") === false || tt.includes("22"), "the 22nd is listed");
assert.ok(!tt.includes("18 सितंबर"), "a paper already sat is not listed");
assert.ok(!tt.includes("Ansh (VII)"), "a child with nothing left is left out");

const done = timetableReply(family, slots, names, "2026-09-30");
assert.ok(done.includes("सभी पेपर हो चुके"), "after the last paper, say so");

// 22 Sep 2026, 19:37 IST: a father wrote "Time table" and was shown
// "मंगलवार, 22 सितंबर — गणित" under *बचे हुए पेपर* — a paper his son had
// written that morning, 8:30 to 11:30. Papers start at 8:30, so today is
// still to come only until 9.
assert.equal(papersFromDate("2026-09-22", 7), "2026-09-22", "at 7 am, today's paper is still to come");
assert.equal(papersFromDate("2026-09-22", 8), "2026-09-22", "at 8 am too — the paper starts at 8:30");
assert.equal(papersFromDate("2026-09-22", 9), "2026-09-23", "once it has started, it is not to come");
assert.equal(papersFromDate("2026-09-22", 19), "2026-09-23", "and his 19:37 must not list it");
assert.equal(papersFromDate("2026-09-30", 23), "2026-10-01", "the month rolls over");

{
  const evening = timetableReply(family, slots, names, papersFromDate("2026-09-22", 19));
  assert.ok(!evening.includes("22 सितंबर"), "the paper written this morning is gone");
  const morning = timetableReply(family, slots, names, papersFromDate("2026-09-22", 7));
  assert.ok(morning.includes("22 सितंबर"), "but at 7 am it is still listed");
}

/* ── 9. The tutor prompt and the pre-primary tips ───────────────────── */

const prompt = practicePrompt(family.children[1]!, "गणित", true);
assert.ok(prompt.includes("कक्षा IV") && prompt.includes("गणित"), "class and subject reach the tutor");
assert.ok(prompt.includes("एक बार में एक"), "one question at a time");

const tips = prePrimaryTips(
  { studentId: "n1", name: "Shivansh", classId: "cn", className: "Nursery" },
  "अंग्रेज़ी कविताएँ",
  true,
);
assert.ok(tips.includes("कविताएँ") && tips.split("\n").filter((l) => l.startsWith("•")).length === 3);

/* ── 10. EVS reads as Hindi, and a correction says so ───────────────── */

// Classes I–II sit EVS. Their rows said "Science" until 18 Sep 2026 and
// 24 families were told विज्ञान the evening before an EVS paper. Once the
// data was fixed, the message still had to read as Hindi.
{
  const evsSlot: EveSlot = {
    date: "2026-09-19",
    classId: "c1",
    subjectId: "sub_evs",
    note: "",
    startTime: "08:30",
  };
  const evsNames = new Map([["sub_evs", "Environmental Studies / World Around Us"]]);
  const evsFamily: EveFamily = {
    householdId: "hh1",
    guardianName: "श्री राम",
    mobile: "9000000002",
    hindi: true,
    children: [{ studentId: "s1", name: "PRATYUSH", classId: "c1", className: "I" }],
  };

  assert.equal(
    paperLabel(evsSlot, "Environmental Studies / World Around Us", true),
    "पर्यावरण अध्ययन",
    "a Hindi message must not carry nine English words as a subject",
  );
  assert.equal(paperLabel(evsSlot, "Environmental Studies / World Around Us", false), "Environmental Studies / World Around Us");

  // An ordinary send says nothing about corrections.
  const plain = examEveVariables(evsFamily, [evsSlot], evsNames, "2026-09-19");
  assert.ok(plain.childPapers.includes("पर्यावरण अध्ययन"));
  assert.ok(!plain.childPapers.includes("सुधार"), "an ordinary evening is not a correction");

  // A resend does, in the same single line Meta requires.
  const fixed = examEveVariables(evsFamily, [evsSlot], evsNames, "2026-09-19", {
    correction: true,
  });
  assert.ok(fixed.childPapers.startsWith("सुधार —"), "the family must see which message to believe");
  assert.ok(!/[\n\t]/.test(fixed.childPapers), "still one line");
  assert.ok(!/ {4,}/.test(fixed.childPapers), "no four-space run (Meta #132000)");

  const fixedText = examEveFreeText(evsFamily, [evsSlot], evsNames, "2026-09-19", {
    correction: true,
  });
  assert.ok(fixedText.startsWith("⚠️ *सुधार*"), "the free-text correction leads with it");
  assert.ok(fixedText.includes("पर्यावरण अध्ययन"));
  const plainText = examEveFreeText(evsFamily, [evsSlot], evsNames, "2026-09-19");
  assert.ok(plainText.startsWith("📝"), "an ordinary message still opens with the papers");
  assert.ok(!plainText.includes("सुधार"));

  // English keeps its own wording.
  const enFixed = examEveVariables(
    { ...evsFamily, hindi: false },
    [evsSlot],
    evsNames,
    "2026-09-19",
    { correction: true },
  );
  assert.ok(enFixed.childPapers.startsWith("Correction —"));
}

console.log("  ok — the button is recognised, the lines are one line, the little ones get tips");
