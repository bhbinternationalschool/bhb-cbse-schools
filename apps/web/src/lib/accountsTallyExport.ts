/**
 * Accounts day book → Tally journal export (fee collections + paid expenses).
 */

import {
  COA_FEE_INCOME,
  getCoaByCode,
  getExpenseCategory,
  loadAccounts,
} from "@/lib/accounts";
import { buildDayBook, tenderModeLabel } from "@/lib/fees";
import { loadMasters } from "@/lib/masters";
import { downloadTextFile } from "@/lib/payroll";
import {
  tallyJournalCsv,
  tallyPrimeXml,
  type TallyJournalVoucher,
  type TallyJvLine,
} from "@/lib/tallySync";

const ROUND = (paise: number) => Math.round(paise) / 100;

function csvEscape(v: string | number): string {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build consolidated journal voucher for one calendar date. */
export function buildAccountsDayJv(date: string): TallyJournalVoucher {
  const accounts = loadAccounts();
  const masters = loadMasters();
  const book = buildDayBook(date);
  const companyName =
    masters.schoolProfile?.displayName?.trim() || "School Accounts";
  const feeIncomeCoa = getCoaByCode(COA_FEE_INCOME, accounts);
  const feeLedger = feeIncomeCoa?.name || "Fee Income";

  const lines: TallyJvLine[] = [];

  for (const row of book.modeTotals) {
    if (row.paise <= 0) continue;
    const modeLabel = tenderModeLabel(row.mode);
    const settleLedger =
      row.mode === "cash" ? "Cash in Hand" : "Bank Accounts";
    lines.push({
      ledger: settleLedger,
      debit: ROUND(row.paise),
      credit: 0,
      tip: `${modeLabel} fee collection`,
    });
    lines.push({
      ledger: feeLedger,
      debit: 0,
      credit: ROUND(row.paise),
      tip: `${modeLabel} · ${row.tenderCount} tender(s)`,
    });
  }

  for (const v of accounts.expenseVouchers) {
    if (v.paymentStatus !== "paid" || v.paidOn !== date) continue;
    const cat = getExpenseCategory(v.categoryId, accounts);
    const expenseLedger = cat?.name || "Other Expenses";
    const settleLedger =
      v.mode === "cash" ? "Cash in Hand" : "Bank Accounts";
    lines.push({
      ledger: expenseLedger,
      debit: ROUND(v.amountPaise),
      credit: 0,
      tip: v.narration || "Expense voucher",
    });
    lines.push({
      ledger: settleLedger,
      debit: 0,
      credit: ROUND(v.amountPaise),
      tip: v.mode,
    });
  }

  const debitTotal = ROUND(
    lines.reduce((n, l) => n + Math.round(l.debit * 100), 0),
  );
  const creditTotal = ROUND(
    lines.reduce((n, l) => n + Math.round(l.credit * 100), 0),
  );
  const imbalance = Math.abs(debitTotal - creditTotal);

  return {
    runId: `accounts_day_${date}`,
    month: date.slice(0, 7),
    academicYearCode: "",
    voucherNo: `ACC/${date}`,
    voucherDate: date,
    narration: `Accounts day book · ${date}`,
    companyName,
    staffCount: 0,
    lines,
    debitTotal,
    creditTotal,
    balanced: imbalance < 0.02,
    imbalance,
    bankLedger: "Bank Accounts",
    juneHoldLedger: "",
    error: lines.length === 0 ? "No fee collections or paid expenses on this date" : null,
  };
}

export function exportAccountsTallyCsv(date: string): {
  ok: true;
  message: string;
} | { ok: false; error: string } {
  const jv = buildAccountsDayJv(date);
  if (jv.error && jv.lines.length === 0) {
    return { ok: false, error: jv.error };
  }
  downloadTextFile(`tally_accounts_${date}.csv`, tallyJournalCsv(jv));
  return {
    ok: true,
    message: `Tally CSV · ${jv.voucherNo} · ${jv.lines.length} line(s)`,
  };
}

export function exportAccountsTallyXml(date: string): {
  ok: true;
  message: string;
} | { ok: false; error: string } {
  const jv = buildAccountsDayJv(date);
  if (jv.error && jv.lines.length === 0) {
    return { ok: false, error: jv.error };
  }
  if (!jv.balanced) {
    return {
      ok: false,
      error: `Journal not balanced (Δ ₹${jv.imbalance.toFixed(2)})`,
    };
  }
  downloadTextFile(`tally_accounts_${date}.xml`, tallyPrimeXml(jv));
  return {
    ok: true,
    message: `Tally XML · ${jv.voucherNo} · import via Gateway of Tally`,
  };
}

/** Plain CSV preview (ledger lines only). */
export function accountsDayJvPreviewCsv(date: string): string {
  const jv = buildAccountsDayJv(date);
  const rows: string[][] = [
    ["Date", "VoucherNo", "Ledger", "Debit", "Credit", "Tip"],
  ];
  for (const line of jv.lines) {
    rows.push([
      jv.voucherDate,
      jv.voucherNo,
      line.ledger,
      line.debit ? line.debit.toFixed(2) : "",
      line.credit ? line.credit.toFixed(2) : "",
      line.tip,
    ]);
  }
  return "\uFEFF" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}
