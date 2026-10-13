/**
 * Self-test: payroll follows Masters → Salary setup and the joining date
 * (director, 14 Oct 2026). Run: npx tsx src/lib/payrollSetupSync.selftest.ts
 *
 * The July 2026 draft (built 19 Aug) put four staff with no setup link on
 * PF + ESIC, paid two people who joined on 22 Jul a full month, and paid
 * one who joined on 1 Aug for July at all.
 */
import assert from "node:assert/strict";

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

import type { StaffRecord } from "./foundationMasters";
import { defaultMasters, type MastersState } from "./masters";
import {
  applyDraftSetupSync,
  buildPayrollDraft,
  loadPayroll,
  previewDraftSetupSync,
  runSetupWarnings,
  writePayrollLocalRaw,
  type PayrollRun,
} from "./payroll";
import {
  NO_SETUP_NOTE,
  payrollEmploymentStart,
  setupDiffReasons,
  setupSyncTotals,
  statutoryCoverFor,
} from "./payrollSetupSync";
import { defaultSalarySetupState, writeSalarySetupLocalRaw, type StaffSalaryLink } from "./salarySetup";
import { emptyStaffAttendanceState, writeStaffAttendanceLocalRaw } from "./staffAttendance";
import { emptyStaffHrState, writeStaffHrLocalRaw } from "./staffHr";

console.log("payrollSetupSync.selftest.ts");

/* ── 1. cover: no setup is never PF + ESIC ─────────────────────────── */
assert.deepEqual(statutoryCoverFor(undefined), { cover: "none", noSetup: true });
assert.deepEqual(statutoryCoverFor(null), { cover: "none", noSetup: true });
assert.deepEqual(statutoryCoverFor({ statutoryCover: "both" }), { cover: "both", noSetup: false });
assert.deepEqual(statutoryCoverFor({ statutoryCover: "pf_only" }), { cover: "pf_only", noSetup: false });
assert.deepEqual(statutoryCoverFor({ statutoryCover: "garbage" }), { cover: "none", noSetup: false });

/* ── 2. employment start ─────────────────────────────────────────────── */
assert.deepEqual(payrollEmploymentStart("2026-07", "2026-07-22", "2026-07-22"), { from: "2026-07-22", excluded: false, joinedInMonth: true });
assert.deepEqual(payrollEmploymentStart("2026-07", "2026-08-01", "2026-08-01"), { from: "2026-08-01", excluded: true, joinedInMonth: false });
assert.deepEqual(payrollEmploymentStart("2026-07", "2019-04-01", "2026-09-01"), { from: "2026-07-01", excluded: false, joinedInMonth: false }, "an increment's later effectiveFrom never drops a long-serving person");
assert.deepEqual(payrollEmploymentStart("2026-07", "", "2026-07-10"), { from: "2026-07-10", excluded: false, joinedInMonth: true }, "no joining date: the setup's date");
assert.deepEqual(payrollEmploymentStart("2026-07", "", ""), { from: "2026-07-01", excluded: false, joinedInMonth: false });
assert.equal(payrollEmploymentStart("2026-02", "2026-02-28").excluded, false);
assert.equal(payrollEmploymentStart("2026-02", "2026-03-01").excluded, true);

/* ── 3. drafts follow setup and joining dates ──────────────────────── */
const staff = (id: string, joiningDate: string) =>
  ({
    id, empCode: id.toUpperCase(), fullName: `Staff ${id}`, status: "active", stream: "non_teaching", category: "permanent",
    designationId: "", classTeacherLinks: [], subjectTeachingLinks: [], joiningDate,
  }) as unknown as StaffRecord;
const masters: MastersState = {
  ...defaultMasters(),
  staff: [staff("old", "2019-04-01"), staff("shreya", "2026-07-22"), staff("sanjay", "2026-08-01"), staff("nolink", "2020-01-01")],
  holidays: [],
};
const salary = defaultSalarySetupState();
assert.ok(salary.structures.some((s) => s.isActive), "the default setup has a structure to resolve");
const link = (staffId: string, cover: StaffSalaryLink["statutoryCover"], eff: string): StaffSalaryLink => ({
  staffId, structureId: "", basicOverride: 13000, statutoryCover: cover, additionalAmount: 0, additionalLabel: "",
  statutoryGrossUp: false, effectiveFrom: eff, salaryAccountNote: "",
});
salary.staffLinks = [link("old", "both", "2026-04-01"), link("shreya", "none", "2026-07-22"), link("sanjay", "none", "2026-08-01")];
writeSalarySetupLocalRaw(salary);
writeStaffAttendanceLocalRaw(emptyStaffAttendanceState());
writeStaffHrLocalRaw(emptyStaffHrState());

const draft = buildPayrollDraft({ masters, salary, month: "2026-07", academicYearCode: "2026-27", createdBy: "t" });
const byId = new Map(draft.lines.map((l) => [l.staffId, l]));
assert.ok(!byId.has("sanjay"), "joined 1 Aug: no July line");
assert.equal(byId.get("nolink")!.statutoryCover, "none", "no setup link: no PF/ESI");
assert.ok(byId.get("nolink")!.note.includes(NO_SETUP_NOTE), "and the line says so");
assert.ok(!byId.get("nolink")!.components.some((c) => /^(PF|ESIC|ESI)_/.test(c.headCode) && c.amount > 0), "no PF/ESI components");
assert.equal(byId.get("old")!.statutoryCover, "both", "the setup's own cover is used");
const shreya = byId.get("shreya")!;
assert.equal(shreya.statutoryCover, "none");
assert.equal(shreya.daysPresent, 0, "no register → never assumed present");
assert.ok(shreya.daysLwp >= 21, `21 days before joining are not paid (daysLwp ${shreya.daysLwp})`);
assert.match(shreya.note, /Joined 2026-07-22: LWP includes 21 day\(s\) before joining/);
assert.match(shreya.note, /No attendance marked on \d+ working day\(s\) — counted absent/);
const lwp = shreya.components.find((c) => c.headCode === "LWP");
assert.ok(lwp && lwp.amount === shreya.lwpDeduction, "before-joining days are loss of pay (the book reduces salary expense)");

/* ── 4. a stale draft: preview, then rebuild keeping the line's own edits ── */
const stale = (l: (typeof draft.lines)[number]) => ({
  ...l,
  statutoryCover: "both",
  gross: 15000,
  netPay: 13087,
  totalDeductions: 1913,
  employerCost: 2288,
  daysPresent: 27,
  daysAbsent: 0,
  daysLwp: 0,
  bonus: 500,
  specialDeduction: 200,
  specialDeductionLabel: "uniform",
  paymentDate: "2026-08-05",
  paymentMode: "cash" as const,
  note: "Paid with arrears",
});
const run: PayrollRun = {
  ...draft,
  id: "pr_july",
  lines: [
    stale(shreya),
    { ...stale(shreya), staffId: "sanjay", empCode: "SANJAY", fullName: "Staff sanjay" },
    byId.get("old")!,
  ],
};
writePayrollLocalRaw({ version: 2, runs: [run], audit: [] });
const { rows } = previewDraftSetupSync(run, masters, salary);
const row = (id: string) => rows.find((r) => r.staffId === id)!;
assert.equal(row("old").action, "none", "a line in step is not flagged");
assert.equal(row("sanjay").action, "remove");
assert.match(row("sanjay").reasons[0]!, /Joined 2026-08-01 — after 2026-07/);
assert.equal(row("shreya").action, "rebuild");
assert.ok(row("shreya").reasons.some((r) => /PF\/ESI cover both → none/.test(r)), row("shreya").reasons.join("; "));
assert.ok(row("shreya").reasons.some((r) => /^Days /.test(r)), "days basis compared, not only cover");
assert.ok(row("shreya").after!.netPay < 13087, "a month's pay for ten days is not kept");
assert.equal(runSetupWarnings(run, masters).length, 2, "submit / approve / publish ask about both");
const totals = setupSyncTotals(rows.filter((r) => r.action !== "none"), rows.map((r) => r.before));
assert.equal(totals.before.net - totals.after.net, 13087 - row("shreya").after!.netPay + 13087);

const applied = applyDraftSetupSync("pr_july", ["shreya", "sanjay"], masters, "t");
assert.ok(applied.ok && applied.rebuilt === 1 && applied.removed === 1);
const after = loadPayroll().runs[0]!;
assert.deepEqual(after.lines.map((l) => l.staffId).sort(), ["old", "shreya"]);
const s2 = after.lines.find((l) => l.staffId === "shreya")!;
assert.equal(s2.statutoryCover, "none");
assert.equal(s2.bonus, 500, "bonus kept");
assert.equal(s2.specialDeduction, 200, "special deduction kept");
assert.equal(s2.paymentDate, "2026-08-05");
assert.equal(s2.paymentMode, "cash");
assert.match(s2.note, /Paid with arrears/, "the office's own note kept");
assert.match(s2.note, /Joined 2026-07-22/, "with the builder's note");
assert.equal(after.lockVersion, (run.lockVersion || 0) + 1);
const audit = loadPayroll().audit.map((a) => a.detail);
assert.ok(audit.some((d) => /Staff shreya: rebuilt from salary setup/.test(d)));
assert.ok(audit.some((d) => /Staff sanjay: removed — Joined 2026-08-01/.test(d)));
// In step now; never on a run that is not a draft.
assert.equal(previewDraftSetupSync(after, masters, salary).rows.filter((r) => r.action !== "none").length, 0);
writePayrollLocalRaw({ version: 2, runs: [{ ...run, status: "approved" }], audit: [] });
const lockedTry = applyDraftSetupSync("pr_july", ["shreya"], masters, "t");
assert.ok(!lockedTry.ok && /recall to draft/.test(lockedTry.error));

/* ── 4b. someone employed all month keeps the draft's attendance ──── */
// Registers can be incomplete (July 2026: most staff on 7 of 26 registers);
// a setup rebuild must not turn that into loss of pay.
const oldFresh = byId.get("old")!;
const oldDraft = {
  ...oldFresh,
  daysPresent: 27, daysAbsent: 0, daysLwp: 0, daysHoliday: 4, lwpDeduction: 0,
  components: oldFresh.components.filter((c) => c.headCode !== "LWP"),
};
const ded = oldDraft.components.filter((c) => c.kind === "deduction").reduce((n, c) => n + c.amount, 0);
const oldInStep = { ...oldDraft, totalDeductions: ded, netPay: oldDraft.gross - ded, amountPayable: oldDraft.gross - ded };
const keepRows = previewDraftSetupSync({ ...run, status: "draft", lines: [oldInStep] }, masters, salary).rows;
assert.equal(keepRows[0]!.action, "none", `attendance kept for a whole-month line: ${keepRows[0]!.reasons.join("; ")}`);
const lowered = previewDraftSetupSync({ ...run, status: "draft", lines: [{ ...oldInStep, statutoryCover: "none" }] }, masters, salary).rows[0]!;
assert.equal(lowered.action, "rebuild");
assert.equal(lowered.after!.daysPresent, 27, "rebuilt with the draft's days");

/* ── 5. reasons ─────────────────────────────────────────────────────── */
const f = { gross: 1, totalDeductions: 0, netPay: 1, employerCost: 0, daysPresent: 1, daysAbsent: 0, daysHoliday: 0, daysLwp: 0, statutoryCover: "none", structureId: "s" };
assert.deepEqual(setupDiffReasons(f, f), []);
assert.deepEqual(setupDiffReasons(f, f, { noSetup: true }), ["No salary setup"]);
assert.deepEqual(setupDiffReasons(f, { ...f, structureId: "t" }), ["Salary structure changed"]);
assert.deepEqual(setupDiffReasons(f, null, { excludedReason: "x" }), ["x"]);

console.log("  ok");
