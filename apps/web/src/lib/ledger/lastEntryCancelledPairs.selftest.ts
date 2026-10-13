import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cancelledPairKeys,
  dropCancelledVouchers,
  hideCancelledLines,
  statementOpeningPaise,
  type StatementLineLike,
} from "./cancelledPairs";
import { lastEntriesByKind, pickLastEntries, type HandVoucher } from "./lastEntries";

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

  assert.equal(statementOpeningPaise(rows, true), opening, "opening read back off the first line");

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
  assert.equal(statementOpeningPaise(liab, false), 0);
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
}

// ── Wiring: the route serves it read-only, not behind accounts_position ────
{
  const route = readFileSync(join(__dirname, "../../app/api/ledger/route.ts"), "utf8");
  const readOnly = route.slice(route.indexOf("const readOnly = new Set(["), route.indexOf("const POSITION_ACTIONS"));
  assert.ok(readOnly.includes('"last-entries"'), "last-entries is a view-level action");
  const position = route.slice(route.indexOf("const POSITION_ACTIONS"), route.indexOf("if (POSITION_ACTIONS.has"));
  assert.ok(!position.includes('"last-entries"'), "the office sees it without accounts_position");

  const reports = readFileSync(join(__dirname, "reports.server.ts"), "utf8");
  const stmt = reports.slice(reports.indexOf("export async function accountStatement"));
  assert.ok(/fetchAllPages[\s\S]*?ledger_account_statement/.test(stmt.slice(0, 2000)), "statement is paged");
  const cm = reports.slice(reports.indexOf("async function cashMovements"));
  assert.ok(/fetchAllPages[\s\S]*?ledger_cash_movements/.test(cm.slice(0, 1200)), "cash movements are paged");
}

console.log("  ok");
