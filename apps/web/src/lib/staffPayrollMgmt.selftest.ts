/**
 * Run: npx tsx src/lib/staffPayrollMgmt.selftest.ts
 *
 * The staff app's management pay views (20 Oct 2026, mr_mva1bgmhdfu3 and
 * mr_mva1j71v1ttn) — read only, and they must say what the web says:
 *  1. advances: each person's due equals the web Advances screen's figure
 *     (advanceSummary / outstandingForStaff, read from the same register);
 *     taken and recovered are the plain sums; only people with an advance;
 *  2. payslips: each month's gross / deductions / net / payable equal the
 *     web's month pick (monthPayslipLines); a payment's day follows the
 *     book (line's own day, else the run's when no line has one); a month
 *     with no run is "not run" (null figures, never 0), a draft is
 *     "preparing", a future month is not listed;
 *  3. gates: a teacher, the office by default, and a principal whose saved
 *     mobile map lacks the switch get 403; a principal with defaults passes.
 */
import assert from "node:assert/strict";
import { installServerOnlyStub } from "./fakePostgrest.testkit";

installServerOnlyStub();
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

let passed = 0;
const ok = (name: string) => {
  passed++;
  console.log(`  ok  ${name}`);
};

void (async () => {
  const { advanceTotalsByStaff } = await import("./staffAdvanceTotals");
  const { writeAdvancesLocalRaw, advanceSummary, outstandingForStaff, loadAdvances } = await import("./staffAdvance");
  const { monthPayslipLines } = await import("./payroll");
  const { buildStaffPayrollOverview, sessionMonths, sessionOfMonth } = await import("./staffPayrollOverview");

  /* ── 1. Advances ──────────────────────────────────────────────────── */
  const rec = (amount: number, extra: Record<string, unknown> = {}) => ({
    method: "salary",
    month: "2026-08",
    amount,
    recoveredAt: "2026-08-31",
    ...extra,
  });
  const rawAdvances = [
    // A: two advances, one closed, one part-recovered.
    { id: "a1", staffId: "sA", empCode: "E01", fullName: "Asha", amount: 10000, givenDate: "2026-05-02", recoveries: [rec(4000), rec(6000, { month: "2026-09" })] },
    { id: "a2", staffId: "sA", empCode: "E01", fullName: "Asha", amount: 8000, givenDate: "2026-09-10", recoveries: [rec(2500, { method: "return_to_school", month: "", recoveredAt: "2026-09-20" })] },
    // B: over-recovered (a typo) — must NOT cancel B's other balance.
    { id: "b1", staffId: "sB", empCode: "E02", fullName: "Bina", amount: 3000, givenDate: "2026-06-01", recoveries: [rec(3500)] },
    { id: "b2", staffId: "sB", empCode: "E02", fullName: "Bina", amount: 5000, givenDate: "2026-07-01", recoveries: [] },
    // C: fully recovered — still listed (has an advance), due 0.
    { id: "c1", staffId: "sC", empCode: "E03", fullName: "Chetan", amount: 2000, givenDate: "2026-04-15", recoveries: [rec(2000)] },
    // Junk the register can hold: string amounts, negative recovery.
    { id: "d1", staffId: "sD", empCode: "E04", fullName: "Dev", amount: "1500", givenDate: "2026-10-01T09:00:00Z", recoveries: [rec(-200)] },
  ];
  writeAdvancesLocalRaw({ version: 1, advances: rawAdvances as never });
  const web = advanceSummary(null);
  const totals = advanceTotalsByStaff(rawAdvances);
  assert.deepEqual(totals.map((t) => t.staffId).sort(), ["sA", "sB", "sC", "sD"]);
  for (const t of totals) {
    assert.equal(t.due, outstandingForStaff(t.staffId), `due for ${t.staffId} = web outstandingForStaff`);
    const webRow = web.byStaff.find((r) => r.staffId === t.staffId);
    assert.equal(t.due, webRow?.outstanding ?? 0, `due for ${t.staffId} = web advanceSummary`);
    assert.equal(t.openCount, webRow?.openCount ?? 0, `open count for ${t.staffId}`);
    // Taken / recovered over the web's own normalized rows.
    const mine = loadAdvances().advances.filter((a) => a.staffId === t.staffId);
    assert.equal(t.taken, mine.reduce((n, a) => n + a.amount, 0));
    assert.equal(t.recovered, mine.reduce((n, a) => n + a.recoveries.reduce((m, r) => m + r.amount, 0), 0));
  }
  assert.equal(totals.reduce((n, t) => n + t.due, 0), web.outstandingTotal);
  const by = (id: string) => totals.find((t) => t.staffId === id)!;
  assert.deepEqual([by("sA").taken, by("sA").recovered, by("sA").due], [18000, 12500, 5500]);
  assert.deepEqual([by("sB").taken, by("sB").recovered, by("sB").due], [8000, 3500, 5000]);
  assert.equal(by("sC").due, 0);
  assert.deepEqual([by("sD").taken, by("sD").recovered, by("sD").due], [1500, 0, 1500]);
  assert.equal(by("sA").advances[0]!.id, "a2", "newest advance first");
  assert.equal(totals[0]!.staffId, "sA", "most due first");
  ok("advances: per-staff due equals the web Advances screen; taken / recovered are the register's sums");

  /* ── 2. Payslips ──────────────────────────────────────────────────── */
  assert.deepEqual(sessionMonths("2026-27").slice(0, 2), ["2026-04", "2026-05"]);
  assert.equal(sessionMonths("2026-27")[11], "2027-03");
  assert.equal(sessionOfMonth("2027-02"), "2026-27");
  assert.equal(sessionOfMonth("2026-04"), "2026-27");
  assert.equal(sessionOfMonth("2026-03"), "2025-26");

  const AY = "2026-27";
  const line = (staffId: string, net: number, extra: Record<string, unknown> = {}) => ({
    staffId,
    empCode: staffId.toUpperCase(),
    fullName: `Name ${staffId}`,
    gross: net + 1000,
    totalDeductions: 1000,
    netPay: net,
    amountPayable: net,
    paymentMode: "upi",
    juneHold: false,
    eligibleForJuneDraw: false,
    holdNote: "",
    ...extra,
  });
  const run = (id: string, month: string, status: string, lines: unknown[], paidAt = "") =>
    ({ id, month, academicYearCode: AY, status, lines, paidAt }) as never;
  const runs = [
    // April: one paid run, no line dated → the run's paid day (IST).
    run("r_apr", "2026-04", "paid", [line("s1", 20000), line("s2", 15000)], "2026-05-06T20:00:00.000Z"),
    // May: staggered — s1 in a run paid day by day (s1 dated), s2 in a
    // posted run, not yet paid; s2 also on a stale draft.
    run("r_may_a", "2026-05", "paid", [line("s1", 21000, { paidOn: "2026-06-03" }), line("s3", 9000)], "2026-06-05T06:00:00.000Z"),
    run("r_may_b", "2026-05", "posted", [line("s2", 15500)]),
    run("r_may_d", "2026-05", "draft", [line("s2", 99999)]),
    // June: s1 on June hold (net shown, nothing payable).
    run("r_jun", "2026-06", "approved", [line("s1", 20000, { juneHold: true, amountPayable: 0, holdNote: "June hold" })]),
    // July: only a draft for s1 → preparing.
    run("r_jul", "2026-07", "draft", [line("s1", 20000)]),
    // November (future for a 20 Oct "today") — must not show.
    run("r_nov", "2026-11", "approved", [line("s1", 20000)]),
    // Previous session — must not leak in.
    run("r_mar", "2026-03", "paid", [line("s1", 18000)], "2026-04-02T06:00:00.000Z"),
  ];
  const roster = [
    { id: "s1", empCode: "S1", fullName: "Name s1", status: "active" },
    { id: "s2", empCode: "S2", fullName: "Name s2", status: "active" },
    { id: "s4", empCode: "S4", fullName: "Never paid", status: "active" },
    { id: "s9", empCode: "S9", fullName: "Left, never paid", status: "inactive" },
  ];
  const rows = buildStaffPayrollOverview({ runs: runs as never, roster, session: AY, todayYm: "2026-10" });
  const row = (id: string) => rows.find((r) => r.staffId === id);
  assert.ok(row("s3"), "a person paid this session but not on the roster is listed");
  assert.equal(row("s3")!.active, false);
  assert.ok(!row("s9"), "a left member never paid this session is not listed");
  assert.ok(row("s4"), "an active member with no run is listed");
  assert.deepEqual(row("s1")!.months.map((m) => m.month), ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);

  // Every committed figure equals the web's month pick.
  for (const r of rows) {
    for (const m of r.months) {
      const webLine = monthPayslipLines(runs as never, m.month, AY).find((x) => x.line.staffId === r.staffId);
      if (!webLine) {
        assert.equal(m.netPay, null, `${r.staffId} ${m.month}: no web line → unknown, not 0`);
        assert.ok(m.state === "not_run" || m.state === "preparing");
        continue;
      }
      assert.equal(m.gross, webLine.line.gross);
      assert.equal(m.totalDeductions, webLine.line.totalDeductions);
      assert.equal(m.netPay, webLine.line.netPay);
      assert.equal(m.payable, webLine.line.amountPayable);
      assert.equal(m.state, webLine.run.status);
    }
  }
  const s1 = row("s1")!;
  const mon = (r: typeof s1, ym: string) => r.months.find((m) => m.month === ym)!;
  assert.equal(mon(s1, "2026-04").parts[0]!.paidOn, "2026-05-07", "undated run → run's paid day in IST");
  assert.equal(mon(s1, "2026-04").unpaid, 0);
  assert.equal(mon(s1, "2026-05").parts[0]!.paidOn, "2026-06-03", "the line's own paid day");
  assert.equal(mon(row("s3")!, "2026-05").paid, 0, "a run with dated lines: an undated line is not paid");
  assert.equal(mon(row("s3")!, "2026-05").unpaid, 9000);
  assert.equal(mon(row("s2")!, "2026-05").state, "posted");
  assert.equal(mon(row("s2")!, "2026-05").netPay, 15500, "the draft does not override the posted line");
  assert.equal(mon(row("s2")!, "2026-05").unpaid, 15500);
  assert.equal(mon(s1, "2026-06").onHold, true);
  assert.deepEqual([mon(s1, "2026-06").netPay, mon(s1, "2026-06").payable, mon(s1, "2026-06").unpaid], [20000, 0, 0]);
  assert.equal(mon(s1, "2026-07").state, "preparing");
  assert.equal(mon(s1, "2026-07").netPay, null);
  assert.equal(mon(s1, "2026-08").state, "not_run");
  assert.equal(mon(s1, "2026-08").paid, null, "not run is unknown, never 0");
  assert.equal(s1.monthsRun, 3);
  assert.equal(s1.paidTotal, 20000 + 21000);
  assert.equal(row("s4")!.months.every((m) => m.state === "not_run"), true);
  // Past session: all twelve months.
  const past = buildStaffPayrollOverview({ runs: runs as never, roster, session: "2025-26", todayYm: "2026-10" });
  assert.equal(past.find((r) => r.staffId === "s1")!.months.length, 12);
  assert.equal(past.find((r) => r.staffId === "s1")!.months[11]!.netPay, 18000);
  ok("payslips: month figures equal the web's month pick; paid days follow the book; not run ≠ 0");

  /* ── 3. Gates ─────────────────────────────────────────────────────── */
  const { defaultMasters } = await import("./masters");
  const { defaultRbacState } = await import("./rbac");
  const { defaultMobileAccess, setRoleMobileFeatures } = await import("./mobileFeatures");
  const gate = await import("./api/v1/staffPayrollMgmtGate");
  const masters = defaultMasters();
  const rbac = defaultRbacState();
  const ctxFor = (roleCode: string, r = rbac) => ({
    session: { persona: "staff" as const, fullName: "X", roleCode, staffId: `st_${roleCode}`, tenantSlug: "t", academicYearCode: AY },
    masters,
    rbac: r,
    rbacKnown: true,
    authKind: "session" as const,
  });
  const status = (fn: () => void): number => {
    try {
      fn();
      return 200;
    } catch (e) {
      return Number((e as { status?: number }).status) || 500;
    }
  };
  for (const role of ["teacher", "driver", "gate", "office", "accounts"]) {
    assert.equal(status(() => gate.assertStaffPayrollOverviewAccess(ctxFor(role) as never)), 403, `${role}: payslips 403`);
    assert.equal(status(() => gate.assertStaffAdvancesOverviewAccess(ctxFor(role) as never)), 403, `${role}: advances 403`);
  }
  assert.equal(status(() => gate.assertStaffPayrollOverviewAccess(ctxFor("principal") as never)), 200);
  assert.equal(status(() => gate.assertStaffAdvancesOverviewAccess(ctxFor("principal") as never)), 200);
  // A parent session never passes.
  const parentCtx = { ...ctxFor("principal"), session: { ...ctxFor("principal").session, persona: "parent" as const } };
  assert.equal(status(() => gate.assertStaffPayrollOverviewAccess(parentCtx as never)), 403);
  // A principal whose saved map predates the switch: refused until the office turns it on.
  const base = defaultMobileAccess();
  const saved = setRoleMobileFeatures(base, "principal", base.roleFeatures.principal!.filter((f) => f !== "staff_payslips_all" && f !== "staff_advances_all"));
  const rbacSaved = { ...rbac, mobile: saved };
  assert.equal(status(() => gate.assertStaffPayrollOverviewAccess(ctxFor("principal", rbacSaved as never) as never)), 403);
  assert.equal(status(() => gate.assertStaffAdvancesOverviewAccess(ctxFor("principal", rbacSaved as never) as never)), 403);
  ok("gates: non-management staff and parents get 403; a principal with the switch passes");

  console.log(`\nstaffPayrollMgmt: ${passed} passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
