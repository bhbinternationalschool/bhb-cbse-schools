/**
 * Self-test: the staff chat answers a child's name or a class typed on its own.
 * Run: npx tsx src/lib/staffChatBare.selftest.ts
 *
 * Every message below is one staff actually sent on 18–21 Sep 2026 and got
 * silence or a wrong answer for:
 *  - "Sujit kumar", "Om", "5A", "Class 5" — nothing at all;
 *  - "Collect fee", "Store due" — "couldn't find a student matching 'collect'";
 *  - "Sujit kumar ka fees lena hai" — a search for "sujit kumar lena";
 *  - "वैभव पांडे का कितना फीस बकाया है?" — no match for a Hindi-typed name;
 *  - "Class 4 में कितने बच्चे हैं?" — "no students": classes are stored as IV.
 */

import assert from "node:assert/strict";

import {
  classRefMatches,
  classRosterPicks,
  formatClassRosterReply,
  formatStudentFeesReply,
  looksLikeBareName,
  matchStudents,
  parseBareClassQuery,
  parseErpCommandLocal,
  parseFeeHelpQuery,
  parseStudentFeesQuery,
  unpromptedNameMatches,
  type StudentLike,
} from "./erpCommands";
import { devanagariToLatin, nameSoundKey } from "./nameSound";

console.log("staffChatBare.selftest.ts");

const AY = "2026-27";
const st = (id: string, fullName: string, over: Partial<StudentLike> = {}): StudentLike => ({
  id,
  fullName,
  rollNo: "",
  classId: "c5",
  sectionId: "s5a",
  status: "active",
  academicYearCode: AY,
  ...over,
});
const roster = [
  st("sujit", "Sujit Kumar"),
  st("aarav1", "Aarav Singh"),
  st("aarav2", "Aarav Sharma"),
  st("om", "Om Prakash Yadav"),
  st("omkar", "Omkar Maurya"),
  st("sirisha", "Sirisha Gupta"),
  st("vaibhav", "Vaibhav Pandey"),
  st("old", "Sujit Kumar", { academicYearCode: "2025-26" }),
];

/* ── A name on its own ───────────────────────────────────────────── */
{
  // The local parser still leaves a name alone — the server answers it
  // only after checking the roster.
  for (const t of ["Sujit kumar", "Aarav singh", "Om"]) {
    assert.equal(parseErpCommandLocal(t), null, t);
  }
  assert.ok(looksLikeBareName("Om", { minSingle: 2 }), "a two-letter name can be a child");
  assert.ok(!looksLikeBareName("Om"), "…but not where the old rule applies");

  const find = (t: string) =>
    unpromptedNameMatches(t, matchStudents({ name: t }, roster, { academicYearCode: AY, limit: 12 })).map((m) => m.student.id);

  assert.deepEqual(find("Sujit kumar"), ["sujit"], "this year's record only");
  assert.deepEqual(find("Aarav singh"), ["aarav1"]);
  assert.deepEqual(find("Aarav").sort(), ["aarav1", "aarav2"], "two Aaravs: the desk asks which");
  assert.deepEqual(find("Om"), ["om"], "Om is Om Prakash, not Omkar — one word must BE a name");

  // Conversation never opens a record.
  assert.deepEqual(find("Sir"), [], "'Sir' is not Sirisha");
  assert.deepEqual(find("Good morning"), []);
  assert.deepEqual(find("thanks"), []);
  assert.deepEqual(find("ok sir"), []);
  assert.deepEqual(find("Tutor"), []);
}

/* ── A name typed in Hindi ───────────────────────────────────────── */
{
  const pairs: [string, string][] = [
    ["वैभव", "Vaibhav"], ["पांडे", "Pandey"], ["सुजीत", "Sujit"], ["कुमार", "Kumar"],
    ["आरव", "Aarav"], ["सिंह", "Singh"], ["ओम", "Om"], ["सिद्धार्थ", "Siddharth"],
    ["पूजा", "Puja"], ["कृष्ण", "Krishna"], ["श्रेया", "Shreya"], ["गुप्ता", "Gupta"],
    ["मौर्य", "Maurya"], ["विश्वकर्मा", "Vishwakarma"],
  ];
  for (const [hi, en] of pairs) assert.equal(nameSoundKey(hi), nameSoundKey(en), `${hi} ~ ${en}`);
  // Latin spellings of one name fold together too.
  assert.equal(nameSoundKey("Sidharth"), nameSoundKey("Siddharth"));
  assert.equal(nameSoundKey("Pande"), nameSoundKey("Pandey"));
  assert.equal(devanagariToLatin("राम"), "raam", "the final a is not said");

  const q = parseStudentFeesQuery("वैभव पांडे का कितना फीस बकाया है?");
  assert.equal(q?.name, "वैभव पांडे");
  const hits = matchStudents(q!, roster, { academicYearCode: AY });
  assert.deepEqual(hits.map((h) => h.student.id), ["vaibhav"]);
  assert.deepEqual(
    unpromptedNameMatches("वैभव", matchStudents({ name: "वैभव" }, roster, { academicYearCode: AY })).map((m) => m.student.id),
    ["vaibhav"],
  );
  // A spelling that matched is never beaten by a sound-alike.
  assert.deepEqual(matchStudents({ name: "Sujit" }, roster, { academicYearCode: AY }).map((m) => m.student.id), ["sujit"]);
}

/* ── A class on its own ──────────────────────────────────────────── */
{
  const cls = (t: string) => {
    const p = parseErpCommandLocal(t);
    return p?.commandId === "class_roster" ? p.fields.section : null;
  };
  assert.equal(cls("5A"), "5A");
  assert.equal(cls("4A"), "4A");
  assert.equal(cls("Class 5"), "5");
  assert.equal(cls("class 5"), "5");
  assert.equal(cls("IV"), "4");
  assert.equal(cls("VIII B"), "8B");
  assert.equal(cls("LKG"), "lkg");
  assert.equal(cls("Nursery"), "nursery");
  assert.equal(cls("कक्षा 5"), "5");
  assert.equal(cls("5A list"), "5A");
  assert.equal(cls("class 3 ke bachche"), "3");
  assert.equal(cls("5th A"), "5A");
  assert.equal(cls("Class 5?"), "5");

  // Not classes.
  assert.equal(parseBareClassQuery("5"), null, "a bare number answers a numbered list");
  assert.equal(parseBareClassQuery("I"), null);
  assert.equal(parseBareClassQuery("V"), null);
  assert.equal(parseBareClassQuery("hello"), null);
  assert.equal(parseBareClassQuery("5A absent"), null, "that is the absent list");
  assert.equal(parseErpCommandLocal("5A absent")?.commandId, "absent_list");
  assert.equal(parseErpCommandLocal("5A defaulters")?.commandId, "class_defaulters");
  assert.equal(parseBareClassQuery("class V"), "5", "with 'class' in front a lone V is a class");

  // The count question goes to the ask desk, whose class match now knows IV is 4.
  assert.equal(parseErpCommandLocal("Class 4 में कितने बच्चे हैं?"), null);
  assert.ok(classRefMatches("4", "IV", "A"));
  assert.ok(classRefMatches("4A", "IV", "A"));
  assert.ok(classRefMatches("class 4", "IV", "A"));
  assert.ok(classRefMatches("CLASS4", "IV", "A"));
  assert.ok(classRefMatches("IV", "IV", "A"));
  assert.ok(classRefMatches("IVA", "IV", "A"));
  assert.ok(classRefMatches("LKG", "LKG", "A"));
  assert.ok(classRefMatches("", "IV", "A"), "no class asked = every class");
  assert.ok(!classRefMatches("5", "IV", "A"));
  assert.ok(!classRefMatches("4B", "IV", "A"));
  assert.ok(!classRefMatches("14", "IV", "A"), "4 is not a prefix of 14");
  assert.ok(!classRefMatches("xyz", "IV", "A"));

  // The list: numbered by roll, and the numbers open the child.
  const input = {
    title: "V A",
    wholeClass: false,
    rows: [
      { studentId: "b", fullName: "Beena", rollNo: "2", sectionLabel: "V A", gender: "F" },
      { studentId: "a", fullName: "Aarav", rollNo: "1", sectionLabel: "V A", gender: "M" },
      { studentId: "c", fullName: "Chirag", rollNo: "", sectionLabel: "V A", gender: "" },
    ],
  };
  const text = formatClassRosterReply(input);
  assert.match(text, /^\*V A\* · 3 students \(1 boys, 1 girls, 1 not recorded\)/);
  assert.match(text, /\n1\. Aarav · Roll 1\n2\. Beena · Roll 2\n3\. Chirag\n/);
  const picks = classRosterPicks(input);
  assert.deepEqual(picks.map((p) => [p.n, p.studentId, p.commandId]), [
    [1, "a", "student_details"],
    [2, "b", "student_details"],
    [3, "c", "student_details"],
  ]);
  assert.match(formatClassRosterReply({ ...input, rows: [] }), /no active students/);
}

/* ── Fee words that are not a child ──────────────────────────────── */
{
  const help = (t: string) => {
    const p = parseErpCommandLocal(t);
    return p?.commandId === "fee_help" ? p.fields.text : `(${p?.commandId ?? "none"})`;
  };
  assert.equal(help("Collect fee"), "collect");
  assert.equal(help("Take fee"), "collect");
  assert.equal(help("How to collect fee"), "collect");
  assert.equal(help("fees kaise jama kare"), "collect", "not a child called Kaise Kare");
  assert.equal(help("Store due"), "store");
  assert.equal(help("Sell due"), "store");
  assert.equal(help("Transport due"), "transport");
  assert.equal(parseFeeHelpQuery("fees collected this week"), null, "a collections question, not a how");
  assert.equal(parseFeeHelpQuery("Aarav store due"), null, "a child is named");

  // Filler words are not part of the name.
  const name = (t: string) => {
    const p = parseErpCommandLocal(t);
    return p?.commandId === "student_fees" ? p.fields.student : `(${p?.commandId ?? "none"})`;
  };
  assert.equal(name("Sujit kumar ka fees lena hai"), "sujit kumar");
  assert.equal(name("Sujit kumar ka bakaya"), "sujit kumar");
  assert.equal(name("Sujit kumar ki fees jama karni hai"), "sujit kumar");
  assert.equal(name("Aarav Sharma 4B fees"), "aarav sharma 4B");

  // …and the part of the dues asked about rides along.
  const store = parseErpCommandLocal("Aarav store due");
  assert.equal(store?.commandId, "student_fees");
  assert.equal(store?.fields.student, "aarav");
  assert.equal(store?.fields.text, "store");
  assert.equal(parseErpCommandLocal("Aarav ka bus fee")?.fields.text, "transport");
}

/* ── The fee reply says the part asked about first ───────────────── */
{
  const base = {
    studentName: "Aarav Singh",
    classLabel: "V A",
    rollNo: "1",
    todayIso: "2026-09-21",
    lastReceipt: null,
    parentMobile: "",
    siblings: [],
    detail: "basic" as const,
    formatInr: (p: number) => `₹${p / 100}`,
  };
  const due = (headName: string, kind: string, paise: number) => ({
    label: "Sep", headName, kind, dueOn: "2026-09-10", balancePaise: paise, billedPaise: paise,
    concessionPaise: 0, concessionNames: [], future: false,
  });
  const dues = [due("Tuition", "structure", 3_300_00), due("Store", "store", 850_00), due("Transport", "transport", 1_000_00)];
  const all = formatStudentFeesReply({ ...base, dues });
  assert.match(all, /Total due today: \*₹5150\*/, "store and bus are in the total");
  const s = formatStudentFeesReply({ ...base, dues, focus: "store" });
  assert.match(s.split("\n")[1]!, /^Store due: \*₹850\*$/);
  const t = formatStudentFeesReply({ ...base, dues: [dues[0]!], focus: "transport" });
  assert.match(t, /Transport: nothing due ✅/);
  const unread = formatStudentFeesReply({ ...base, dues: [dues[0]!], storeUnread: true });
  assert.match(unread, /Store bills couldn't be read just now/, "an unread store is said, not counted as zero");
}

console.log("  ok");
