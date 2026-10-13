/**
 * Run: npx tsx src/lib/feeReportsYearScope.selftest.ts
 *
 * Fee reports (Reports Center → Fees), 14 Oct 2026:
 *  - dues are the SELECTED YEAR's children, once each. SIS keeps one row per
 *    child per year and every row stays "active"; an old row bills against
 *    the current fee structure, so looping sis.students added a phantom
 *    2025-26 copy of every promoted child's dues (the ₹35.8L artefact);
 *  - "outstanding" = due by the as-of date (what the counter offers). Every
 *    dues report counted the year's remaining instalments — January
 *    included — as outstanding in October;
 *  - the whole-year reports split "due till as-of" from "not yet due";
 *  - collection reports honour the selected year (their filter note always
 *    claimed "AY x"; daily collection with no From date covered every year);
 *  - the cancellation report goes by the date of cancellation.
 */
import assert from "node:assert/strict";
import { emptyFeesState, type CollectionVoucher, type FeesState } from "./fees";
import { emptyMastersShell, type MastersState } from "./masters";
import { emptySisState, type SisState, type SisStudent } from "./sis";
import { __feeReportInternalsForTests as T, FEE_REPORTS, runFeeReport } from "./feeReportCatalog";

// The reports end by starting a browser download, which cannot happen in
// Node; this test checks the rows the reports are built from, not the file.
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
const PRIOR = "2025-26";
const AS_OF = "2026-10-14";

const masters = {
  ...emptyMastersShell(),
  classes: [{ id: "c4", name: "Class 4", isActive: true, sortOrder: 4 }],
  sections: [{ id: "s4a", classId: "c4", name: "A", isActive: true }],
  academicYears: [
    { code: AY, isCurrent: true },
    { code: PRIOR, isCurrent: false },
  ],
  feeHeads: [{ id: "fh_t", code: "TUI", nameEn: "Tuition", category: "academic", frequency: "installment", isOptional: false, isActive: true }],
  feeGroups: [
    { id: "fg1", code: "GEN", name: "General", academicYearCode: AY, studentType: "promoted", classIds: [], isActive: true, structurePublishedAt: "2026-04-01", structurePublishedBy: "" },
  ],
  installments: [
    { id: "i_apr", academicYearCode: AY, code: "APR", label: "April", dueOn: "2026-04-10", sortOrder: 1, isActive: true },
    { id: "i_oct", academicYearCode: AY, code: "OCT", label: "October", dueOn: "2026-10-10", sortOrder: 2, isActive: true },
    { id: "i_jan", academicYearCode: AY, code: "JAN", label: "January", dueOn: "2027-01-10", sortOrder: 3, isActive: true },
  ],
  feeStructureLines: [
    { id: "l_apr", feeGroupId: "fg1", feeHeadId: "fh_t", classId: null, amountPaise: 100000, installmentId: "i_apr" },
    { id: "l_oct", feeGroupId: "fg1", feeHeadId: "fh_t", classId: null, amountPaise: 100000, installmentId: "i_oct" },
    { id: "l_jan", feeGroupId: "fg1", feeHeadId: "fh_t", classId: null, amountPaise: 100000, installmentId: "i_jan" },
  ],
} as unknown as MastersState;

const kid = (p: Partial<SisStudent>): SisStudent =>
  ({
    id: "",
    fullName: "Kunal",
    admissionNo: "ADM-1",
    householdId: "hh1",
    classId: "c4",
    sectionId: "s4a",
    status: "active",
    academicYearCode: AY,
    studentType: "promoted",
    feeGroupId: "fg1",
    joinedOn: "2024-04-01",
    ...p,
  }) as unknown as SisStudent;

const sis: SisState = {
  ...emptySisState(),
  students: [kid({ id: "kunal26" }), kid({ id: "kunal25", academicYearCode: PRIOR })],
  households: [],
};

const voucher = (p: Partial<CollectionVoucher>): CollectionVoucher =>
  ({
    id: "v",
    receiptNo: "R",
    academicYearCode: AY,
    collectionDate: "2026-04-15",
    transactionDate: "2026-04-15",
    transactionId: "",
    collectedAt: "2026-04-15T05:00:00Z",
    cashierName: "",
    lines: [],
    tenders: [{ mode: "cash", amountPaise: 100000 }],
    totalPaise: 100000,
    note: "",
    voidedAt: null,
    whatsappSentAt: null,
    source: "counter",
    ...p,
  }) as unknown as CollectionVoucher;

const fees: FeesState = {
  ...emptyFeesState(),
  vouchers: [
    voucher({
      id: "v1",
      receiptNo: "R-1",
      lines: [{ dueKey: "acad:kunal26:l_apr", studentId: "kunal26", studentName: "Kunal", label: "Tuition · April", kind: "academic", amountPaise: 100000 }],
    } as never),
    // Last year's money, collected in March: not this year's collection.
    voucher({ id: "v0", receiptNo: "R-0", academicYearCode: PRIOR, collectionDate: "2026-03-20", transactionDate: "2026-03-20", lines: [] }),
    // Collected in March, cancelled in October.
    voucher({ id: "v2", receiptNo: "R-2", collectionDate: "2026-03-28", voidedAt: "2026-10-05T06:00:00Z", lines: [] }),
  ],
};

check("one child, the selected year's row only", () => {
  assert.deepEqual(T.yearStudents(sis, AY).map((s) => s.id), ["kunal26"]);
  assert.deepEqual(T.yearStudents(sis, "2026-2027").map((s) => s.id), ["kunal26"], "long-form code");
});

check("outstanding = due by the as-of date, this year's row only", () => {
  const dues = T.allOpenDues(sis, masters, fees, AS_OF, AY);
  assert.deepEqual(dues.map((d) => `${d.student.id}:${d.due.dueKey}`), ["kunal26:acad:kunal26:l_oct"], "April paid, October due, January not yet");
  assert.equal(dues.reduce((s, d) => s + d.due.balancePaise, 0), 100000);
});

check("the old behaviour, for the record: every row × every instalment", () => {
  // What the report used to add up: both rows, whole year → ₹5,000 for a child owing ₹1,000.
  const old = [...sis.students].flatMap((st) =>
    T.allOpenDues({ ...sis, students: [st] }, masters, fees, AS_OF, st.academicYearCode, { includeFuture: true }),
  );
  assert.equal(old.reduce((s, d) => s + d.due.balancePaise, 0), 500000);
});

check("the whole year with includeFuture; due-now keys split it", () => {
  const year = T.allOpenDues(sis, masters, fees, AS_OF, AY, { includeFuture: true });
  assert.equal(year.length, 2, "October + January");
  const now = T.dueNowKeys(sis.students[0]!, masters, fees, AS_OF, new Map());
  assert.ok(now.has("acad:kunal26:l_oct"));
  assert.ok(!now.has("acad:kunal26:l_jan"));
});

check("collections honour the year", () => {
  assert.deepEqual(T.activeVouchers(fees, undefined, undefined, AY).map((v) => v.id), ["v1"]);
  const r = runFeeReport("daily_collection", { sis, masters, fees, academicYearCode: AY, format: "excel" });
  assert.ok(r.ok);
  assert.equal((r as { rows: number }).rows, 1, "March 2025-26 receipt left out");
});

check("dues reports count one child, due-by-date", () => {
  const r = runFeeReport("class_wise_outstanding_due_summary", { sis, masters, fees, academicYearCode: AY, asOf: AS_OF, format: "excel" });
  assert.ok(r.ok);
  assert.equal((r as { rows: number }).rows, 1);
});

check("cancellations go by the cancellation date", () => {
  const oct = runFeeReport("fee_cancellation_report", { sis, masters, fees, academicYearCode: AY, fromDate: "2026-10-01", toDate: "2026-10-31", format: "excel" });
  assert.ok(oct.ok);
  assert.equal((oct as { rows: number }).rows, 1, "voided in October → October's cancellations");
  const mar = runFeeReport("fee_cancellation_report", { sis, masters, fees, academicYearCode: AY, fromDate: "2026-03-01", toDate: "2026-03-31", format: "excel" });
  assert.equal(mar.ok ? (mar as { rows: number }).rows : 0, 0);
});

check("hostel / wallet placeholders are gone from the menu and refuse", () => {
  assert.ok(!FEE_REPORTS.some((r) => /hostel|wallet/.test(r.id)));
  const r = runFeeReport("student_wallet_report", { sis, masters, fees, academicYearCode: AY, studentScope: "all", format: "excel" });
  assert.equal(r.ok, false);
});

setTimeout(() => {
  if (failures) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("  all ok");
  process.exit(0);
}, 50);
