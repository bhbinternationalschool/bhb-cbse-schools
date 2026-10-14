/**
 * Self-test: the payroll "Adjust / pay" table (director, 14 Oct 2026).
 * Run: npx tsx src/lib/payrollAdjustTable.selftest.ts
 *
 * Pins:
 *  1. typed dates — dd → mm → yyyy: nothing half-typed is stored (Chrome
 *     reports 0002 / 0020 / 0202 while the year goes in), a partial entry
 *     never clears the stored date, an emptied box clears it on blur, and
 *     day-first DD/MM/YYYY reads for text-box browsers;
 *  2. typed numbers — "" is 0, unreadable is "go back";
 *  3. the advance note — open advances oldest first and numbered, the
 *     ticked total, the 0…ticked clamp, oldest-ticked-first allocation that
 *     never spills onto an unticked advance;
 *  4. the draft line — ticking fills the deduction, a typed deduction is
 *     held to the ticked balances, ticks survive a rebuild, and a payable
 *     typed by hand survives edits to other lines and to its own note/date;
 *  5. publish books the recovery on the ticked advances only, a re-post
 *     never recovers twice, recall removes it, and a run whose ticked
 *     advances were recovered elsewhere is refused with nothing posted.
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

import { dateDraftCommit, draftNumberValue, monthDraftCommit, numberDraftText, parseTypedDate, parseTypedMonth } from "./draftInput";
import {
  advancePickRows,
  allocateAdvanceRecovery,
  cleanAdvancePicks,
  clampAdvanceDeduct,
  lineAdvancePicks,
  pickedAdvanceTotal,
  type AdvanceLike,
} from "./payrollAdvancePick";
import {
  loadPayroll,
  mergePreservedAdjustments,
  normalizePayrollLine,
  publishPayrollToAccounts,
  recallPayrollToDraft,
  updateDraftLineAdjustments,
  writePayrollLocalRaw,
  type PayrollRun,
} from "./payroll";
import {
  advanceAllocationProblems,
  loadAdvances,
  outstandingByStaff,
  outstandingForStaff,
  syncAdvanceRecoveriesFromPayroll,
  writeAdvancesLocalRaw,
  type StaffAdvance,
} from "./staffAdvance";
import type { MastersState } from "./masters";

console.log("payrollAdjustTable.selftest.ts");

/* ── 1. typed dates ─────────────────────────────────────────────────── */
// Chrome, typing 14 → 10 → 2026 into an empty date box:
const typing: { value: string; badInput: boolean }[] = [
  { value: "", badInput: true }, // 1
  { value: "", badInput: true }, // 14
  { value: "", badInput: true }, // 14/1
  { value: "", badInput: true }, // 14/10
  { value: "0002-10-14", badInput: false }, // 14/10/2
  { value: "0020-10-14", badInput: false }, // 14/10/20
  { value: "0202-10-14", badInput: false }, // 14/10/202
  { value: "2026-10-14", badInput: false }, // 14/10/2026
];
const stored = typing.map((t) => dateDraftCommit(t.value, { badInput: t.badInput, clearNow: true }));
assert.deepEqual(
  stored.map((r) => (r.commit ? r.value : null)),
  [null, null, null, null, null, null, null, "2026-10-14"],
  "only the whole date is stored — no year-2 dates, no clearing mid-typing",
);
assert.deepEqual(dateDraftCommit("", { badInput: true, onBlur: true }), { commit: false }, "half-typed on blur: keep the stored date");
assert.deepEqual(dateDraftCommit("", { badInput: false, onBlur: true }), { commit: true, value: "" }, "emptied on blur: clear");
assert.deepEqual(dateDraftCommit("", { badInput: false }), { commit: false }, "empty while typing is not a clear");
// Month boxes: Chrome reports 0002-10, 0020-10, 0202-10 while the year is
// typed — none is handed up; only the whole month is.
{
  const typing = ["0002-10", "0020-10", "0202-10", "2026-10"].map((v) => monthDraftCommit(v));
  assert.deepEqual(typing, [{ commit: false }, { commit: false }, { commit: false }, { commit: true, value: "2026-10" }], "month: only the whole year commits");
  assert.equal(parseTypedMonth("10/2026"), "2026-10", "MM/YYYY accepted");
  assert.equal(parseTypedMonth("2026-13"), null, "no 13th month");
  assert.deepEqual(monthDraftCommit(""), { commit: false }, "an emptied month box stores nothing");
  assert.deepEqual(monthDraftCommit("2026-10", { badInput: true }), { commit: false }, "half-typed per the browser: nothing");
}
assert.deepEqual(dateDraftCommit("", { badInput: false, clearNow: true }), { commit: true, value: "" }, "the picker's clear button");
// A box that must always hold a day (a register's day, the class sheet's
// "measured on"): emptying it stores nothing, on blur or by the clear button.
assert.deepEqual(dateDraftCommit("", { badInput: false, onBlur: true, allowEmpty: false }), { commit: false }, "required day: emptied on blur keeps the stored day");
assert.deepEqual(dateDraftCommit("", { badInput: false, clearNow: true, allowEmpty: false }), { commit: false }, "required day: the clear button stores nothing");
assert.deepEqual(dateDraftCommit("2026-10-14", { allowEmpty: false }), { commit: true, value: "2026-10-14" }, "required day: a whole date still stores");
assert.deepEqual(
  typing.map((t) => dateDraftCommit(t.value, { badInput: t.badInput, clearNow: true, allowEmpty: false })).map((r) => (r.commit ? r.value : null)),
  [null, null, null, null, null, null, null, "2026-10-14"],
  "required day: typed year — only the whole date",
);
assert.equal(parseTypedDate("14/10/2026"), "2026-10-14", "day-first");
assert.equal(parseTypedDate("4-7-2026"), "2026-07-04");
assert.equal(parseTypedDate("04.07.2026"), "2026-07-04");
assert.equal(parseTypedDate("2026-02-29"), null, "not a leap year");
assert.equal(parseTypedDate("2028-02-29"), "2028-02-29");
assert.equal(parseTypedDate("31/04/2026"), null, "30 days in April");
assert.equal(parseTypedDate("14/10/26"), null, "a two-digit year is not guessed");
assert.equal(parseTypedDate("0002-10-14"), null);
assert.equal(parseTypedDate("garbage"), null);
assert.deepEqual(dateDraftCommit("31/02/2026", { onBlur: true }), { commit: false });

/* ── 2. typed numbers ───────────────────────────────────────────────── */
assert.equal(draftNumberValue(""), 0, "an emptied box is 0");
assert.equal(draftNumberValue(" 1,500 "), 1500);
assert.equal(draftNumberValue("12.5"), 12.5);
assert.equal(draftNumberValue("abc"), null, "unreadable → back to the stored value");
assert.equal(numberDraftText(0), "0");
assert.equal(numberDraftText(Number.NaN), "");

/* ── 3. the advance note (pure) ─────────────────────────────────────── */
const adv = (id: string, staffId: string, amount: number, givenDate: string, recovered: { amount: number; method?: string; payrollRunId?: string }[] = [], createdAt = ""): AdvanceLike => ({
  id, staffId, amount, givenDate, createdAt, recoveries: recovered,
});
const pure = [
  adv("a3", "s1", 3000, "2026-09-01"),
  adv("a1", "s1", 5000, "2026-06-10", [{ amount: 1000, method: "return_to_school" }]),
  adv("a2", "s1", 2000, "2026-06-10", [], "2026-06-11T00:00:00Z"),
  adv("a0", "s1", 4000, "2026-05-01", [{ amount: 4000, method: "salary", payrollRunId: "pr_old" }]),
  adv("b1", "s2", 9000, "2026-01-01"),
  adv("a4", "s1", 1000, "2026-08-01", [{ amount: 1000, method: "salary", payrollRunId: "pr_me" }]),
];
const rows = advancePickRows(pure, "s1");
assert.deepEqual(
  rows.map((r) => [r.serial, r.advanceId, r.amount, r.recovered, r.balance]),
  [
    [1, "a1", 5000, 1000, 4000],
    [2, "a2", 2000, 0, 2000],
    [3, "a3", 3000, 0, 3000],
  ],
  "open only, oldest first (same day: entered first), numbered; closed a0 and a4 left out",
);
assert.deepEqual(
  advancePickRows(pure, "s1", { excludeRunId: "pr_me" }).map((r) => r.advanceId),
  ["a1", "a2", "a4", "a3"],
  "a run reads its own salary recovery as not yet made",
);
assert.deepEqual(cleanAdvancePicks(rows, ["a3", "zz", "a1", "a1", "b1"]), ["a1", "a3"], "own open advances, oldest first, once");
assert.equal(pickedAdvanceTotal(rows, ["a1", "a3"]), 7000);
assert.deepEqual(clampAdvanceDeduct(9000, 7000), { value: 7000, clamped: true }, "never more than the ticked total");
assert.deepEqual(clampAdvanceDeduct(2500, 7000), { value: 2500, clamped: false });
assert.deepEqual(clampAdvanceDeduct(-5, 7000), { value: 0, clamped: true });
assert.deepEqual(clampAdvanceDeduct(0, 7000), { value: 0, clamped: false });
assert.deepEqual(
  allocateAdvanceRecovery(rows, ["a3", "a1"], 5000),
  { allocations: [{ advanceId: "a1", amount: 4000 }, { advanceId: "a3", amount: 1000 }], shortfall: 0 },
  "oldest ticked first; a2 (not ticked) untouched",
);
assert.deepEqual(
  allocateAdvanceRecovery(rows, ["a2"], 2500),
  { allocations: [{ advanceId: "a2", amount: 2000 }], shortfall: 500 },
  "what the ticked advances cannot take is a shortfall, not moved elsewhere",
);
assert.deepEqual(lineAdvancePicks([{ headCode: "BASIC" }, { headCode: "ADVANCE", advanceIds: ["a1", ""] }]), ["a1"]);
assert.deepEqual(lineAdvancePicks(undefined), []);

/* ── 4. the draft line ──────────────────────────────────────────────── */
const fullAdv = (id: string, staffId: string, amount: number, givenDate: string): StaffAdvance => ({
  id, staffId, empCode: staffId.toUpperCase(), fullName: `Staff ${staffId}`, amount, givenDate,
  paymentMode: "cash", note: "", source: "cash", payrollRunId: "", status: "open",
  createdBy: "t", createdAt: `${givenDate}T09:00:00Z`, recoveries: [],
});
writeAdvancesLocalRaw({
  version: 1,
  advances: [
    fullAdv("adv_new", "s1", 3000, "2026-09-01"),
    fullAdv("adv_old", "s1", 5000, "2026-06-10"),
    fullAdv("adv_mid", "s1", 2000, "2026-07-15"),
    fullAdv("adv_s2", "s2", 1000, "2026-08-01"),
  ],
});
assert.equal(outstandingForStaff("s1"), 10000);
assert.deepEqual([...outstandingByStaff()].sort(), [["s1", 10000], ["s2", 1000]], "one read, every person");

const baseLine = (id: string, gross: number) =>
  normalizePayrollLine({
    staffId: id, empCode: id.toUpperCase(), fullName: `Staff ${id}`, gross, netPay: gross, amountPayable: gross,
    components: [{ headId: "basic", headCode: "BASIC", headName: "Basic", kind: "earning", amount: gross }],
  });
const draft: PayrollRun = {
  id: "pr_adj", academicYearCode: "2026-27", month: "2026-09", dayCount: 30, kind: "bulk", status: "draft",
  lines: [baseLine("s1", 20000), baseLine("s2", 15000)],
  createdBy: "t", createdAt: "", submittedBy: "", submittedAt: "", approvedBy: "", approvedAt: "",
  postedBy: "", postedAt: "", paidBy: "", paidAt: "", remark: "", submissionNote: "",
  rejectionNote: "", rejectedBy: "", rejectedAt: "", lockVersion: 1,
};
writePayrollLocalRaw({ version: 2, runs: [draft], audit: [] });
const lineOf = (staffId: string) => loadPayroll().runs.find((r) => r.id === "pr_adj")!.lines.find((l) => l.staffId === staffId)!;

// A payable typed by hand on s2…
assert.ok(updateDraftLineAdjustments("pr_adj", "s2", { amountPayable: 12000 }, "t").ok);
assert.equal(lineOf("s2").amountPayable, 12000);

// Ticking fills the deduction with the ticked balances.
const r = updateDraftLineAdjustments("pr_adj", "s1", { advancePicks: ["adv_new", "adv_old"] }, "t");
assert.ok(r.ok);
let s1 = lineOf("s1");
assert.equal(s1.advanceDeduct, 8000, "5,000 + 3,000");
assert.deepEqual(lineAdvancePicks(s1.components), ["adv_old", "adv_new"], "stored oldest first on the Advance recovery head");
assert.equal(s1.netPay, 12000);
assert.equal(lineOf("s2").amountPayable, 12000, "…survives an edit to another line");

// Typed lower: allowed. Typed higher: held to the ticked total.
assert.ok(updateDraftLineAdjustments("pr_adj", "s1", { advanceDeduct: 6000 }, "t").ok);
assert.equal(lineOf("s1").advanceDeduct, 6000);
assert.deepEqual(lineAdvancePicks(lineOf("s1").components), ["adv_old", "adv_new"], "ticks kept when the amount is typed");
assert.ok(updateDraftLineAdjustments("pr_adj", "s1", { advanceDeduct: 9500 }, "t").ok);
assert.equal(lineOf("s1").advanceDeduct, 8000, "never above the ticked advances (outstanding is 10,000)");

// A note or date edit does not move a hand-typed payable on the same line.
assert.ok(updateDraftLineAdjustments("pr_adj", "s2", { note: "paid in two parts", paymentDate: "2026-10-05" }, "t").ok);
assert.equal(lineOf("s2").amountPayable, 12000);
assert.equal(lineOf("s2").paymentDate, "2026-10-05");

// Untick everything: the deduction follows (0) and the head goes.
assert.ok(updateDraftLineAdjustments("pr_adj", "s1", { advancePicks: [] }, "t").ok);
assert.equal(lineOf("s1").advanceDeduct, 0);
assert.equal(lineOf("s1").components.some((c) => c.headCode === "ADVANCE"), false);
// No ticks: the old rule — up to the whole outstanding.
assert.ok(updateDraftLineAdjustments("pr_adj", "s1", { advanceDeduct: 99999 }, "t").ok);
assert.equal(lineOf("s1").advanceDeduct, 10000);

// Tick the old one only, deduct part of it — partial recovery.
assert.ok(updateDraftLineAdjustments("pr_adj", "s1", { advancePicks: ["adv_mid", "adv_new"], advanceDeduct: 4000 }, "t").ok);
s1 = lineOf("s1");
assert.equal(s1.advanceDeduct, 4000);
assert.deepEqual(lineAdvancePicks(s1.components), ["adv_mid", "adv_new"]);

// A rebuild from salary setup keeps the ticks and the amount.
const rebuilt = mergePreservedAdjustments(baseLine("s1", 20000), s1);
assert.equal(rebuilt.advanceDeduct, 4000);
assert.deepEqual(lineAdvancePicks(rebuilt.components), ["adv_mid", "adv_new"]);

/* ── 5. publish, re-post, recall, refusal ───────────────────────────── */
const masters = { staff: [] } as unknown as MastersState;
const approve = () => {
  const st = loadPayroll();
  writePayrollLocalRaw({ ...st, runs: st.runs.map((x) => (x.id === "pr_adj" ? { ...x, status: "approved" as const } : x)) });
};
approve();
const pub = publishPayrollToAccounts("pr_adj", "t");
assert.ok(pub.ok, pub.ok ? "" : pub.error);
const recOf = (id: string) => loadAdvances().advances.find((a) => a.id === id)!.recoveries.filter((x) => x.payrollRunId === "pr_adj");
assert.deepEqual(recOf("adv_mid").map((x) => x.amount), [2000], "oldest ticked first (2,000 of the 4,000)");
assert.deepEqual(recOf("adv_new").map((x) => x.amount), [2000], "the rest on the next ticked advance");
assert.deepEqual(recOf("adv_old"), [], "the unticked (older!) advance is not touched");
assert.equal(outstandingForStaff("s1"), 6000);

// A re-sync of the same run replaces its recoveries — never twice.
syncAdvanceRecoveriesFromPayroll({ run: loadPayroll().runs.find((x) => x.id === "pr_adj")!, by: "t", masters });
assert.deepEqual(recOf("adv_mid").map((x) => x.amount), [2000]);
assert.deepEqual(recOf("adv_new").map((x) => x.amount), [2000]);
assert.equal(outstandingForStaff("s1"), 6000);
assert.deepEqual(advanceAllocationProblems(loadPayroll().runs.find((x) => x.id === "pr_adj")!), [], "its own recovery is not a shortfall");

// Recall to draft takes the recovery back off the advances.
const rec = recallPayrollToDraft("pr_adj", "t");
assert.ok(rec.ok);
assert.deepEqual(recOf("adv_mid"), []);
assert.deepEqual(recOf("adv_new"), []);
assert.equal(outstandingForStaff("s1"), 10000);

// Meanwhile adv_mid is recovered elsewhere (another month's run) — the
// ticked advances now owe 3,000 against a 4,000 deduction: refused.
const st = loadAdvances();
writeAdvancesLocalRaw({
  ...st,
  advances: st.advances.map((a) =>
    a.id === "adv_mid"
      ? { ...a, recoveries: [{ id: "ar_x", advanceId: a.id, method: "salary", payrollRunId: "pr_other", month: "2026-08", amount: 2000, recoveredAt: "", recoveredBy: "t", note: "", returnMode: "" }] }
      : a,
  ),
});
approve();
const refused = publishPayrollToAccounts("pr_adj", "t");
assert.ok(!refused.ok && /Staff s1: the ticked advances now have only ₹3,000 left to recover against a deduction of ₹4,000/.test(refused.error), refused.ok ? "published" : refused.error);
assert.equal(loadPayroll().runs.find((x) => x.id === "pr_adj")!.status, "approved", "nothing posted");
assert.deepEqual(recOf("adv_new"), [], "no recovery booked");

console.log("payrollAdjustTable.selftest.ts: all passed");
