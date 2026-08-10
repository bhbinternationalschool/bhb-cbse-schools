/**
 * Payroll → Tally journal sync — consolidated JV from posted/paid runs,
 * CSV + TallyPrime XML export, and local sync log.
 */

import { loadMasters } from "@/lib/masters";
import {
  appendPayrollAudit,
  downloadTextFile,
  loadPayroll,
  pickPayslipRun,
  type PayrollRun,
} from "@/lib/payroll";
import {
  loadSalarySetup,
  normalizeSalarySettings,
  type SalaryHead,
} from "@/lib/salarySetup";

import { assertModulePermission } from "@/lib/rbacGuard";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";
export type TallyJvSide = "debit" | "credit";

export type TallyJvLine = {
  ledger: string;
  debit: number;
  credit: number;
  tip: string;
};

export type TallyJournalVoucher = {
  runId: string;
  month: string;
  academicYearCode: string;
  voucherNo: string;
  voucherDate: string;
  narration: string;
  companyName: string;
  staffCount: number;
  lines: TallyJvLine[];
  debitTotal: number;
  creditTotal: number;
  balanced: boolean;
  imbalance: number;
  bankLedger: string;
  juneHoldLedger: string;
  error: string | null;
};

export type TallySyncFormat = "csv" | "xml" | "manual";

export type TallySyncRecord = {
  id: string;
  runId: string;
  month: string;
  academicYearCode: string;
  format: TallySyncFormat;
  voucherNo: string;
  debitTotal: number;
  creditTotal: number;
  exportedBy: string;
  exportedAt: string;
};

export type TallySyncState = {
  version: 1;
  records: TallySyncRecord[];
};

const STORAGE_KEY = "bhb_tally_sync_v1";
const JUNE_HOLD_LEDGER = "Salary June Hold";
const ROUND = (n: number) => Math.round(n * 100) / 100;

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function loadTallySync(): TallySyncState {
  if (typeof window === "undefined") return { version: 1, records: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, records: [] };
    const parsed = JSON.parse(raw) as Partial<TallySyncState>;
    return {
      version: 1,
      records: Array.isArray(parsed.records) ? parsed.records : [],
    };
  } catch {
    return { version: 1, records: [] };
  }
}

export function saveTallySync(state: TallySyncState) {
  if (!assertModulePermission("payroll", "edit", "saveTallySync")) return;
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
}

export function listTallySync(limit = 40): TallySyncRecord[] {
  return [...loadTallySync().records]
    .sort((a, b) => b.exportedAt.localeCompare(a.exportedAt))
    .slice(0, limit);
}

export function isTallySynced(runId: string): boolean {
  return loadTallySync().records.some((r) => r.runId === runId);
}

export function latestSyncForRun(runId: string): TallySyncRecord | null {
  return (
    listTallySync(200).find((r) => r.runId === runId) || null
  );
}

export function suggestedVoucherNo(month: string): string {
  return `SAL/${month}`;
}

function voucherDateForMonth(month: string, payDay: number): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return `${month}-01`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const day = Math.min(Math.max(payDay, 1), 28);
  return `${nextY}-${String(nextM).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function tallyDate(iso: string): string {
  // Tally wants YYYYMMDD
  return iso.replace(/-/g, "");
}

function headLedgerMap(heads: SalaryHead[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const h of heads) {
    m.set(h.id, (h.tallyLedger || h.name || h.code).trim() || h.code);
  }
  return m;
}

function ledgerForComponent(
  headId: string,
  headName: string,
  map: Map<string, string>,
): string {
  return map.get(headId) || headName.trim() || "Salary";
}

function addAmt(
  bag: Map<string, { amount: number; tip: string }>,
  ledger: string,
  amount: number,
  tip: string,
) {
  if (amount <= 0) return;
  const key = ledger.trim() || "Unmapped";
  const prev = bag.get(key);
  if (prev) {
    bag.set(key, {
      amount: ROUND(prev.amount + amount),
      tip: prev.tip,
    });
  } else {
    bag.set(key, { amount: ROUND(amount), tip });
  }
}

/**
 * Build one consolidated journal for a posted/paid payroll run.
 * Dr earnings + employer · Cr deductions · Cr bank (payable) ·
 * Cr June hold (held net) · Cr employer payables (match employer Dr).
 */
export function buildPayrollJournal(run: PayrollRun): TallyJournalVoucher {
  const salary = loadSalarySetup();
  const settings = normalizeSalarySettings(salary.settings);
  const bankLedger =
    settings.salaryAccountLabel.trim() ||
    "Salary account — Union Bank Murdaha Bazar";
  const juneHoldLedger = JUNE_HOLD_LEDGER;
  const map = headLedgerMap(salary.heads);

  const masters = loadMasters();
  const companyName =
    masters.schoolProfile?.displayName ||
    masters.schoolProfile?.legalName ||
    "BHB International School";

  const voucherNo = suggestedVoucherNo(run.month);
  const voucherDate = voucherDateForMonth(run.month, settings.payDay);

  if (run.status !== "posted" && run.status !== "paid") {
    return {
      runId: run.id,
      month: run.month,
      academicYearCode: run.academicYearCode,
      voucherNo,
      voucherDate,
      narration: "",
      companyName,
      staffCount: run.lines.length,
      lines: [],
      debitTotal: 0,
      creditTotal: 0,
      balanced: false,
      imbalance: 0,
      bankLedger,
      juneHoldLedger,
      error: "Publish payroll to salary account before Tally sync",
    };
  }

  const dr = new Map<string, { amount: number; tip: string }>();
  const cr = new Map<string, { amount: number; tip: string }>();

  let bankCredit = 0;
  let holdCredit = 0;
  let employerTotal = 0;

  for (const line of run.lines) {
    for (const c of line.components) {
      if (c.amount <= 0) continue;
      const ledger = ledgerForComponent(c.headId, c.headName, map);
      if (c.kind === "earning") {
        addAmt(dr, ledger, c.amount, "Earning head");
      } else if (c.kind === "deduction") {
        addAmt(cr, ledger, c.amount, "Deduction / liability");
      } else if (c.kind === "employer") {
        addAmt(dr, ledger, c.amount, "Employer cost (expense)");
        addAmt(
          cr,
          `${ledger} Payable`,
          c.amount,
          "Employer contribution payable",
        );
        employerTotal += c.amount;
      }
    }

    const payable = ROUND(
      line.amountPayable ?? (line.juneHold ? 0 : line.netPay),
    );
    if (payable > 0) bankCredit += payable;

    if (line.juneHold && line.netPay > 0) {
      holdCredit += ROUND(line.netPay);
    }
  }

  if (bankCredit > 0) {
    addAmt(cr, bankLedger, bankCredit, "Net salary payable → bank");
  }
  if (holdCredit > 0) {
    addAmt(cr, juneHoldLedger, holdCredit, "June salary held (payable later)");
  }

  const lines: TallyJvLine[] = [];
  for (const [ledger, { amount, tip }] of [...dr.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    lines.push({ ledger, debit: amount, credit: 0, tip });
  }
  for (const [ledger, { amount, tip }] of [...cr.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    lines.push({ ledger, debit: 0, credit: amount, tip });
  }

  const debitTotal = ROUND(lines.reduce((s, l) => s + l.debit, 0));
  const creditTotal = ROUND(lines.reduce((s, l) => s + l.credit, 0));
  const imbalance = ROUND(Math.abs(debitTotal - creditTotal));
  const balanced = imbalance < 0.02 && lines.length > 0;

  const narration = [
    `Salary ${run.month}`,
    `${run.lines.length} staff`,
    employerTotal > 0 ? `employer cost incl.` : null,
    holdCredit > 0 ? `June hold ${holdCredit}` : null,
    `Vch ${voucherNo}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    runId: run.id,
    month: run.month,
    academicYearCode: run.academicYearCode,
    voucherNo,
    voucherDate,
    narration,
    companyName,
    staffCount: run.lines.length,
    lines,
    debitTotal,
    creditTotal,
    balanced,
    imbalance,
    bankLedger,
    juneHoldLedger,
    error: balanced
      ? null
      : lines.length === 0
        ? "No journal lines — empty run"
        : `Journal imbalance ₹${imbalance.toFixed(2)} — check head mappings`,
  };
}

function csvEscape(v: string | number): string {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function tallyJournalCsv(jv: TallyJournalVoucher): string {
  const rows: string[][] = [
    [
      "Date",
      "VoucherType",
      "VoucherNo",
      "Ledger",
      "Debit",
      "Credit",
      "Narration",
      "Company",
      "Month",
      "Tip",
    ],
  ];
  for (const line of jv.lines) {
    rows.push([
      jv.voucherDate,
      "Journal",
      jv.voucherNo,
      line.ledger,
      line.debit ? line.debit.toFixed(2) : "",
      line.credit ? line.credit.toFixed(2) : "",
      jv.narration,
      jv.companyName,
      jv.month,
      line.tip,
    ]);
  }
  return "\uFEFF" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** TallyPrime / Tally.ERP 9 voucher import XML */
export function tallyPrimeXml(jv: TallyJournalVoucher): string {
  const date = tallyDate(jv.voucherDate);
  const entries = jv.lines
    .map((line) => {
      const isDebit = line.debit > 0;
      const amt = isDebit ? line.debit : line.credit;
      // Debit: ISDEEMEDPOSITIVE Yes, negative amount
      // Credit: ISDEEMEDPOSITIVE No, positive amount
      const amountXml = isDebit
        ? `-${amt.toFixed(2)}`
        : amt.toFixed(2);
      return `      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>${xmlEscape(line.ledger)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>${isDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
       <AMOUNT>${amountXml}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>${xmlEscape(jv.companyName)}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">
      <DATE>${date}</DATE>
      <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>
      <VOUCHERNUMBER>${xmlEscape(jv.voucherNo)}</VOUCHERNUMBER>
      <REFERENCE>${xmlEscape(jv.voucherNo)}</REFERENCE>
      <NARRATION>${xmlEscape(jv.narration)}</NARRATION>
      <PARTYLEDGERNAME>${xmlEscape(jv.bankLedger)}</PARTYLEDGERNAME>
${entries}
     </VOUCHER>
    </TALLYMESSAGE>
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
`;
}

export function markTallySynced(opts: {
  jv: TallyJournalVoucher;
  format: TallySyncFormat;
  by: string;
}): TallySyncRecord {
  const rec: TallySyncRecord = {
    id: nid("ts"),
    runId: opts.jv.runId,
    month: opts.jv.month,
    academicYearCode: opts.jv.academicYearCode,
    format: opts.format,
    voucherNo: opts.jv.voucherNo,
    debitTotal: opts.jv.debitTotal,
    creditTotal: opts.jv.creditTotal,
    exportedBy: opts.by,
    exportedAt: new Date().toISOString(),
  };
  const state = loadTallySync();
  state.records = [rec, ...state.records].slice(0, 200);
  saveTallySync(state);

  appendPayrollAudit({
    by: opts.by,
    action: "tally_export",
    runId: opts.jv.runId,
    month: opts.jv.month,
    academicYearCode: opts.jv.academicYearCode,
    detail: `Tally ${opts.format.toUpperCase()} · ${opts.jv.voucherNo} · Dr ${opts.jv.debitTotal} / Cr ${opts.jv.creditTotal}`,
  });

  return rec;
}

export function downloadTallyCsv(
  jv: TallyJournalVoucher,
  by: string,
): { ok: true; message: string } | { ok: false; error: string } {
  if (jv.error || !jv.balanced) {
    return { ok: false, error: jv.error || "Journal not balanced" };
  }
  downloadTextFile(
    `tally_salary_${jv.month}.csv`,
    tallyJournalCsv(jv),
  );
  markTallySynced({ jv, format: "csv", by });
  return {
    ok: true,
    message: `Journal CSV · ${jv.voucherNo} · ${jv.lines.length} lines`,
  };
}

export function downloadTallyXml(
  jv: TallyJournalVoucher,
  by: string,
): { ok: true; message: string } | { ok: false; error: string } {
  if (jv.error || !jv.balanced) {
    return { ok: false, error: jv.error || "Journal not balanced" };
  }
  downloadTextFile(
    `tally_salary_${jv.month}.xml`,
    tallyPrimeXml(jv),
  );
  markTallySynced({ jv, format: "xml", by });
  return {
    ok: true,
    message: `Tally XML · ${jv.voucherNo} · import via Gateway of Tally`,
  };
}

export function buildTallyPreview(opts: {
  month: string;
  academicYearCode: string;
}): {
  run: PayrollRun | null;
  jv: TallyJournalVoucher | null;
  synced: TallySyncRecord | null;
} {
  const run = pickPayslipRun(
    loadPayroll().runs,
    opts.month,
    opts.academicYearCode,
  );
  if (!run || (run.status !== "posted" && run.status !== "paid")) {
    return {
      run: run?.status === "approved" ? run : null,
      jv: null,
      synced: null,
    };
  }
  const jv = buildPayrollJournal(run);
  return { run, jv, synced: latestSyncForRun(run.id) };
}

export function tallyFormatLabel(f: TallySyncFormat): string {
  switch (f) {
    case "csv":
      return "Journal CSV";
    case "xml":
      return "Tally XML";
    case "manual":
      return "Marked synced";
    default:
      return f;
  }
}
