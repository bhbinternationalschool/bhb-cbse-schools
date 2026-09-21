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
  formatCallNumber,
  formatClassDefaultersReply,
  formatClassRosterReply,
  formatInventoryReply,
  formatStoreSummaryReply,
  formatStudentFeesReply,
  formatTopDuesReply,
  matchInventoryRows,
  parseStoreQuery,
  topDuesPicks,
  type TopDuesFamily,
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
  // "Store due" alone is the list of who owes the store — see top dues below.
  assert.equal(help("Store due"), "(top_dues)");
  assert.equal(help("Transport due"), "(top_dues)");
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

/* ── Top dues: who to call ───────────────────────────────────────── */
{
  const top = (t: string) => {
    const p = parseErpCommandLocal(t);
    return p?.commandId === "top_dues" ? `${p.fields.date}|${p.fields.text}` : `(${p?.commandId ?? "none"})`;
  };
  assert.equal(top("top 10 defaulters"), "10|");
  assert.equal(top("defaulters"), "10|");
  assert.equal(top("all defaulters"), "10|");
  assert.equal(top("top 20 dues with number"), "20|");
  assert.equal(top("top 50 dues"), "25|", "capped at 25 — a WhatsApp message, not a register");
  assert.equal(top("sabse jyada baki"), "10|");
  assert.equal(top("defaulter list with mobile"), "10|");
  assert.equal(top("who owes most"), "10|");
  assert.equal(top("Store due"), "10|store");
  assert.equal(top("Sell due"), "10|store");
  assert.equal(top("store due list"), "10|store", "not the fee defaulters PDF");
  assert.equal(top("top 5 store dues"), "5|store");
  assert.equal(top("Transport due"), "10|transport");
  assert.equal(top("bus dues"), "10|transport");

  // Not the school list.
  assert.equal(top("top 10 defaulters pdf"), "(report)", "a document is still the report");
  assert.equal(top("defaulters list"), "(report)", "'list' still asks for the document");
  assert.equal(top("5A defaulters"), "(class_defaulters)");
  assert.equal(top("class 10 top dues"), "(class_defaulters)", "class 10, not a count of 10");
  assert.equal(top("Aarav store due"), "(student_fees)");
  assert.equal(top("leave pending"), "(pending_leaves)");

  const fam = (over: Partial<TopDuesFamily>): TopDuesFamily => ({
    studentId: "s",
    children: [{ name: "Child", classLabel: "V A" }],
    feesPaise: 0,
    transportPaise: 0,
    storePaise: 0,
    overdueDays: 0,
    guardian: "",
    mobile: "",
    ...over,
  });
  const input = {
    todayIso: "2026-09-21",
    focus: "" as const,
    limit: 2,
    storeUnread: false,
    formatInr: (p: number) => `₹${p / 100}`,
    families: [
      fam({ studentId: "a", children: [{ name: "Aarav Singh", classLabel: "V A" }, { name: "Riya Singh", classLabel: "II A" }], feesPaise: 20_000_00, transportPaise: 3_000_00, storePaise: 1_500_00, overdueDays: 92, guardian: "Ramesh Singh", mobile: "9876543210" }),
      fam({ studentId: "b", children: [{ name: "Om Vishwakarma", classLabel: "III A" }], feesPaise: 5_000_00, overdueDays: 40, mobile: "919123456789" }),
      fam({ studentId: "c", children: [{ name: "Tiny", classLabel: "I A" }], storePaise: 100_00 }),
      fam({ studentId: "d", children: [{ name: "Paid Up", classLabel: "I A" }] }),
    ],
  };
  const text = formatTopDuesReply(input);
  assert.match(text, /^\*Top 2 dues\* · 21 Sep\n3 families owe \*₹29600\* in all/, "the families owing, not the ones paid up");
  assert.match(text, /\*1\.\* Aarav Singh \(V A\), Riya Singh \(II A\)\n   \*₹24500\* · 92d · fees ₹20000 \+ bus ₹3000 \+ store ₹1500\n   📞 Ramesh Singh \+91 98765 43210/);
  assert.match(text, /\*2\.\* Om Vishwakarma \(III A\)\n   \*₹5000\* · 40d\n   📞 \+91 91234 56789/, "a 91-prefixed number is still the same phone");
  assert.doesNotMatch(text, /Tiny/, "only the top N");
  assert.deepEqual(topDuesPicks(input).map((p) => [p.n, p.studentId, p.commandId]), [[1, "a", "student_fees"], [2, "b", "student_fees"]]);

  // Ranked by the part asked about.
  const store = formatTopDuesReply({ ...input, focus: "store", limit: 5 });
  assert.match(store, /^\*Top 2 store dues\*/);
  assert.match(store, /\*1\.\* Aarav Singh.*\n   \*₹1500\*/);
  assert.match(store, /\*2\.\* Tiny/);
  // An unreadable store is said, never "nobody owes the store".
  assert.match(formatTopDuesReply({ ...input, focus: "store", storeUnread: true }), /couldn't be read/);
  assert.match(formatTopDuesReply({ ...input, storeUnread: true }), /not in these totals/);
  assert.match(formatTopDuesReply({ ...input, families: [] }), /No family has dues overdue/);
  assert.match(formatTopDuesReply({ ...input, families: [fam({ feesPaise: 100 })] }), /📞 no number on record/);

  assert.equal(formatCallNumber("09876543210"), "+91 98765 43210");
  assert.equal(formatCallNumber("+91 98765-43210"), "+91 98765 43210");
}

/* ── A class's defaulters and a child's dues carry the number ────── */
{
  const reply = formatClassDefaultersReply({
    title: "V A",
    todayIso: "2026-09-21",
    wholeClass: false,
    formatInr: (p: number) => `₹${p / 100}`,
    rows: [
      { sectionLabel: "V A", rollNo: "1", fullName: "Aarav Singh", overdueAmountPaise: 3_300_00, overdueDays: 11, earliestDueOn: "2026-09-10", onPlan: false, studentId: "a", mobile: "9876543210", guardian: "Ramesh Singh" },
      { sectionLabel: "V A", rollNo: "2", fullName: "No Phone", overdueAmountPaise: 1_000_00, overdueDays: 11, earliestDueOn: "2026-09-10", onPlan: false, studentId: "b" },
    ],
  });
  assert.match(reply, /Aarav Singh  ₹3300 · 11d \(10 Sep\)\n    📞 Ramesh Singh \+91 98765 43210/);
  assert.match(reply, /No Phone  ₹1000 · 11d \(10 Sep\)\n/);

  const base = {
    studentName: "Aarav Singh",
    classLabel: "V A",
    rollNo: "1",
    todayIso: "2026-09-21",
    dues: [],
    lastReceipt: null,
    parentMobile: "9876543210",
    siblings: [],
    detail: "basic" as const,
    formatInr: (p: number) => `₹${p / 100}`,
    contacts: [
      { label: "Family", mobile: "9876543210" },
      { label: "Father Ramesh Singh", mobile: "+91 98765 43210" },
      { label: "Mother Sita Singh", mobile: "9123456789" },
      { label: "Mother", mobile: "" },
    ],
  };
  const full = formatStudentFeesReply({ ...base, callable: true });
  assert.match(full, /📞 Family: \+91 98765 43210\n📞 Mother Sita Singh: \+91 91234 56789/, "the same number once, blanks skipped");
  assert.doesNotMatch(full, /Father Ramesh Singh:/);
  const masked = formatStudentFeesReply({ ...base, callable: false });
  assert.match(masked, /Parent: 98xxxxxx10/, "a teacher of another class still sees it masked");
  assert.doesNotMatch(masked, /📞/);
}

/* ── The store and its stock ─────────────────────────────────────── */
{
  const kind = (t: string) => {
    const p = parseErpCommandLocal(t);
    if (p?.commandId === "inventory_stock") return `inventory:${p.fields.text}`;
    return p?.commandId ?? "none";
  };
  assert.equal(kind("store"), "store_summary");
  assert.equal(kind("Store report"), "store_summary");
  assert.equal(kind("aaj ki bikri"), "store_summary");
  assert.equal(kind("store sale today"), "store_summary");
  assert.equal(kind("Inventory"), "inventory:");
  assert.equal(kind("stock"), "inventory:");
  assert.equal(kind("low stock"), "inventory:");
  assert.equal(kind("stock report"), "inventory:");
  assert.equal(kind("notebook stock"), "inventory:notebook");
  assert.equal(kind("stock of tie"), "inventory:tie");
  assert.equal(kind("uniform ka stock kitna hai"), "inventory:uniform");
  assert.equal(parseStoreQuery("store dues"), null, "that is who owes the store");

  const inr = (p: number) => `₹${p / 100}`;
  const summary = formatStoreSummaryReply({
    todayIso: "2026-09-21", salesTodayPaise: 4_500_00, collectedTodayPaise: 3_000_00, marginTodayPaise: 900_00,
    monthSalesPaise: 60_000_00, monthMarginPaise: 12_000_00, studentOutstandingPaise: 18_500_00,
    vendorOutstandingPaise: 40_000_00, vendorOverduePaise: 0, stockValuePaise: 2_10_000_00,
    lowStockCount: 7, itemCount: 180, showMargin: false, formatInr: inr,
  });
  assert.match(summary, /Sold today: \*₹4500\* · collected ₹3000\n/);
  assert.doesNotMatch(summary, /margin/, "margins are for the director and accounts");
  assert.match(summary, /Students owe the store: \*₹18500\*/);
  assert.match(summary, /\*7 running low\*/);

  const row = (itemName: string, qtyOnHand: number, reorderLevel: number, categoryName = "Stationery") => ({
    itemName, categoryName, uomName: "pcs", qtyOnHand, reorderLevel, belowReorder: reorderLevel > 0 && qtyOnHand <= reorderLevel, valuePaise: qtyOnHand * 100,
  });
  const rows = [row("Notebook 200 pages", 12, 50), row("Notebook 100 pages", 300, 50), row("Tie (Class I–V)", 0, 10, "Uniform"), row("Pencil", 900, 100)];
  const inv = formatInventoryReply({ item: "", rows, totals: { valuePaise: 1_212_00, lines: 4, belowReorder: 2 }, formatInr: inr });
  assert.match(inv, /\*2 running low\* — reorder:\n\n• Notebook 200 pages: 12 pcs left \(reorder at 50\)\n• Tie \(Class I–V\): 0 pcs left \(reorder at 10\)/, "furthest below its level first");
  const one = formatInventoryReply({ item: "notebook", rows, totals: { valuePaise: 0, lines: 4, belowReorder: 2 }, formatInr: inr });
  assert.match(one, /Notebook 200 pages: \*12 pcs\* \(reorder at 50\) ⚠️ low\nNotebook 100 pages: \*300 pcs\*/);
  assert.match(formatInventoryReply({ item: "ties", rows, totals: { valuePaise: 0, lines: 4, belowReorder: 2 }, formatInr: inr }), /Tie \(Class I–V\): \*0 pcs\*/, "plural typed, singular stored");
  assert.match(formatInventoryReply({ item: "cricket bat", rows, totals: { valuePaise: 0, lines: 4, belowReorder: 2 }, formatInr: inr }), /No store item matches "cricket bat"/);
  assert.deepEqual(matchInventoryRows(rows, "uniform").map((r) => r.itemName), ["Tie (Class I–V)"], "a category word finds its items");

  // Production on 21 Sep 2026: 30 items, not one with a reorder level, five
  // at zero. "Nothing below its reorder level ✅" would have been a fact
  // made out of an unset field.
  const unset = [row("Belt", 0, 0), row("Diary", 4, 0), row("Notebook", 250, 0), row("Tie", 0, 0)];
  const noLevels = formatInventoryReply({ item: "", rows: unset, totals: { valuePaise: 25_400, lines: 4, belowReorder: 0 }, formatInr: inr });
  assert.doesNotMatch(noLevels, /✅/, "an unset level is not 'nothing is low'");
  assert.match(noLevels, /\*2 out of stock:\*\n• Belt\n• Tie/);
  assert.match(noLevels, /No item has a reorder level set/);
  assert.match(noLevels, /\*Lowest quantities:\*\n• Diary: 4 pcs\n• Notebook: 250 pcs/);
}

console.log("  ok");
