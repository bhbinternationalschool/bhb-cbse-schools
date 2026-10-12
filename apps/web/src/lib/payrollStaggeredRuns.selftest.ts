/**
 * Self-test: a month's salary can be paid in parts (director, 13 Oct 2026).
 * Run: npx tsx src/lib/payrollStaggeredRuns.selftest.ts
 *
 * The trap this exists for: once one person's September salary was posted
 * (Rajesh, 7 Oct), "one committed run per month" refused every other draft,
 * approval and publish for September — the other 34 staff could not be paid
 * through the ERP at all. The rule that matters is per person: nobody is
 * paid twice for a month.
 */
import assert from "node:assert/strict";

// Browser-path stubs (as accounts.selftest.ts): payroll saves only persist
// through localStorage, and nothing reads these globals at module scope.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).dispatchEvent ??= () => true;
(globalThis as Record<string, unknown>).addEventListener ??= () => {};
(globalThis as Record<string, unknown>).removeEventListener ??= () => {};
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
};

import { buildBankExportPreview } from "./bankFileExport";
import type { StaffRecord } from "./foundationMasters";
import { defaultMasters, type MastersState } from "./masters";
import {
  approvePayrollRun,
  committedStaffInMonth,
  loadPayroll,
  markPayrollPaid,
  monthPayslipLines,
  processPayrollDraft,
  publishPayrollToAccounts,
  recallPayrollToDraft,
  submitPayrollForApproval,
  writePayrollLocalRaw,
} from "./payroll";
import { emptyStaffAttendanceState, writeStaffAttendanceLocalRaw } from "./staffAttendance";
import { emptyStaffHrState, writeStaffHrLocalRaw } from "./staffHr";

console.log("payrollStaggeredRuns.selftest.ts");

const ay = "2026-27";
const month = "2026-09";
const staff = (id: string) =>
  ({
    id, empCode: id.toUpperCase(), fullName: id, status: "active", stream: "teaching", category: "permanent",
    designationId: "", classTeacherLinks: [], subjectTeachingLinks: [], joiningDate: "2025-04-01",
    bankAccountNo: "123456789012", bankIfsc: "SBIN0001234", bankAccountName: id,
  }) as unknown as StaffRecord;
const masters: MastersState = {
  ...defaultMasters(),
  staff: [staff("a"), staff("b"), staff("c")],
  holidays: [],
};

writeStaffAttendanceLocalRaw(emptyStaffAttendanceState());
writeStaffHrLocalRaw(emptyStaffHrState());
writePayrollLocalRaw({ ...loadPayroll(), runs: [] });

const ok = <T,>(r: { ok: true } & T | { ok: false; error: string }): T => {
  if (!r.ok) assert.fail(r.error);
  return r as T;
};

/* ── 1. pay one person first, all the way to paid ───────────────────── */
const first = ok(processPayrollDraft({ masters, month, academicYearCode: ay, createdBy: "t", mode: "individual", staffIds: ["a"] }));
assert.deepEqual(first.run.lines.map((l) => l.staffId), ["a"]);
ok(approvePayrollRun(first.run.id, "t"));
ok(publishPayrollToAccounts(first.run.id, "t"));
ok(markPayrollPaid(first.run.id, "t", "2026-10-07"));
assert.deepEqual([...committedStaffInMonth(month, ay).keys()], ["a"]);

/* ── 2. the rest of the month is still open ─────────────────────────── */
const rest = ok(processPayrollDraft({ masters, month, academicYearCode: ay, createdBy: "t", mode: "bulk" }));
assert.deepEqual(rest.run.lines.map((l) => l.staffId).sort(), ["b", "c"], "bulk leaves out who is already paid");
assert.equal(rest.skipped.length, 1, "and says who it skipped");
assert.match(rest.skipped[0]!, /A/);
ok(submitPayrollForApproval(rest.run.id, "t"));
ok(approvePayrollRun(rest.run.id, "t"));
ok(publishPayrollToAccounts(rest.run.id, "t"));
assert.equal(
  loadPayroll().runs.filter((r) => r.month === month && r.status !== "draft").length,
  2,
  "two committed runs in one month",
);

/* ── 3. nobody is paid twice ─────────────────────────────────────────── */
const again = processPayrollDraft({ masters, month, academicYearCode: ay, createdBy: "t", mode: "individual", staffIds: ["a"] });
assert.ok(!again.ok && /Nothing was created/.test(again.error) && /already has/.test(again.error), "picking a paid person creates nothing");
const allDone = processPayrollDraft({ masters, month, academicYearCode: ay, createdBy: "t", mode: "bulk" });
assert.ok(!allDone.ok && /every active staff member/.test(allDone.error), "bulk with everyone paid creates nothing");
const mixed = ok(processPayrollDraft({ masters: { ...masters, staff: [...masters.staff, staff("d")] }, month, academicYearCode: ay, createdBy: "t", mode: "individual", staffIds: ["a", "d"] }));
assert.deepEqual(mixed.run.lines.map((l) => l.staffId), ["d"], "a mixed pick keeps only who is due");
assert.equal(mixed.skipped.length, 1);

// A draft that somehow holds a paid person cannot be approved or published.
const state = loadPayroll();
const forged = { ...mixed.run, lines: [...mixed.run.lines, first.run.lines[0]!] };
writePayrollLocalRaw({ ...state, runs: state.runs.map((r) => (r.id === forged.id ? forged : r)) });
const approve = approvePayrollRun(forged.id, "t");
assert.ok(!approve.ok && /Not approved/.test(approve.error) && /Remove that line/.test(approve.error), approve.ok ? "" : approve.error);

/* ── 4. paid stays paid, and says so ────────────────────────────────── */
const recall = recallPayrollToDraft(first.run.id, "t");
assert.ok(!recall.ok && /Nothing was changed/.test(recall.error), "a refused recall says nothing changed");
assert.equal(loadPayroll().runs.find((r) => r.id === first.run.id)!.status, "paid");

/* ── 5. payslips + bank file see the whole month, never double-pay ──── */
const slips = monthPayslipLines(loadPayroll().runs, month, ay);
assert.deepEqual(slips.map((e) => e.line.staffId), ["a", "b", "c"], "payslips cover every run of the month");
assert.equal(slips.find((e) => e.line.staffId === "a")!.run.status, "paid");

// No register in the test month means absent → net 0, which the file skips;
// what matters here is which run(s) the file is drawn from.
const bank = buildBankExportPreview({ masters, month, academicYearCode: ay, modes: ["all"] });
assert.deepEqual(
  bank.runs.map((r) => r.id),
  [rest.run.id],
  "the bank file carries the posted run waiting to be paid — not the person already paid",
);
ok(markPayrollPaid(rest.run.id, "t", "2026-10-13"));
const reprint = buildBankExportPreview({ masters, month, academicYearCode: ay, modes: ["all"] });
assert.deepEqual(
  reprint.runs.map((r) => r.id).sort(),
  [first.run.id, rest.run.id].sort(),
  "once everyone is paid, the whole month can be downloaded again",
);

console.log("  ok");
