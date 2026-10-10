/**
 * PDF reports on command — parsing, precedence against the other commands,
 * and the table formatters.
 * Run: npx tsx src/lib/erpReports.selftest.ts
 */
import assert from "node:assert/strict";
import { parseErpCommandLocal } from "./erpCommands";
import {
  admissionsTable,
  attendanceRegisterTable,
  classListTable,
  collectionTable,
  defaultersTable,
  maskMobile,
  parseReportQuery,
  reportFilename,
} from "./erpReports";

console.log("erpReports.selftest.ts");

/* ── what is a report request ──────────────────────────────────── */
const yes: [string, string][] = [
  ["defaulters report pdf", "defaulters"],
  ["class 5 defaulters list", "defaulters"],
  ["bakayedar list pdf", "defaulters"],
  ["aaj ka collection pdf", "collection"],
  ["collection sheet this week", "collection"],
  ["pichle mahine ka collection pdf", "collection"],
  ["5A attendance register pdf", "attendance_register"],
  ["class 3 B ki attendance sheet kal ki", "attendance_register"],
  ["5A attendance register", "attendance_register"],
  ["class 5 student list pdf", "class_list"],
  ["roll list 4B", "class_list"],
  ["admissions report pdf", "admissions"],
  ["is hafte ki enquiry list pdf", "admissions"],
];
for (const [q, kind] of yes) assert.equal(parseReportQuery(q)?.kind, kind, q);
const no = [
  "5A me aaj kaun absent hai",
  "class 3 defaulters",
  "how much fee collected today",
  "attendance kaisi rahi",
  "students ko ground me le jao",
  "make a list of items for the event",
  "register kholo",
  "report card kab milega",
  "admissions report",
  "admissions this week",
  "kal ki hazri report",
  "class 5 defaulters report",
  "aaj ka collection report",
  "collection report",
  "aaj ka collection",
];
for (const q of no) assert.equal(parseReportQuery(q), null, `not a report: ${q}`);

/* ── precedence in the desk's parser ───────────────────────────── */
assert.equal(parseErpCommandLocal("class 5 defaulters report pdf")?.commandId, "report");
assert.equal(parseErpCommandLocal("class 5 defaulters report pdf")?.fields.text, "defaulters");
assert.equal(parseErpCommandLocal("5A attendance register")?.commandId, "report");
assert.equal(parseErpCommandLocal("class 3 defaulters")?.commandId, "class_defaulters", "the reading still wins without a document word");
assert.equal(parseErpCommandLocal("class 3 defaulters report")?.commandId, "class_defaulters", "'report' alone is the reading, not a PDF");
assert.equal(parseErpCommandLocal("kal ki hazri report")?.commandId, "attendance_summary");
assert.equal(parseErpCommandLocal("aaj ka collection report")?.commandId, "collection_today");
assert.equal(parseErpCommandLocal("5A me aaj kaun absent hai")?.commandId, "absent_list");
assert.equal(parseErpCommandLocal("how much fee collected today")?.commandId, "collection_today");
assert.equal(parseErpCommandLocal("Amay ki fees")?.commandId, "student_fees");
assert.equal(parseErpCommandLocal("students ko ground me le jao"), null);

/* ── tables ────────────────────────────────────────────────────── */
{
  const t = defaultersTable({
    scopeLabel: "Class 5 A",
    todayIso: "2026-09-09",
    rows: [
      { name: "B", admissionNo: "A2", classLabel: "Class 5 A", overdueDays: 40, overdueAmountPaise: 500000, earliestDueOn: "2026-07-01", planCode: null, mobileMasked: maskMobile("9451938805") },
      { name: "A", admissionNo: "A1", classLabel: "Class 5 A", overdueDays: 120, overdueAmountPaise: 1200000, earliestDueOn: "2026-05-01", planCode: "EMI-3", mobileMasked: maskMobile("") },
    ],
  });
  assert.equal(t.rows[0]!.name, "A", "largest overdue first");
  assert.equal(t.rows[0]!.amount, "₹12,000");
  assert.equal(t.rows[1]!.mobile, "••••••8805");
  assert.equal(t.rows[0]!.mobile, "—");
  assert.match(t.footer[0]!, /2 students · total overdue ₹17,000/);
  assert.equal(t.filename, "defaulters_class-5-a_2026-09-09.pdf");
  assert.match(t.summary, /2 defaulters · ₹17,000 overdue/);
}
{
  const t = collectionTable({
    rangeLabel: "today",
    from: "2026-09-09",
    to: "2026-09-09",
    rows: [
      { receiptNo: "RCV-00520", date: "2026-09-09", student: "X", classLabel: "Class 2 A", mode: "UPI", amountPaise: 300000, cashier: "director" },
      { receiptNo: "RCV-00519", date: "2026-09-09", student: "Y", classLabel: "Class 1 B", mode: "Cash", amountPaise: 150000, cashier: "director" },
    ],
  });
  assert.equal(t.rows[0]!.receipt, "RCV-00519", "receipt order within a day");
  assert.match(t.footer[0]!, /2 receipts · total ₹4,500/);
  assert.match(t.footer[1]!, /UPI ₹3,000 · Cash ₹1,500/);
  assert.equal(t.subtitle, "today · 2026-09-09");
}
{
  const t = attendanceRegisterTable({
    sectionLabel: "Class 5 A",
    date: "2026-09-09",
    markedBy: "",
    rows: [
      { rollNo: "2", name: "B", status: "A", note: "" },
      { rollNo: "1", name: "A", status: "P", note: "" },
      { rollNo: "", name: "C", status: null, note: "" },
    ],
  });
  assert.equal(t.rows[0]!.name, "A", "roll order");
  assert.equal(t.rows[2]!.status, "—", "an unmarked child is shown as unmarked, not absent");
  assert.match(t.footer[0]!, /present 1 · absent 1 .* not marked 1/);
  assert.match(t.subtitle, /not marked$/);
}
{
  const t = classListTable({ scopeLabel: "whole school", rows: [{ rollNo: "1", name: "A", admissionNo: "X1", classLabel: "Class 2 A", fatherName: "F", mobileMasked: "—" }] });
  assert.equal(t.rows.length, 1);
  assert.equal(t.filename, "class-list_whole-school.pdf");
}
{
  const t = admissionsTable({ rangeLabel: "this week", from: "2026-09-07", to: "2026-09-09", rows: [{ enquiryNo: "E1", date: "2026-09-08", childName: "K", classSought: "Class 1", guardianName: "G", mobileMasked: "—", source: "Walk-in", stage: "Enquiry" }] });
  assert.match(t.footer[0]!, /1 enquiry$/);
  assert.match(t.footer[1]!, /Enquiry 1/);
}
assert.equal(reportFilename("collection", "", "2026-09-07_2026-09-09"), "collection_2026-09-07-2026-09-09.pdf");

console.log("  ok");
