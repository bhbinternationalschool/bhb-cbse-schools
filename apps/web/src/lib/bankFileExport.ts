/**
 * Bank salary upload file — NEFT / bulk transfer from published payroll.
 * Uses staff bank details from Masters staff profile.
 */

import type { StaffRecord } from "@/lib/foundationMasters";
import type { MastersState } from "@/lib/masters";
import { isVisitingStaff } from "@/lib/visitingPay";
import {
  downloadTextFile,
  formatInr,
  loadPayroll,
  type PayrollRun,
  type PayrollStaffLine,
  monthPayslipLines,
} from "@/lib/payroll";
import {
  loadSalarySetup,
  normalizeSalarySettings,
  SCHOOL_SALARY_BANK,
} from "@/lib/salarySetup";

export type BankFileFormat =
  | "ubi_salary_upload"
  | "ubi_neft"
  | "generic_neft"
  | "sbi_corporate"
  | "hdfc_bulk"
  | "icici_bulk";

export const BANK_FILE_FORMATS: {
  value: BankFileFormat;
  label: string;
  hint: string;
}[] = [
  {
    value: "ubi_salary_upload",
    label: "Union Bank salary upload (bank's own format)",
    hint: "FILEHDR row · one DR row for the total · one CR row per Union Bank account — staff at other banks go by NEFT",
  },
  {
    value: "ubi_neft",
    label: "Union Bank NEFT",
    hint: `UBI Murdaha Bazar · IFSC ${SCHOOL_SALARY_BANK.ifsc} · beneficiary a/c, IFSC, name, amount, debit a/c, remarks`,
  },
  {
    value: "generic_neft",
    label: "Generic NEFT CSV",
    hint: "Name, A/c, IFSC, Amount, Type, Remarks — most banks accept this",
  },
  {
    value: "sbi_corporate",
    label: "SBI Corporate CSV",
    hint: "Beneficiary A/c, IFSC, Name, Amount, Debit a/c, Remarks",
  },
  {
    value: "hdfc_bulk",
    label: "HDFC bulk CSV",
    hint: "Transaction type N · beneficiary details · amount · remark",
  },
  {
    value: "icici_bulk",
    label: "ICICI bulk CSV",
    hint: "Payment type NEFT · account · IFSC · amount · narration",
  },
];

export type BankExportRow = {
  staffId: string;
  empCode: string;
  fullName: string;
  amount: number;
  accountNo: string;
  ifsc: string;
  accountName: string;
  bankName: string;
  paymentMode: string;
  paymentDate: string;
  remark: string;
  ok: boolean;
  issues: string[];
  /** Not blocking: worth a look before the file goes to the bank. */
  warnings?: string[];
};

export type BankExportPreview = {
  month: string;
  run: PayrollRun | null;
  /** Every run whose lines are in the file (a month can be paid in parts). */
  runs: PayrollRun[];
  rows: BankExportRow[];
  totalAmount: number;
  readyCount: number;
  blockedCount: number;
  debitAccountNo: string;
  debitIfsc: string;
  debitBankName: string;
  debitBranch: string;
  /** Union Bank corporate ID (Masters → Salary setup). */
  debitCorporateId: string;
};

function csvEscape(v: string | number): string {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLines(rows: string[][]): string {
  return "\uFEFF" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

function ifscOk(ifsc: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test((ifsc || "").toUpperCase());
}

function digitsOnly(account: string): string {
  return (account || "").replace(/\s+/g, "");
}

/**
 * The beneficiary name as banks accept it: letters, digits and spaces, at
 * most 35 characters (the NEFT field). A dot, slash or ampersand can make a
 * bank reject the whole upload.
 */
export function bankSafeName(name: string): string {
  return (name || "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 35)
    .trim();
}

export function buildBankExportPreview(input: {
  masters: MastersState;
  month: string;
  academicYearCode: string;
  /** Only bank_transfer / upi lines by default */
  modes?: Array<"bank_transfer" | "upi" | "all">;
  requirePosted?: boolean;
}): BankExportPreview {
  const salary = loadSalarySetup();
  const settings = normalizeSalarySettings(salary.settings);
  const runs = loadPayroll().runs;
  // A month can be paid in several runs (staff paid on different days). The
  // file carries the posted runs still waiting to be paid — never someone
  // already marked paid next to them, or the bank would pay them twice. When
  // nothing is waiting, the paid month can be downloaded again.
  let entries =
    input.requirePosted === false
      ? monthPayslipLines(runs, input.month, input.academicYearCode)
      : monthPayslipLines(runs, input.month, input.academicYearCode, ["posted"])
          // Staff on a posted run already marked paid on their own day
          // (14 Oct 2026) are not in the file either.
          .filter((e) => !e.line.paidOn);
  if (entries.length === 0 && input.requirePosted !== false) {
    entries = monthPayslipLines(runs, input.month, input.academicYearCode, ["paid"]);
  }
  const fileRuns = [...new Map(entries.map((e) => [e.run.id, e.run])).values()];
  const run = fileRuns[0] ?? null;

  const staffById = new Map(
    (input.masters.staff ?? []).map((s) => [s.id, s]),
  );
  const modeFilter = input.modes?.includes("all")
    ? null
    : new Set(
        (input.modes?.length ? input.modes : ["bank_transfer"]).filter(
          (m) => m !== "all",
        ),
      );

  const rows: BankExportRow[] = [];
  {
    for (const { line } of entries) {
      // NEFT / RTGS is a bank transfer for the file.
      const mode = line.paymentMode === "neft" ? "bank_transfer" : line.paymentMode || "bank_transfer";
      if (modeFilter && !modeFilter.has(mode as "bank_transfer" | "upi")) {
        continue;
      }
      const amount = Math.round(line.amountPayable ?? line.netPay);
      if (amount <= 0) continue;

      const staff = staffById.get(line.staffId);
      const row = buildRow(line, staff, amount, input.month);
      // The payroll draft is the only gate (visiting staff are never drafted).
      // A line already in a run is paid as the run says, even if the person
      // has since been made visiting — only warned, never dropped.
      if (isVisitingStaff(staff)) {
        row.warnings = [...(row.warnings ?? []), "Now visiting staff — this salary line was drafted before the change; make sure their work sheet does not pay the same days"];
      }
      rows.push(row);
    }
  }

  // One account credited for two people is almost always a typo copied from
  // a colleague's profile: block both until the office checks.
  const byAccount = new Map<string, BankExportRow[]>();
  for (const r of rows) {
    if (!r.accountNo) continue;
    byAccount.set(r.accountNo, [...(byAccount.get(r.accountNo) ?? []), r]);
  }
  for (const group of byAccount.values()) {
    if (group.length < 2) continue;
    for (const r of group) {
      const others = group.filter((x) => x !== r).map((x) => `${x.empCode} ${x.fullName}`).join(", ");
      r.issues.push(`Same bank a/c as ${others}`);
      r.ok = false;
    }
  }

  rows.sort((a, b) => a.empCode.localeCompare(b.empCode));
  const readyCount = rows.filter((r) => r.ok).length;
  const blockedCount = rows.length - readyCount;
  const totalAmount = rows
    .filter((r) => r.ok)
    .reduce((s, r) => s + r.amount, 0);

  return {
    month: input.month,
    run,
    runs: fileRuns,
    rows,
    totalAmount,
    readyCount,
    blockedCount,
    debitAccountNo: settings.salaryBankAccountNo.trim(),
    debitIfsc: settings.salaryBankIfsc.trim().toUpperCase(),
    debitBankName: settings.salaryBankName.trim(),
    debitBranch: settings.salaryBankBranch.trim(),
    debitCorporateId: (settings.salaryBankCorporateId || "").trim(),
  };
}

function buildRow(
  line: PayrollStaffLine,
  staff: StaffRecord | undefined,
  amount: number,
  month: string,
): BankExportRow {
  const accountNo = digitsOnly(staff?.bankAccountNo || "");
  const ifsc = (staff?.bankIfsc || "").trim().toUpperCase();
  const typedName = (
    staff?.bankAccountName ||
    staff?.fullName ||
    line.fullName
  ).trim();
  const accountName = bankSafeName(typedName);
  const bankName = (staff?.bankName || "").trim();
  const issues: string[] = [];
  if (!staff) issues.push("Staff profile missing");
  if (!accountNo) issues.push("Bank a/c missing");
  if (accountNo && !/^\d+$/.test(accountNo)) issues.push("A/c has letters or symbols");
  else if (accountNo && accountNo.length < 6) issues.push("A/c too short");
  else if (accountNo.length > 18) issues.push("A/c too long");
  if (!ifsc) issues.push("IFSC missing");
  else if (!ifscOk(ifsc)) issues.push("IFSC invalid");
  if (!accountName) issues.push("Beneficiary name missing");

  const warnings: string[] = [];
  if (accountName && accountName !== typedName.replace(/\s+/g, " ")) {
    warnings.push(`Name sent to the bank as "${accountName}"`);
  }
  return {
    ...(warnings.length ? { warnings } : {}),
    staffId: line.staffId,
    empCode: line.empCode,
    fullName: line.fullName,
    amount,
    accountNo,
    ifsc,
    accountName,
    bankName,
    paymentMode: line.paymentMode || "bank_transfer",
    paymentDate: line.paymentDate || "",
    remark: `Salary ${month} ${line.empCode}`.slice(0, 30),
    ok: issues.length === 0,
    issues,
  };
}

/**
 * Before a file goes to the bank: is every run in it still unpaid on the
 * SERVER? The preview is built from this browser's copy of payroll; a run
 * marked paid on another device since this tab loaded would otherwise be
 * paid twice. Missing on the server is a refusal too (unknown ≠ unpaid).
 * Pure — the caller fetches the server's runs.
 */
export function bankFileServerConflicts(
  preview: Pick<BankExportPreview, "runs" | "rows" | "month">,
  serverRuns: Pick<PayrollRun, "id" | "status" | "month" | "academicYearCode" | "lines">[],
): string[] {
  const out: string[] = [];
  const byId = new Map(serverRuns.map((r) => [r.id, r]));
  const fileStaff = new Set(preview.rows.filter((r) => r.ok).map((r) => r.staffId));
  for (const run of preview.runs) {
    const server = byId.get(run.id);
    if (!server) {
      out.push(`Run ${run.month} (${run.id.slice(-6)}) is not on the server`);
      continue;
    }
    if (server.status === "paid" && run.status !== "paid") {
      out.push(`Run ${run.month} (${run.id.slice(-6)}) was marked paid on the server`);
    }
  }
  const fileRunIds = new Set(preview.runs.map((r) => r.id));
  for (const server of serverRuns) {
    if (server.status !== "paid" || fileRunIds.has(server.id) || server.month !== preview.month) continue;
    if (preview.runs[0] && server.academicYearCode !== preview.runs[0].academicYearCode) continue;
    const already = server.lines.filter((l) => fileStaff.has(l.staffId)).map((l) => `${l.empCode} ${l.fullName}`);
    if (already.length) out.push(`Already paid for ${preview.month} in another run: ${already.join(", ")}`);
  }
  return out;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** No commas anywhere in the bank's file; trimmed to a field's length. */
function ubiField(v: string, max: number): string {
  return String(v ?? "").replace(/[,"\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** A Union Bank account: digits only, at most 15 (the file's limit); its first five digits are the branch SOL ID. */
export function isUbiAccount(accountNo: string, ifsc: string): boolean {
  return /^UBIN/i.test(ifsc || "") && /^\d{5,15}$/.test(accountNo || "");
}

/**
 * Union Bank's own salary upload (the bank's "SALARY File Upload in CSV
 * Format", supplied by the school 14 Oct 2026):
 *   FILEHDR,<corporate id ≤32>,<file sequence no ≤6 digits, optional>
 *   <sol id = first 5 digits>,<debit a/c ≤15>,INR,DR,<total>,<remark ≤13>
 *   <sol id>,<credit a/c ≤15>,INR,CR,<amount>,<remark ≤13>   (one per staff)
 * No headings, no commas, credits sum to the debit, plain "CSV (MS-DOS)":
 * no byte-order mark, CRLF lines. It credits Union Bank accounts only (no
 * IFSC in the format) — anyone else is left out and named for NEFT.
 */
export function renderUbiSalaryUpload(
  preview: Pick<BankExportPreview, "month" | "debitAccountNo" | "debitCorporateId">,
  rows: BankExportRow[],
  fileSequence = "",
): { ok: true; content: string; included: BankExportRow[]; otherBank: BankExportRow[] } | { ok: false; error: string } {
  const debit = (preview.debitAccountNo || "").replace(/\s+/g, "");
  if (!/^\d{5,15}$/.test(debit)) {
    return { ok: false, error: "Enter the school's Union Bank salary a/c (digits only, up to 15) in Masters → Salary setup" };
  }
  const corp = ubiField(preview.debitCorporateId, 32);
  if (!corp) return { ok: false, error: "Enter the Union Bank Corporate ID in Masters → Salary setup" };
  const seq = (fileSequence || "").trim();
  if (seq && !/^\d{1,6}$/.test(seq)) return { ok: false, error: "File sequence number: up to 6 digits" };
  const included = rows.filter((r) => isUbiAccount(r.accountNo, r.ifsc));
  const otherBank = rows.filter((r) => !isUbiAccount(r.accountNo, r.ifsc));
  if (included.length === 0) return { ok: false, error: "No staff with a Union Bank account in this month's file — use a NEFT format" };
  const [y, m] = preview.month.split("-");
  const mon = MONTHS[Number(m) - 1] ?? "";
  const total = included.reduce((sum, r) => sum + r.amount, 0);
  const lines = [
    ["FILEHDR", corp, seq],
    [debit.slice(0, 5), debit, "INR", "DR", String(total), ubiField(`SAL ${mon} ${y}`, 13)],
    ...included.map((r) => [
      r.accountNo.slice(0, 5),
      r.accountNo,
      "INR",
      "CR",
      String(r.amount),
      ubiField(`SAL ${mon}${(y || "").slice(2)} ${r.empCode}`, 13),
    ]),
  ];
  return { ok: true, content: lines.map((l) => l.join(",")).join("\r\n") + "\r\n", included, otherBank };
}

export function renderBankFile(
  preview: BankExportPreview,
  format: BankFileFormat,
  onlyReady = true,
  opts: { fileSequence?: string } = {},
): { ok: true; content: string; filename: string; count: number; total: number; otherBank?: BankExportRow[] }
  | { ok: false; error: string } {
  const rows = onlyReady ? preview.rows.filter((r) => r.ok) : preview.rows;
  if (rows.length === 0) {
    return {
      ok: false,
      error: onlyReady
        ? "No rows ready — fix missing bank A/c / IFSC on staff profiles"
        : "No payable bank lines for this month",
    };
  }
  if (format === "ubi_salary_upload") {
    const u = renderUbiSalaryUpload(preview, rows, opts.fileSequence);
    if (!u.ok) return u;
    return {
      ok: true,
      content: u.content,
      filename: `salary_ubi_${preview.month}.csv`,
      count: u.included.length,
      total: u.included.reduce((sum, r) => sum + r.amount, 0),
      otherBank: u.otherBank,
    };
  }
  if (
    !preview.debitAccountNo &&
    (format === "sbi_corporate" ||
      format === "hdfc_bulk" ||
      format === "ubi_neft")
  ) {
    return {
      ok: false,
      error:
        "Enter your Union Bank salary a/c number in Masters → Salary setup (IFSC UBIN0548847 is prefilled)",
    };
  }

  let content = "";
  switch (format) {
    case "ubi_neft":
      content = csvLines([
        [
          "Debit Account Number",
          "Debit IFSC",
          "Beneficiary Account Number",
          "Beneficiary IFSC",
          "Beneficiary Name",
          "Amount",
          "Payment Type",
          "Remarks",
          "Emp Code",
        ],
        ...rows.map((r) => [
          preview.debitAccountNo,
          preview.debitIfsc || SCHOOL_SALARY_BANK.ifsc,
          r.accountNo,
          r.ifsc,
          r.accountName,
          String(r.amount),
          "NEFT",
          r.remark,
          r.empCode,
        ]),
      ]);
      break;
    case "generic_neft":
      content = csvLines([
        [
          "Beneficiary Name",
          "Account Number",
          "IFSC",
          "Amount",
          "Payment Type",
          "Remarks",
          "Emp Code",
          "Bank Name",
        ],
        ...rows.map((r) => [
          r.accountName,
          r.accountNo,
          r.ifsc,
          String(r.amount),
          "NEFT",
          r.remark,
          r.empCode,
          r.bankName,
        ]),
      ]);
      break;
    case "sbi_corporate":
      content = csvLines([
        [
          "Beneficiary Account Number",
          "IFSC",
          "Beneficiary Name",
          "Amount",
          "Debit Account Number",
          "Remarks",
        ],
        ...rows.map((r) => [
          r.accountNo,
          r.ifsc,
          r.accountName,
          String(r.amount),
          preview.debitAccountNo,
          r.remark,
        ]),
      ]);
      break;
    case "hdfc_bulk":
      content = csvLines([
        [
          "Transaction Type",
          "Beneficiary Code",
          "Beneficiary Account Number",
          "Instrument Amount",
          "Beneficiary Name",
          "IFSC",
          "Debit Account",
          "Payment Date",
          "Remarks",
        ],
        ...rows.map((r) => [
          "N",
          r.empCode,
          r.accountNo,
          String(r.amount),
          r.accountName,
          r.ifsc,
          preview.debitAccountNo,
          r.paymentDate || `${preview.month}-01`,
          r.remark,
        ]),
      ]);
      break;
    case "icici_bulk":
      content = csvLines([
        [
          "Payment Type",
          "Beneficiary Account Number",
          "Beneficiary Name",
          "IFSC Code",
          "Amount",
          "Narration",
          "Customer Reference No",
        ],
        ...rows.map((r) => [
          "NEFT",
          r.accountNo,
          r.accountName,
          r.ifsc,
          String(r.amount),
          r.remark,
          r.empCode,
        ]),
      ]);
      break;
    default:
      return { ok: false, error: "Unknown format" };
  }

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const filename = `salary_bank_${format}_${preview.month}.csv`;
  return { ok: true, content, filename, count: rows.length, total };
}

export function downloadBankFile(
  preview: BankExportPreview,
  format: BankFileFormat,
  opts: { fileSequence?: string } = {},
): { ok: true; message: string } | { ok: false; error: string } {
  const built = renderBankFile(preview, format, true, opts);
  if (!built.ok) return built;
  downloadTextFile(built.filename, built.content);
  const others = built.otherBank?.length
    ? ` · NOT in this file (other banks — pay by NEFT): ${built.otherBank.map((r) => `${r.empCode} ${r.fullName}`).join(", ")}`
    : "";
  return {
    ok: true,
    message: `Downloaded ${built.filename}: ${built.count} credits · ${formatInr(built.total)}${others}`,
  };
}

/**
 * Download only after the server confirms nothing in the file is already
 * paid (bankFileServerConflicts). If the server cannot be asked, the file is
 * not made — a bank file is money, and "could not check" is not "unpaid".
 * Without a database (offline build) there is no server to ask.
 */
export async function downloadBankFileChecked(
  preview: BankExportPreview,
  format: BankFileFormat,
  opts: { fileSequence?: string } = {},
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const { fetchPayrollDeskFromApi, payrollNormalizedSyncEnabled } = await import("@/lib/payrollNormalizedClient");
  if (payrollNormalizedSyncEnabled()) {
    const remote = await fetchPayrollDeskFromApi();
    if (!remote) {
      return { ok: false, error: "Could not check payroll with the server, so the bank file was NOT made. Check the connection and try again." };
    }
    const conflicts = bankFileServerConflicts(preview, remote.bundle.runs);
    if (conflicts.length) {
      return {
        ok: false,
        error: `Bank file NOT made — the server's payroll differs from this screen: ${conflicts.join("; ")}. Reload the page and check before paying.`,
      };
    }
  }
  return downloadBankFile(preview, format, opts);
}

export function downloadBankExceptionReport(
  preview: BankExportPreview,
): { ok: true; message: string } | { ok: false; error: string } {
  const blocked = preview.rows.filter((r) => !r.ok);
  if (blocked.length === 0) {
    return { ok: false, error: "No exceptions — all rows are bank-ready" };
  }
  const content = csvLines([
    ["Emp Code", "Name", "Payable ₹", "Issues", "A/c", "IFSC"],
    ...blocked.map((r) => [
      r.empCode,
      r.fullName,
      String(r.amount),
      r.issues.join("; "),
      r.accountNo || "",
      r.ifsc || "",
    ]),
  ]);
  downloadTextFile(
    `salary_bank_exceptions_${preview.month}.csv`,
    content,
  );
  return {
    ok: true,
    message: `Exception list: ${blocked.length} staff need bank details`,
  };
}
