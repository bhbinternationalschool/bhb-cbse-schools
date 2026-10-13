import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cancelledPairKeys,
  dropCancelledVouchers,
  hideCancelledLines,
  statementTies,
  type StatementLineLike,
} from "./cancelledPairs";
import { firstLiveVoucher, lastEntriesByKind, pickLastEntries, type HandVoucher } from "./lastEntries";
import {
  DAY_SHEET_MAX_DAYS,
  buildDaySheet,
  daySheetRange,
  parseReversalNarration,
  pickedDays,
  sideForDay,
  toggleAllDays,
} from "./daySheet";
import { isOpenKey, statementDrillTarget } from "./drillDown";

console.log("lastEntryCancelledPairs.selftest.ts");

/**
 * 13 Oct 2026, two asks from the director:
 *  - the voucher and advance forms say how far entries have got ("Entered up
 *    to"), counting live entries only;
 *  - Book reports → Account statement stops listing the clean-up's 365
 *    reversed vouchers and their reversals (Salary & Wages: 422 of 451 lines)
 *    without moving the opening or closing balance.
 */

// ── Pairs ──────────────────────────────────────────────────────────────────
{
  const links = [
    { id: "o1", voucherNo: "PV/1", reversesVoucherId: "" },
    { id: "r1", voucherNo: "RV/1", reversesVoucherId: "o1" },
    { id: "o2", voucherNo: "PV/2", reversesVoucherId: "" },
    // Reverses a voucher outside the rows at hand — not a pair here.
    { id: "r9", voucherNo: "RV/9", reversesVoucherId: "o-elsewhere" },
  ];
  const keys = cancelledPairKeys(links);
  assert.equal(keys.get("PV/1"), "o1");
  assert.equal(keys.get("RV/1"), "o1");
  assert.equal(keys.has("PV/2"), false, "a live voucher is not cancelled");
  assert.equal(keys.has("RV/9"), false, "half a pair stays visible");
}

// ── Statement: hide pairs, keep opening/closing, recompute running ────────
{
  // An expense account (debit-normal), opening 1,000.
  const opening = 1000;
  const raw: Omit<StatementLineLike, "runningPaise">[] = [
    { voucherNo: "PV/1", debitPaise: 500, creditPaise: 0, cancelledPair: "o1" },
    { voucherNo: "PV/2", debitPaise: 200, creditPaise: 0, cancelledPair: "" },
    { voucherNo: "RV/1", debitPaise: 0, creditPaise: 500, cancelledPair: "o1" },
    { voucherNo: "PV/3", debitPaise: 300, creditPaise: 0, cancelledPair: "" },
    // A malformed "pair" that does not net to zero on this account stays.
    { voucherNo: "PV/4", debitPaise: 100, creditPaise: 0, cancelledPair: "o4" },
    { voucherNo: "RV/4", debitPaise: 0, creditPaise: 40, cancelledPair: "o4" },
  ];
  let run = opening;
  const rows = raw.map((r) => {
    run += r.debitPaise - r.creditPaise;
    return { ...r, runningPaise: run };
  });
  const closing = run;

  assert.ok(statementTies({ openingPaise: opening, closingPaise: closing, rows, debitNormal: true }));
  assert.equal(
    statementTies({ openingPaise: opening, closingPaise: closing, rows: rows.slice(1), debitNormal: true }),
    false,
    "a missing line is caught, not shown",
  );

  // An account with a balance and no movement in the period: the opening and
  // closing are the book's (₹30.48 lakh), not ₹0 read off a first line.
  const idle = hideCancelledLines([], { openingPaise: 3_048_000_00, debitNormal: true });
  assert.equal(idle.closingPaise, 3_048_000_00);
  assert.equal(idle.rows.length, 0);
  assert.ok(statementTies({ openingPaise: 3_048_000_00, closingPaise: 3_048_000_00, rows: [], debitNormal: true }));

  const shown = hideCancelledLines(rows, { openingPaise: opening, debitNormal: true });
  assert.equal(shown.hiddenCount, 2, "both halves of the pair hidden");
  assert.deepEqual(
    shown.rows.map((r) => r.voucherNo),
    ["PV/2", "PV/3", "PV/4", "RV/4"],
  );
  assert.deepEqual(
    shown.rows.map((r) => r.runningPaise),
    [1200, 1500, 1600, 1560],
    "running recomputed over shown lines",
  );
  assert.equal(shown.closingPaise, closing, "closing unchanged by hiding");
  assert.equal(shown.rows.at(-1)!.runningPaise, closing);
  // The input is not mutated — unticking the box shows the book's figures.
  assert.equal(rows[1]!.runningPaise, 1700);

  // Credit-normal account (Cash would be debit-normal; a liability is not).
  const liab = [
    { voucherNo: "JV/1", debitPaise: 0, creditPaise: 900, runningPaise: 900, cancelledPair: "x" },
    { voucherNo: "RV/x", debitPaise: 900, creditPaise: 0, runningPaise: 0, cancelledPair: "x" },
  ];
  assert.ok(statementTies({ openingPaise: 0, closingPaise: 0, rows: liab, debitNormal: false }));
  const l = hideCancelledLines(liab, { openingPaise: 0, debitNormal: false });
  assert.equal(l.rows.length, 0);
  assert.equal(l.closingPaise, 0);
}

// ── Receipts & Payments drops both halves, nothing else ───────────────────
{
  const movements = [
    { voucherId: "o1", cash: -500 },
    { voucherId: "r1", cash: 500 },
    { voucherId: "o2", cash: -200 },
    // Reversal of a voucher dated outside the period: kept.
    { voucherId: "r9", cash: 70 },
  ];
  const links = [
    { id: "o1", voucherNo: "PV/1", reversesVoucherId: "" },
    { id: "r1", voucherNo: "RV/1", reversesVoucherId: "o1" },
    { id: "o2", voucherNo: "PV/2", reversesVoucherId: "" },
    { id: "r9", voucherNo: "RV/9", reversesVoucherId: "o-outside" },
  ];
  const out = dropCancelledVouchers(movements, links);
  assert.equal(out.droppedVouchers, 2);
  assert.deepEqual(out.movements.map((m) => m.voucherId), ["o2", "r9"]);
  const net = (ms: { cash: number }[]) => ms.reduce((n, m) => n + m.cash, 0);
  assert.equal(net(out.movements), net(movements), "cash moved is unchanged");
}

// ── Entered up to ─────────────────────────────────────────────────────────
{
  assert.deepEqual(pickLastEntries([]), { latestDate: null, lastKeyed: null });

  const v = (
    id: string,
    voucherType: string,
    date: string,
    keyedAt: string,
    reversesVoucherId = "",
  ): HandVoucher => ({
    id,
    voucherNo: `${voucherType.slice(0, 2).toUpperCase()}/${id}`,
    voucherType,
    date,
    keyedAt,
    createdBy: "office",
    reversesVoucherId,
  });
  const rows = [
    v("a", "payment", "2026-04-20", "2026-10-13T10:00:00+00:00"),
    // Latest date, but reversed — cancelled entries say nothing.
    v("b", "payment", "2026-09-30", "2026-10-13T11:00:00+00:00"),
    // Back-dated bill typed last.
    v("c", "payment", "2026-04-03", "2026-10-13T12:00:00+00:00"),
    // Same date as "a", keyed later — wins the tie.
    v("d", "payment", "2026-04-20", "2026-10-13T11:30:00+00:00"),
    v("j", "journal", "2026-05-01", "2026-10-12T09:00:00+00:00"),
    v("r", "reversal", "2026-10-13", "2026-10-13T13:00:00+00:00", "b"),
  ];
  const k = lastEntriesByKind(rows, new Set(["b"]));
  assert.equal(k.payment!.latestDate!.voucherNo, "PA/d", "latest date, tie to the later keyed");
  assert.equal(k.payment!.lastKeyed!.voucherNo, "PA/c", "most recently keyed");
  assert.equal(k.journal!.latestDate!.date, "2026-05-01");
  assert.equal(k.reversal, undefined, "reversals are never an entry");
  assert.equal(k.any!.latestDate!.voucherNo, "JO/j");
  assert.equal(k.any!.lastKeyed!.voucherNo, "PA/c");

  // The server walks newest-first pages per type until the first live one.
  assert.equal(firstLiveVoucher([rows[1]!, rows[0]!], new Set(["b"]))!.id, "a", "a reversed voucher is skipped");
  assert.equal(firstLiveVoucher([rows[5]!], new Set()), null, "a reversal is never an entry");
  assert.equal(firstLiveVoucher([], new Set()), null);
}

// ── Day sheet: range rules ───────────────────────────────────────────────
{
  assert.deepEqual(daySheetRange({ date: "2026-10-13" }), { ok: true, from: "2026-10-13", to: "2026-10-13" }, "old {date} still works");
  assert.deepEqual(daySheetRange({ from: "2026-05-01", to: "2026-05-31" }), { ok: true, from: "2026-05-01", to: "2026-05-31" });
  assert.equal(daySheetRange({ from: "2026-05-02", to: "2026-05-01" }).ok, false, "To before From refused");
  assert.equal(daySheetRange({ from: "2026-13-01", to: "2026-13-01" }).ok, false, "a non-date refused");
  const q = daySheetRange({ from: "2026-04-01", to: "2026-07-01" }); // 92 days
  assert.equal(q.ok, true, `${DAY_SHEET_MAX_DAYS} days allowed`);
  const over = daySheetRange({ from: "2026-04-01", to: "2026-07-02" });
  assert.equal(over.ok, false);
  assert.match(over.ok ? "" : over.error, /93 days/);
}

// ── Day sheet: cancelled pairs off both sides, per-day totals ─────────────
{
  assert.deepEqual(
    parseReversalNarration("Reversal of PY/FY2026-27/00293 — Cleared for re-entry by office (director, 13 Oct 2026)"),
    { of: "PY/FY2026-27/00293", reason: "Cleared for re-entry by office (director, 13 Oct 2026)" },
  );
  const accounts = [
    { id: "cash", code: "1000", name: "Cash in Hand", isMoney: true },
    { id: "sal", code: "5070", name: "Salary & Wages", isMoney: false },
    { id: "fee", code: "4000", name: "Tuition fees", isMoney: false },
  ];
  const v = (id: string, voucherNo: string, date: string, narration = "", reversesVoucherId = "") => ({
    id, voucherNo, date, narration, reversesVoucherId,
  });
  const vouchers = [
    v("p1", "PY/1", "2026-05-01", "Salary Ram"), // cancelled, reversal same day
    v("r1", "RV/1", "2026-05-01", "Reversal of PY/1 — Cleared for re-entry", "p1"),
    v("p2", "PY/2", "2026-05-02", "Salary Shyam"), // cancelled by a reversal dated OUTSIDE the range
    v("r3", "RV/3", "2026-05-02", "Reversal of PY/9 — duplicate", "p9"), // original outside the range
    v("f1", "RC/1", "2026-05-01", "Fee"),
    v("s1", "PY/3", "2026-05-02", "Salary Mohan"),
  ];
  const line = (voucherId: string, accountId: string, debitPaise: number, creditPaise: number) => ({
    voucherId, accountId, debitPaise, creditPaise,
  });
  const lines = [
    line("p1", "sal", 1000, 0), line("p1", "cash", 0, 1000),
    line("r1", "cash", 1000, 0), line("r1", "sal", 0, 1000),
    line("p2", "sal", 700, 0), line("p2", "cash", 0, 700),
    line("r3", "cash", 300, 0), line("r3", "sal", 0, 300),
    line("f1", "cash", 5000, 0), line("f1", "fee", 0, 5000),
    line("s1", "sal", 400, 0), line("s1", "cash", 0, 400),
  ];
  const reversals = [
    vouchers[1]!,
    vouchers[3]!,
    v("r2", "RV/2", "2026-06-15", "Reversal of PY/2 — wrong month", "p2"),
  ];
  const sheet = buildDaySheet({
    from: "2026-05-01",
    to: "2026-05-02",
    vouchers,
    lines,
    accounts,
    reversals,
    originals: [v("p9", "PY/9", "2026-04-20", "Salary Gita")],
  });
  // The pair wholly inside the range (PY/1 + RV/1) is on neither side.
  // The halves whose partner is outside — PY/2 (voided 15 Jun) and RV/3
  // (cancels a voucher of 20 Apr) — are counted where the cash moved.
  assert.equal(sheet.collections.totalPaise, 5000 + 300, "an in-range reversal is never a collection");
  assert.equal(sheet.expenses.totalPaise, 700 + 400, "a payment voided after the range still counts");
  assert.deepEqual(sheet.days, [
    { date: "2026-05-01", inPaise: 5000, outPaise: 0 },
    { date: "2026-05-02", inPaise: 300, outPaise: 1100 },
  ]);
  assert.deepEqual(sheet.cancelled.map((c) => c.voucherNo), ["PY/1", "RV/1"]);
  const byNo = new Map(sheet.cancelled.map((c) => [c.voucherNo, c]));
  assert.equal(byNo.get("PY/1")!.role, "cancelled");
  assert.equal(byNo.get("PY/1")!.pairedNo, "RV/1");
  assert.equal(byNo.get("PY/1")!.reason, "Cleared for re-entry");
  assert.equal(byNo.get("RV/1")!.role, "reversal");
  assert.equal(byNo.get("RV/1")!.inPaise, 1000);
  const cross = new Map(sheet.crossRange.map((c) => [c.voucherNo, c.note]));
  assert.equal(cross.get("PY/2"), "cancelled later on 2026-06-15 — RV/2");
  assert.equal(cross.get("RV/3"), "cancels PY/9 of 2026-04-20");
  // The label travels with the entry behind the head's figure.
  const salaryEntries = sheet.expenses.tenders[0]!.heads.find((h) => h.code === "5070")!.entries;
  assert.equal(salaryEntries.find((e) => e.voucherNo === "PY/2")!.note, "cancelled later on 2026-06-15 — RV/2");

  // Widen the range to take in RV/2 and the pair disappears from both sides.
  const wide = buildDaySheet({
    from: "2026-05-01",
    to: "2026-06-15",
    vouchers: [...vouchers, reversals[2]!],
    lines: [...lines, line("r2", "cash", 700, 0), line("r2", "sal", 0, 700)],
    accounts,
    reversals,
    originals: [v("p9", "PY/9", "2026-04-20", "Salary Gita")],
  });
  assert.equal(wide.expenses.totalPaise, 400);
  assert.equal(wide.collections.totalPaise, 5300, "RV/2 is not a collection once its pair is in range");
  assert.ok(wide.cancelled.some((c) => c.voucherNo === "RV/2" && c.reason === "wrong month"));
  assert.equal(sheet.from, "2026-05-01");
  assert.equal(sheet.to, "2026-05-02");

  // Drill-down: a head's figure is exactly the entries it lists.
  for (const side of [sheet.collections, sheet.expenses]) {
    for (const t of side.tenders) {
      for (const h of t.heads) {
        assert.equal(h.entries.reduce((n, e) => n + e.paise, 0), h.paise);
        assert.equal(h.entries.length, h.count);
      }
    }
  }
  assert.ok(
    !sheet.expenses.tenders.some((t) => t.heads.some((h) => h.entries.some((e) => e.voucherNo === "PY/1"))),
    "a pair wholly in range is never behind a figure",
  );

  // Print selected days: each day's sheet is cut from the range and adds up.
  const may1 = sideForDay(sheet.collections, "2026-05-01");
  assert.equal(may1.totalPaise, 5000);
  assert.equal(sideForDay(sheet.collections, "2026-05-02").totalPaise, 300);
  assert.equal(sideForDay(sheet.expenses, "2026-05-01").tenders.length, 0, "a day with nothing prints nothing");
  assert.equal(sideForDay(sheet.expenses, "2026-05-02").totalPaise, 1100);
  const dayTotal = sheet.days.reduce(
    (n, d) => n + sideForDay(sheet.collections, d.date).totalPaise - sideForDay(sheet.expenses, d.date).totalPaise,
    0,
  );
  assert.equal(dayTotal, sheet.collections.totalPaise - sheet.expenses.totalPaise, "days sum to the range");

  assert.deepEqual(pickedDays(sheet.days, new Set(["2026-05-02", "2026-05-01", "2026-06-30"])), ["2026-05-01", "2026-05-02"], "only days on the sheet, in date order");
  assert.deepEqual([...toggleAllDays(sheet.days, new Set())].sort(), ["2026-05-01", "2026-05-02"]);
  assert.equal(toggleAllDays(sheet.days, new Set(["2026-05-01", "2026-05-02"])).size, 0, "all ticked → none");
  assert.equal(toggleAllDays(sheet.days, new Set(["2026-05-01"])).size, 2, "some ticked → all");
}

// ── Book report drill-down targets ───────────────────────────────────────
{
  const known = new Set(["1000", "5070"]);
  assert.deepEqual(
    statementDrillTarget({ code: "5070", knownCodes: known, from: "2026-04-01", to: "2026-10-13" }),
    { code: "5070", from: "2026-04-01", to: "2026-10-13" },
  );
  assert.equal(statementDrillTarget({ code: "", knownCodes: known, from: "2026-04-01", to: "2026-10-13" }), null);
  assert.equal(
    statementDrillTarget({ code: "SURPLUS", knownCodes: known, from: "2026-04-01", to: "2026-10-13" }),
    null,
    "a figure that is not one account does not drill",
  );
  assert.equal(statementDrillTarget({ code: "1000", knownCodes: known, from: "", to: "2026-10-13" }), null);
  assert.ok(isOpenKey("Enter") && isOpenKey(" ") && !isOpenKey("Tab"));
}

// ── Wiring: the route serves it read-only, not behind accounts_position ────
{
  const route = readFileSync(join(__dirname, "../../app/api/ledger/route.ts"), "utf8");
  const readOnly = route.slice(route.indexOf("const readOnly = new Set(["), route.indexOf("const POSITION_ACTIONS"));
  assert.ok(readOnly.includes('"last-entries"'), "last-entries is a view-level action");
  const position = route.slice(route.indexOf("const POSITION_ACTIONS"), route.indexOf("if (POSITION_ACTIONS.has"));
  assert.ok(!position.includes('"last-entries"'), "the office sees it without accounts_position");

  const reports = readFileSync(join(__dirname, "reports.server.ts"), "utf8");
  const le = reports.slice(reports.indexOf("export async function ledgerLastEntries"));
  assert.ok(/\.eq\("voucher_type", type\)/.test(le.slice(0, 3000)), "last entries asked per type, so a quiet type is never crowded out");
  assert.ok(/periodBalances\(\{ from: input\.from, to: input\.to \}\)/.test(reports.slice(reports.indexOf("export async function accountStatement")).slice(0, 2500)), "statement opening/closing from the book's period balances");
  const mig = readFileSync(join(__dirname, "../../../../../supabase/migrations/20261013230000_ledger_statement_total_order.sql"), "utf8");
  assert.ok(/order by r\.voucher_date, r\.created_at, r\.voucher_no, r\.line_id;/.test(mig), "statement has a total order");
  assert.ok(/order by t\.voucher_date, t\.voucher_no, l\.id;/.test(mig), "cash movements have a total order");
  const stmt = reports.slice(reports.indexOf("export async function accountStatement"));
  assert.ok(/fetchAllPages[\s\S]*?ledger_account_statement/.test(stmt.slice(0, 2000)), "statement is paged");
  const cm = reports.slice(reports.indexOf("async function cashMovements"));
  assert.ok(/fetchAllPages[\s\S]*?ledger_cash_movements/.test(cm.slice(0, 1200)), "cash movements are paged");

  // The day sheet stays a view-level action outside accounts_position.
  assert.ok(readOnly.includes('"day-sheet"'));
  assert.ok(!position.includes('"day-sheet"'), "the counter runs the day sheet without accounts_position");
  // The voucher the day sheet opens is readable with view rights alone.
  assert.ok(readOnly.includes('"voucher-detail"'));
  assert.ok(!position.includes('"voucher-detail"'), "voucher detail is not a position action");
  const ds = readFileSync(join(__dirname, "daySheet.server.ts"), "utf8");
  assert.ok(/not\("reverses_voucher_id", "is", null\)/.test(ds), "reversals read for the pairs");
  assert.equal((ds.match(/fetchAllPages</g) ?? []).length, 2, "vouchers and reversals both paged");
  assert.ok(/fetchByIds</.test(ds), "lines read by chunked, paged ids");
  assert.ok(!/closing|opening|balance_paise/i.test(ds.replace(/\/\*[\s\S]*?\*\//g, "")), "no balances read");
}

console.log("  ok");
