/**
 * Run: npx tsx src/lib/reportsRegistersNew.selftest.ts
 *
 * New registers (Report Center audit step 5b, 14 Oct 2026):
 *  - student fee ledger: dues on their due dates, concessions, receipts on
 *    collection dates (cancelled left out), running balance, closing, and
 *    what is still to fall due kept outside the balance;
 *  - strength by gender × category × RTE × CWSN;
 *  - UDISE+ age matrix: completed years on the as-on date; missing or
 *    doubtful birth dates counted apart, never guessed into an age;
 *  - complaints register / open ageing / by category.
 */
import assert from "node:assert/strict";
import { emptyFeesState, type CollectionVoucher, type FeesState } from "./fees";
import { emptyMastersShell, type MastersState } from "./masters";
import type { SisStudent } from "./sis";
import { studentLedgerLines } from "./feeReportCatalog";
import { __sisReportInternalsForTests as SIS } from "./sisReportCatalog";
import { complaintsReportRows } from "./complaintsReportCatalog";
import type { ComplaintTicket } from "./complaints";

process.on("unhandledRejection", () => undefined);

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`);
  }
}

const AY = "2026-27";
const masters = {
  ...emptyMastersShell(),
  classes: [{ id: "c4", name: "IV", isActive: true, sortOrder: 6 }, { id: "c1", name: "I", isActive: true, sortOrder: 3 }],
  sections: [{ id: "s4a", classId: "c4", name: "A", isActive: true }, { id: "s1a", classId: "c1", name: "A", isActive: true }],
  academicYears: [{ code: AY, isCurrent: true }],
  feeHeads: [{ id: "fh_t", code: "TUI", nameEn: "Tuition", category: "academic", frequency: "installment", isOptional: false, isActive: true }],
  feeGroups: [{ id: "fg1", code: "GEN", name: "General", academicYearCode: AY, studentType: "promoted", classIds: [], isActive: true, structurePublishedAt: "2026-04-01", structurePublishedBy: "" }],
  installments: [
    { id: "i_apr", academicYearCode: AY, code: "APR", label: "April", dueOn: "2026-04-10", sortOrder: 1, isActive: true },
    { id: "i_oct", academicYearCode: AY, code: "OCT", label: "October", dueOn: "2026-10-10", sortOrder: 2, isActive: true },
    { id: "i_jan", academicYearCode: AY, code: "JAN", label: "January", dueOn: "2027-01-10", sortOrder: 3, isActive: true },
  ],
  feeStructureLines: ["apr", "oct", "jan"].map((k) => ({ id: `l_${k}`, feeGroupId: "fg1", feeHeadId: "fh_t", classId: null, amountPaise: 100000, installmentId: `i_${k}` })),
} as unknown as MastersState;

const kid = (p: Partial<SisStudent>): SisStudent =>
  ({ id: "", fullName: "", admissionNo: "", classId: "c4", sectionId: "s4a", status: "active", academicYearCode: AY, studentType: "promoted", feeGroupId: "fg1", joinedOn: "2024-04-01", gender: "M", category: "GEN", dob: "2016-05-01", ...p }) as unknown as SisStudent;

const voucher = (p: Partial<CollectionVoucher>): CollectionVoucher =>
  ({ id: "v", receiptNo: "R", academicYearCode: AY, collectionDate: "2026-04-15", transactionDate: "", transactionId: "", collectedAt: "", cashierName: "", lines: [], tenders: [{ mode: "cash", amountPaise: 100000 }], totalPaise: 100000, note: "", voidedAt: null, whatsappSentAt: null, ...p }) as unknown as CollectionVoucher;

check("fee ledger: dated dues and receipts, running balance, future kept apart", () => {
  const kunal = kid({ id: "kunal", fullName: "Kunal" });
  const fees: FeesState = {
    ...emptyFeesState(),
    vouchers: [
      voucher({ id: "v1", receiptNo: "R-1", collectionDate: "2026-04-15", lines: [{ dueKey: "acad:kunal:l_apr", studentId: "kunal", studentName: "Kunal", label: "Tuition · April", kind: "academic", amountPaise: 100000 }] } as never),
      voucher({ id: "v2", receiptNo: "R-2", collectionDate: "2026-05-01", voidedAt: "2026-05-02T00:00:00Z", lines: [{ dueKey: "acad:kunal:l_oct", studentId: "kunal", studentName: "Kunal", label: "Tuition · October", kind: "academic", amountPaise: 100000 }] } as never),
    ],
  };
  const lines = studentLedgerLines(kunal, masters, fees, "2026-10-14");
  const real = lines.filter((l) => l.date);
  assert.deepEqual(real.map((l) => [l.date, l.debit, l.credit, l.balance]), [
    ["2026-04-10", 100000, 0, 100000],
    ["2026-04-15", 0, 100000, 0],
    ["2026-10-10", 100000, 0, 100000],
    ["2026-10-14", 0, 0, 100000],
  ], "the cancelled receipt is not a payment");
  assert.match(real[real.length - 1]!.particulars, /Closing balance due/);
  const future = lines.find((l) => !l.date)!;
  assert.match(future.particulars, /Still to fall due/);
  assert.equal(future.balance, 100000, "January, outside the balance");
});

const roster = [
  kid({ id: "a", fullName: "A", gender: "M", category: "OBC", dob: "2016-10-01" }),
  kid({ id: "b", fullName: "B", gender: "F", category: "SC", studentType: "RTE" as never, dob: "2017-09-30" }),
  kid({ id: "c", fullName: "C", gender: "F", category: "" as never, isCwsn: true, dob: "" }),
  kid({ id: "d", fullName: "D", gender: "M", category: "GEN", classId: "c1", sectionId: "s1a", dob: "2026-05-01" }),
];

check("strength matrix: gender, category, RTE, CWSN; school class order", () => {
  const t = SIS.strengthMatrix(roster, masters);
  assert.equal(t.rows[0]!.className, "I", "I (order 3) before IV (order 6)");
  const iv = t.rows.find((r) => r.className === "IV")!;
  assert.deepEqual([iv.boys, iv.girls, iv.obc, iv.sc, iv.noCategory, iv.rte, iv.cwsn, iv.total], [1, 2, 1, 1, 1, 1, 1, 3]);
});

check("UDISE age matrix: age on the as-on date; missing and doubtful apart", () => {
  const t = SIS.udiseAgeMatrix(roster, masters, AY);
  assert.equal(t.asOn, "2026-09-30", "default 30 September of the session");
  const ivBoys = t.rows.find((r) => r.className === "IV" && r.gender === "Boys")!;
  assert.equal(ivBoys.a9, 1, "born 1 Oct 2016: 9 on 30 Sep 2026, not 10");
  const ivGirls = t.rows.find((r) => r.className === "IV" && r.gender === "Girls")!;
  assert.equal(ivGirls.a9, 1, "born 30 Sep 2017: 9 that day");
  assert.equal(ivGirls.dobMissing, 1);
  const iBoys = t.rows.find((r) => r.className === "I" && r.gender === "Boys")!;
  assert.equal(iBoys.dobDoubtful, 1, "a 0-year-old in class I is a bad date, not an age");
});

check("complaints: register, open ageing, by category", () => {
  const t = (p: Partial<ComplaintTicket>): ComplaintTicket =>
    ({ id: "", householdId: "", studentId: null, raisedByName: "Parent", raisedByMobile: "9", category: "transport", subject: "Bus late", description: "", date: "2026-10-01", assignedToStaffId: null, dueByDate: null, status: "open", resolutionNote: "", resolvedAt: null, source: "whatsapp", createdAt: "", updatedAt: "", ...p }) as ComplaintTicket;
  const tickets = [
    t({ id: "1", date: "2026-10-01", dueByDate: "2026-10-05" }),
    t({ id: "2", date: "2026-10-02", status: "resolved", resolvedAt: "2026-10-05T10:00:00Z" }),
    t({ id: "3", date: "2026-09-01", status: "closed", resolvedAt: "2026-09-02T20:00:00Z", category: "academics" as never }),
  ];
  const ctx = { staffName: () => "", studentName: () => "", today: "2026-10-14" };
  const reg = complaintsReportRows("register", tickets, { ...ctx, from: "2026-10-01" });
  assert.equal(reg.rows.length, 2);
  assert.equal(reg.rows.find((r) => r.subject && r.status !== "Open")!.days, 3);
  const open = complaintsReportRows("open_ageing", tickets, ctx);
  assert.equal(open.rows.length, 1);
  assert.equal(open.rows[0]!.daysOpen, 13);
  assert.match(String(open.rows[0]!.overdue), /^Yes · 9/);
  assert.equal(open.rows[0]!.assignee, "Not assigned");
  const sum = complaintsReportRows("summary", tickets, ctx);
  const trans = sum.rows.find((r) => r.raised === 2)!;
  assert.deepEqual([trans.resolved, trans.open, trans.avgDays], [1, 1, 3]);
  const acad = sum.rows.find((r) => r.raised === 1)!;
  assert.equal(acad.avgDays, 2, "resolved 2 Sep 20:00 UTC is 3 Sep in IST");
});

setTimeout(() => {
  if (failures) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("  all ok");
  process.exit(0);
}, 50);
