/**
 * Bank salary upload file — NEFT / bulk transfer from published payroll.
 * Uses staff bank details from Masters staff profile.
 */

import type { StaffRecord } from "@/lib/foundationMasters";
import type { MastersState } from "@/lib/masters";
import {
  downloadTextFile,
  formatInr,
  loadPayroll,
  type PayrollRun,
  type PayrollStaffLine,
  pickPayslipRun,
} from "@/lib/payroll";
import {
  loadSalarySetup,
  normalizeSalarySettings,
  SCHOOL_SALARY_BANK,
} from "@/lib/salarySetup";

export type BankFileFormat =
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
    value: "ubi_neft",
    label: "Union Bank NEFT (recommended)",
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
};

export type BankExportPreview = {
  month: string;
  run: PayrollRun | null;
  rows: BankExportRow[];
  totalAmount: number;
  readyCount: number;
  blockedCount: number;
  debitAccountNo: string;
  debitIfsc: string;
  debitBankName: string;
  debitBranch: string;
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
  let run = pickPayslipRun(runs, input.month, input.academicYearCode);

  if (input.requirePosted !== false && run) {
    if (run.status !== "posted" && run.status !== "paid") {
      // Prefer posted/paid only when available; else fall through if nothing better
      const better = runs.find(
        (r) =>
          r.month === input.month &&
          r.academicYearCode === input.academicYearCode &&
          (r.status === "posted" || r.status === "paid"),
      );
      run = better || null;
    }
  }

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
  if (run) {
    for (const line of run.lines) {
      const mode = line.paymentMode || "bank_transfer";
      if (modeFilter && !modeFilter.has(mode as "bank_transfer" | "upi")) {
        continue;
      }
      const amount = Math.round(line.amountPayable ?? line.netPay);
      if (amount <= 0) continue;

      const staff = staffById.get(line.staffId);
      rows.push(buildRow(line, staff, amount, input.month));
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
    rows,
    totalAmount,
    readyCount,
    blockedCount,
    debitAccountNo: settings.salaryBankAccountNo.trim(),
    debitIfsc: settings.salaryBankIfsc.trim().toUpperCase(),
    debitBankName: settings.salaryBankName.trim(),
    debitBranch: settings.salaryBankBranch.trim(),
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
  const accountName = (
    staff?.bankAccountName ||
    staff?.fullName ||
    line.fullName
  ).trim();
  const bankName = (staff?.bankName || "").trim();
  const issues: string[] = [];
  if (!staff) issues.push("Staff profile missing");
  if (!accountNo) issues.push("Bank a/c missing");
  if (accountNo && accountNo.length < 6) issues.push("A/c too short");
  if (!ifsc) issues.push("IFSC missing");
  else if (!ifscOk(ifsc)) issues.push("IFSC invalid");
  if (!accountName) issues.push("Beneficiary name missing");

  return {
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

export function renderBankFile(
  preview: BankExportPreview,
  format: BankFileFormat,
  onlyReady = true,
): { ok: true; content: string; filename: string; count: number; total: number }
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
): { ok: true; message: string } | { ok: false; error: string } {
  const built = renderBankFile(preview, format, true);
  if (!built.ok) return built;
  downloadTextFile(built.filename, built.content);
  return {
    ok: true,
    message: `Downloaded ${built.filename}: ${built.count} credits · ${formatInr(built.total)}`,
  };
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
