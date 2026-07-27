/**
 * Import BHB "Inventory Payment Report" (PDF text) → fee collection vouchers
 * with per-head break-up and concession analysis vs published fee structure.
 */

import {
  buildVoucherLinesFromImport,
  relinkImportedPaymentsToStudentDues,
} from "@/lib/paymentReportDueAllocation";
import {
  dueKeyForImportedLine,
  enrichLinesWithPdfConcession,
  isDailyCollectionReport,
  lineLabelForScope,
  normAdmissionNo,
  parseDailyCollectionReport,
  parseReceiptScope,
  scopeForImportedHead,
  type ParsedReceiptScope,
} from "@/lib/dailyCollectionReportImport";
import type { CollectionVoucher, FeesState, VoucherLine, VoucherTender } from "@/lib/fees";
import { DEFAULT_AY } from "@/lib/masters";
import type { MastersState } from "@/lib/masters";
import type { SisState, SisStudent } from "@/lib/sis";

export type ParsedReceiptLine = {
  headLabel: string;
  headCode: string;
  /** Cash collected for this fee head (PDF column value = Paid share). */
  amountRupees: number;
  /** This head's share of the receipt Concession column (₹). */
  concessionRupees?: number;
  /** Gross before concession = amountRupees + concessionRupees. */
  billedRupees?: number;
};

export type PaymentReceiptCategory =
  | "fee"
  | "registration"
  | "store"
  | "city_office"
  | "other";

export type ParsedPaymentReceipt = {
  srNo: number;
  legacyReceiptNo: string;
  ledger: string;
  paymentDate: string;
  narration: string;
  studentName: string | null;
  category: PaymentReceiptCategory;
  note: string;
  paperReceiptNo: string;
  totalRupees: number;
  lines: ParsedReceiptLine[];
  /** Daily collection report — admission no e.g. BHB-22/2023 */
  admissionNo?: string;
  /** Raw receipt note e.g. "April Fee", "Previous_Due(2025-2026) to April Fee" */
  receiptNote?: string;
  /** Concession column from daily collection report (₹) */
  receiptConcessionRupees?: number;
  /** Amount / Payable column — gross before concession (₹) */
  grossAmountRupees?: number;
  /** Due column — balance still owed on this receipt after partial pay (₹) */
  receiptBalanceDueRupees?: number;
};

export type ConcessionAnalysisRow = {
  legacyReceiptNo: string;
  paymentDate: string;
  studentName: string;
  headLabel: string;
  headCode: string;
  collectedRupees: number;
  expectedRupees: number;
  concessionRupees: number;
  reason: "structure" | "note" | "header_gap";
  note: string;
};

export type PaymentImportSummary = {
  totalReceipts: number;
  feeReceipts: number;
  skippedReceipts: number;
  totalCollectedRupees: number;
  byHead: { headCode: string; headLabel: string; collectedRupees: number }[];
  concessions: ConcessionAnalysisRow[];
  concessionTotalRupees: number;
};

const PAGE_BREAK = /^--\s*\d+\s+of\s+\d+\s*--$/;
const FEE_HEAD_LINE =
  /^(Tuition Fees|Transport|Previous Due-\d{4}|Miscellaneous Fee|Communication Fee|Amenity Fees|Examination Fee|Registration Fee|Security Deposit Fee|WaterPark|Welfare|TC|BELT|TIE)\s+([\d,]+\.\d{2})$/i;

const HEAD_LABEL_TO_CODE: Record<string, string> = {
  "tuition fees": "TUITION",
  transport: "TRANSPORT",
  "miscellaneous fee": "MISC",
  "communication fee": "COMMUNICATION",
  "amenity fees": "AMENITY",
  "examination fee": "EXAM",
  "registration fee": "ADMISSION",
  "security deposit fee": "SECURITY",
  waterpark: "SPECIAL",
  welfare: "WELFARE",
  tc: "CERT",
  belt: "STORE",
  tie: "STORE",
};

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

const MONTH_TO_INST: Record<string, string> = {
  january: "JAN",
  february: "FEB",
  march: "MAR",
  april: "APR",
  may: "MAY",
  june: "JUN",
  july: "JUL",
  august: "AUG",
  september: "SEP",
  october: "OCT",
  november: "NOV",
  december: "DEC",
};

function parseRupees(s: string): number {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parsePdfDate(s: string): string {
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return s;
  const months: Record<string, string> = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12",
  };
  const mm = months[m[2]!] ?? "01";
  const dd = m[1]!.padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

function headCodeFromLabel(label: string): string {
  const key = label.trim().toLowerCase();
  if (HEAD_LABEL_TO_CODE[key]) return HEAD_LABEL_TO_CODE[key]!;
  const prev = key.match(/^previous due-(\d{4})$/);
  if (prev) return "ARREARS";
  return key.replace(/\s+/g, "_").toUpperCase();
}

function normName(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

function extractStudentName(narration: string): string | null {
  const m =
    narration.match(/Fee Payment of\s+([^,]+)/i) ??
    narration.match(/Registration Payment of\s+([^,]+)/i);
  return m?.[1]?.trim() ?? null;
}

function extractNote(narration: string): string {
  const m = narration.match(/Note\s*-\s*(.*?)(?:,\s*SchoolReceiptNo|$)/i);
  return (m?.[1] ?? "").trim();
}

function extractPaperReceiptNo(narration: string): string {
  const m = narration.match(
    /SchoolReceiptNo\s*-\s*(?:School\s*Receipt\s*No\.?\s*)?(\d+)/i,
  );
  return m?.[1]?.trim() ?? "";
}

function receiptCategory(narration: string): PaymentReceiptCategory {
  const n = narration.toLowerCase();
  if (n.includes("fee payment of")) return "fee";
  if (n.includes("registration payment of")) return "registration";
  if (n.startsWith("city office")) return "city_office";
  if (
    n.includes("system receipt entry") ||
    n.includes("sale due payment") ||
    n.includes("sale invoice")
  ) {
    return "store";
  }
  return "other";
}

function isDiscountNote(note: string): boolean {
  return /discount|deducted|waived|not taken|rte|relaxed|ordered by principal/i.test(
    note,
  );
}

/** Join PDF lines split across rows (e.g. "Beena" + "Singh 06-May-2026 ..."). */
function normalizeReportLines(text: string): string[] {
  const raw = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !PAGE_BREAK.test(l));

  const out: string[] = [];
  let buf = "";

  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  };

  for (const line of raw) {
    if (
      line.startsWith("BHB International") ||
      line.startsWith("Inventory Payment Report") ||
      line.startsWith("From ") ||
      line === "Sr" ||
      line === "No." ||
      line.startsWith("Receipt") ||
      line.startsWith("Payment Summary") ||
      line === "Sr No. Ledger Amount" ||
      line.startsWith("Total ") ||
      /^Ledger Payment Date/.test(line)
    ) {
      continue;
    }

    const isHeaderStart = /^\d+\s+\d+\s+(UPI|Cash)\s+/.test(line);
    const isBrokenHeader =
      /^\d+\s+\d+\s+[A-Za-z]/.test(line) && !/\d{1,2}-[A-Za-z]{3}-\d{4}/.test(line);

    if (isHeaderStart) {
      flush();
      buf = line;
      continue;
    }

    if (isBrokenHeader) {
      flush();
      buf = line;
      continue;
    }

    if (buf && /\d{1,2}-[A-Za-z]{3}-\d{4}/.test(line)) {
      buf = `${buf} ${line}`;
      flush();
      continue;
    }

    if (buf && !FEE_HEAD_LINE.test(line) && !/^\d+\s+\d+\s+/.test(line)) {
      buf = `${buf} ${line}`;
      continue;
    }

    flush();
    out.push(line);
  }
  flush();
  return out;
}

function parseHeaderLine(line: string): Omit<ParsedPaymentReceipt, "lines"> | null {
  const m = line.match(
    /^(\d+)\s+(\d+)\s+(UPI|Cash)\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s+(.+)$/,
  );
  if (!m) return null;

  const amtM = m[5]!.match(/([\d,]+\.\d{2})\s*$/);
  if (!amtM) return null;

  const narration = m[5]!.slice(0, m[5]!.length - amtM[0]!.length).trim();
  const category = receiptCategory(narration);
  const studentName = extractStudentName(narration);

  return {
    srNo: Number(m[1]),
    legacyReceiptNo: m[2]!,
    ledger: m[3]!,
    paymentDate: parsePdfDate(m[4]!),
    narration,
    studentName,
    category,
    note: extractNote(narration),
    paperReceiptNo: extractPaperReceiptNo(narration),
    totalRupees: parseRupees(amtM[1]!),
  };
}

function parseFeeHeadLine(line: string): ParsedReceiptLine | null {
  const m = line.match(FEE_HEAD_LINE);
  if (!m) return null;
  const headLabel = m[1]!.replace(/\s+/g, " ").trim();
  const amountRupees = parseRupees(m[2]!);
  return {
    headLabel,
    headCode: headCodeFromLabel(headLabel),
    amountRupees,
  };
}

/** Auto-detect inventory vs daily collection report format. */
export function parsePaymentReportText(text: string): ParsedPaymentReceipt[] {
  if (isDailyCollectionReport(text)) {
    return parseDailyCollectionReport(text);
  }
  return parseInventoryPaymentReport(text);
}

/** Parse extracted PDF/plain-text payment report. */
export function parseInventoryPaymentReport(
  text: string,
): ParsedPaymentReceipt[] {
  const lines = normalizeReportLines(text);
  const receipts: ParsedPaymentReceipt[] = [];
  let current: ParsedPaymentReceipt | null = null;

  for (const line of lines) {
    const header = parseHeaderLine(line);
    if (header) {
      if (current) receipts.push(current);
      current = { ...header, lines: [] };
      continue;
    }

    const headLine = parseFeeHeadLine(line);
    if (headLine && current) {
      current.lines.push(headLine);
      continue;
    }

    if (/^Payment Summary/i.test(line)) break;
  }

  if (current) receipts.push(current);
  return receipts;
}

export function summarizeParsedReceipts(rows: ParsedPaymentReceipt[]): {
  totalReceipts: number;
  feeReceipts: number;
  totalRupees: number;
  byHead: Map<string, { label: string; rupees: number }>;
} {
  const byHead = new Map<string, { label: string; rupees: number }>();
  let feeReceipts = 0;
  let totalRupees = 0;

  for (const r of rows) {
    totalRupees += r.totalRupees;
    if (r.category === "fee" || r.category === "registration") feeReceipts += 1;
    for (const l of r.lines) {
      const prev = byHead.get(l.headCode) ?? { label: l.headLabel, rupees: 0 };
      prev.rupees += l.amountRupees;
      byHead.set(l.headCode, prev);
    }
  }

  return { totalReceipts: rows.length, feeReceipts, totalRupees, byHead };
}

function findStudentByName(
  sis: SisState,
  name: string,
  ay?: string,
): SisStudent | undefined {
  const n = normName(name);
  const pool = sis.students.filter((s) => !ay || s.academicYearCode === ay);
  const exact = pool.find((s) => normName(s.fullName) === n);
  if (exact) return exact;

  return pool.find((s) => {
    const sn = normName(s.fullName);
    return sn.includes(n) || n.includes(sn);
  });
}

function findStudentByAdmission(
  sis: SisState,
  admissionNo: string,
  ay?: string,
): SisStudent | undefined {
  const key = normAdmissionNo(admissionNo);
  if (!key) return undefined;
  const pool = sis.students.filter((s) => !ay || s.academicYearCode === ay);
  const exact = pool.find((s) => normAdmissionNo(s.admissionNo) === key);
  if (exact) return exact;
  const plain = key.replace(/^BHB-/, "");
  return pool.find((s) => {
    const adm = normAdmissionNo(s.admissionNo);
    return adm === key || adm.endsWith(plain) || adm.includes(plain);
  });
}

function resolveStudent(
  sis: SisState,
  r: ParsedPaymentReceipt,
  ay?: string,
): SisStudent | undefined {
  if (r.admissionNo) {
    const byAdm = findStudentByAdmission(sis, r.admissionNo, ay);
    if (byAdm) return byAdm;
  }
  if (r.studentName) return findStudentByName(sis, r.studentName, ay);
  return undefined;
}

function receiptScope(r: ParsedPaymentReceipt): ParsedReceiptScope {
  if (r.receiptNote != null) return parseReceiptScope(r.receiptNote);
  return parseReceiptScope(r.narration);
}

function installmentCodesFromNarration(narration: string): string[] | null {
  const lower = narration.toLowerCase();
  if (lower.includes("previous_due") || lower.includes("previous due")) {
    return null;
  }

  const range = lower.match(/(\w+)\s+fee\s+to\s+(\w+)\s+fee/);
  if (range) {
    const start = MONTH_NAMES.indexOf(range[1]! as (typeof MONTH_NAMES)[number]);
    const end = MONTH_NAMES.indexOf(range[2]! as (typeof MONTH_NAMES)[number]);
    if (start >= 0 && end >= 0) {
      const codes: string[] = [];
      if (start <= end) {
        for (let i = start; i <= end; i++) {
          const code = MONTH_TO_INST[MONTH_NAMES[i]!];
          if (code) codes.push(code);
        }
      } else {
        for (let i = start; i < MONTH_NAMES.length; i++) {
          const code = MONTH_TO_INST[MONTH_NAMES[i]!];
          if (code) codes.push(code);
        }
        for (let i = 0; i <= end; i++) {
          const code = MONTH_TO_INST[MONTH_NAMES[i]!];
          if (code) codes.push(code);
        }
      }
      return codes.length ? codes : null;
    }
  }

  for (const month of MONTH_NAMES) {
    if (lower.includes(`${month} fee`)) {
      const code = MONTH_TO_INST[month];
      return code ? [code] : null;
    }
  }
  return null;
}

function expectedByHeadFromStructure(
  masters: MastersState,
  feeGroupId: string,
  months: string[] | null,
): Map<string, number> {
  const out = new Map<string, number>();
  const headCodeById = new Map(
    (masters.feeHeads ?? []).map((h) => [h.id, h.code.toUpperCase()]),
  );
  const instCodeById = new Map(
    (masters.installments ?? []).map((i) => [i.id, i.code.toUpperCase()]),
  );

  const lines = (masters.feeStructureLines ?? []).filter(
    (l) => l.feeGroupId === feeGroupId,
  );

  for (const line of lines) {
    const headCode = headCodeById.get(line.feeHeadId);
    if (!line.installmentId) continue;
    const instCode = instCodeById.get(line.installmentId);
    if (!headCode || !instCode) continue;
    const rupees = line.amountPaise / 100;

    if (headCode === "TUITION") {
      if (!months?.length) continue;
      if (months.includes(instCode)) {
        out.set(headCode, (out.get(headCode) ?? 0) + rupees);
      }
      continue;
    }

    if (headCode === "TRANSPORT") continue;

    if (instCode === "APR" || months?.includes(instCode)) {
      out.set(headCode, (out.get(headCode) ?? 0) + rupees);
    }
  }

  return out;
}

export function analyzeConcessions(input: {
  receipts: ParsedPaymentReceipt[];
  sis: SisState;
  masters: MastersState;
  academicYearCode?: string;
}): ConcessionAnalysisRow[] {
  const rows: ConcessionAnalysisRow[] = [];

  for (const r of input.receipts) {
    if (r.category !== "fee" && r.category !== "registration") continue;
    const studentLabel =
      r.admissionNo ?? r.studentName ?? r.legacyReceiptNo;

    for (const line of r.lines) {
      const conc = line.concessionRupees ?? 0;
      if (conc <= 0) continue;
      rows.push({
        legacyReceiptNo: r.legacyReceiptNo,
        paymentDate: r.paymentDate,
        studentName: studentLabel,
        headLabel: line.headLabel,
        headCode: line.headCode,
        collectedRupees: line.amountRupees,
        expectedRupees: line.billedRupees ?? line.amountRupees + conc,
        concessionRupees: conc,
        reason: "note",
        note: r.receiptNote || r.note,
      });
    }

    if ((r.receiptBalanceDueRupees ?? 0) > 0) {
      rows.push({
        legacyReceiptNo: r.legacyReceiptNo,
        paymentDate: r.paymentDate,
        studentName: studentLabel,
        headLabel: "(receipt balance due)",
        headCode: "RECEIPT_DUE",
        collectedRupees: r.totalRupees,
        expectedRupees: r.grossAmountRupees ?? r.totalRupees,
        concessionRupees: 0,
        reason: "header_gap",
        note: `PDF Due column ₹${r.receiptBalanceDueRupees}`,
      });
    }
  }

  return rows;
}

function legacyImportId(receiptNo: string, series: "INV" | "DC" = "INV") {
  return `imp_${series.toLowerCase()}_${receiptNo}`;
}

function isLegacyReceiptImported(
  fees: FeesState,
  legacyReceiptNo: string,
  series: "INV" | "DC" = "INV",
) {
  return fees.vouchers.some(
    (v) =>
      v.id === legacyImportId(legacyReceiptNo, series) ||
      (v.manualBookSeries === series && v.manualBookLeaf === legacyReceiptNo),
  );
}

function dueKindForHead(code: string): VoucherLine["kind"] {
  if (code === "ARREARS") return "arrears";
  if (code === "TRANSPORT") return "transport";
  if (code === "STORE" || code === "SPECIAL") return "special";
  return "academic";
}

function tenderMode(ledger: string): VoucherTender["mode"] {
  return ledger.toLowerCase() === "cash" ? "cash" : "upi";
}

export function applyPaymentReportImport(input: {
  fees: FeesState;
  sis: SisState;
  masters: MastersState;
  receipts: ParsedPaymentReceipt[];
  academicYearCode?: string;
  importedBy?: string;
  includeRegistration?: boolean;
}): {
  fees: FeesState;
  imported: number;
  skipped: number;
  unmatched: string[];
  summary: PaymentImportSummary;
  relink: {
    relinkedVouchers: number;
    relinkedLines: number;
    stillLegacy: number;
  };
} {
  const ay = input.academicYearCode ?? DEFAULT_AY;
  const includeReg = input.includeRegistration ?? true;
  let fees = input.fees;
  let imported = 0;
  let skipped = 0;
  const unmatched: string[] = [];

  const feeReceipts = input.receipts.filter((r) => {
    if (r.category === "fee") return true;
    if (includeReg && r.category === "registration") return true;
    return false;
  });

  for (const r of feeReceipts) {
    const bookSeries: "INV" | "DC" = r.admissionNo ? "DC" : "INV";
    if (isLegacyReceiptImported(fees, r.legacyReceiptNo, bookSeries)) {
      skipped += 1;
      continue;
    }
    if (r.lines.length === 0) {
      skipped += 1;
      continue;
    }

    const student = resolveStudent(input.sis, r, ay);
    const displayName =
      student?.fullName ?? r.studentName ?? r.admissionNo ?? "Unknown";

    if ((r.admissionNo || r.studentName) && !student) {
      unmatched.push(
        `${r.legacyReceiptNo}: ${r.admissionNo ?? ""} ${r.studentName ?? ""}`.trim(),
      );
    }

    const householdId = student?.householdId ?? "hh_unknown";
    const lineSum = r.lines.reduce((s, l) => s + l.amountRupees, 0);
    const totalPaise = Math.round(
      (lineSum > 0 ? lineSum : r.totalRupees) * 100,
    );

    const receiptNote = r.receiptNote ?? r.note ?? "";
    const lines =
      r.receiptConcessionRupees != null && r.lines.every((l) => l.concessionRupees == null)
        ? enrichLinesWithPdfConcession(r.lines, r.receiptConcessionRupees)
        : r.lines;

    const voucherLines = buildVoucherLinesFromImport({
      student,
      masters: input.masters,
      fees,
      lines,
      receiptNote,
      fallback: (l, idx) => {
        const headScope = scopeForImportedHead(l.headCode, receiptNote);
        const concRupees = l.concessionRupees ?? 0;
        const amountPaise = Math.round(l.amountRupees * 100);
        const concessionPaise = Math.round(concRupees * 100);
        const billedPaise = Math.round(
          (l.billedRupees ?? l.amountRupees + concRupees) * 100,
        );

        return {
          dueKey: dueKeyForImportedLine({
            admissionNo: r.admissionNo ?? student?.admissionNo ?? "",
            legacyReceiptNo: r.legacyReceiptNo,
            headCode: l.headCode,
            lineIndex: idx,
            scope: headScope,
          }),
          studentId: student?.id ?? "",
          studentName: displayName,
          label: lineLabelForScope(l.headLabel, l.headCode, headScope),
          kind: dueKindForHead(l.headCode),
          amountPaise,
          billedPaise,
          concessionPaise,
          concessionDetails:
            concessionPaise > 0
              ? [
                  {
                    grantId: "",
                    concessionId: "",
                    code: "pdf_concession",
                    name: "Concession (PDF)",
                    kind: "import",
                    rateLabel: headScope.label,
                    siblingLabel: "",
                    amountPaise: concessionPaise,
                  },
                ]
              : [],
        };
      },
    });

    const tenders: VoucherTender[] = [
      {
        mode: tenderMode(r.ledger),
        amountPaise: totalPaise,
        ref: r.legacyReceiptNo,
        instrumentDate: r.paymentDate,
        bankName: "",
        realisation: "cleared",
      },
    ];

    const noteParts = [
      bookSeries === "DC"
        ? `DC #${r.legacyReceiptNo}`
        : `INV #${r.legacyReceiptNo}`,
      r.admissionNo ? `Adm ${r.admissionNo}` : "",
      receiptNote ? `Note: ${receiptNote}` : "",
      r.receiptConcessionRupees
        ? `Concession ₹${r.receiptConcessionRupees}`
        : "",
      r.grossAmountRupees
        ? `Gross ₹${r.grossAmountRupees} · Paid ₹${r.totalRupees}`
        : "",
      (r.receiptBalanceDueRupees ?? 0) > 0
        ? `Receipt due ₹${r.receiptBalanceDueRupees}`
        : "",
    ].filter(Boolean);

    const voucher: CollectionVoucher = {
      id: legacyImportId(r.legacyReceiptNo, bookSeries),
      receiptNo: `F/${bookSeries}-${r.legacyReceiptNo}`,
      schoolReceiptNo: r.paperReceiptNo || r.legacyReceiptNo,
      source: "manual_book",
      manualBookSeries: bookSeries,
      manualBookLeaf: r.legacyReceiptNo,
      householdId,
      academicYearCode: ay,
      collectionDate: r.paymentDate,
      transactionDate: r.paymentDate,
      transactionId: `legacy-inv-${r.legacyReceiptNo}`,
      collectedAt: new Date(`${r.paymentDate}T12:00:00`).toISOString(),
      cashierName: r.ledger,
      lines: voucherLines,
      tenders,
      totalPaise,
      note: noteParts.join(" · "),
      voidedAt: null,
      whatsappSentAt: null,
    };

    fees = { ...fees, vouchers: [...fees.vouchers, voucher] };
    imported += 1;
  }

  const relink = relinkImportedPaymentsToStudentDues({
    fees,
    sis: input.sis,
    masters: input.masters,
    academicYearCode: ay,
  });
  fees = relink.fees;

  const parsedSummary = summarizeParsedReceipts(feeReceipts);
  const concessions = analyzeConcessions({
    receipts: feeReceipts,
    sis: input.sis,
    masters: input.masters,
    academicYearCode: ay,
  });

  const summary: PaymentImportSummary = {
    totalReceipts: input.receipts.length,
    feeReceipts: feeReceipts.length,
    skippedReceipts: skipped,
    totalCollectedRupees: parsedSummary.totalRupees,
    byHead: [...parsedSummary.byHead.entries()].map(([headCode, v]) => ({
      headCode,
      headLabel: v.label,
      collectedRupees: v.rupees,
    })),
    concessions,
    concessionTotalRupees: concessions.reduce(
      (s, c) => s + c.concessionRupees,
      0,
    ),
  };

  return { fees, imported, skipped, unmatched, summary, relink };
}

export function formatPaymentImportSummary(
  summary: PaymentImportSummary,
  imported?: number,
): string {
  const headLines = summary.byHead
    .sort((a, b) => b.collectedRupees - a.collectedRupees)
    .map((h) => `  ${h.headLabel}: ₹${h.collectedRupees.toLocaleString("en-IN")}`)
    .join("\n");

  const concLines = summary.concessions
    .filter((c) => c.concessionRupees > 0)
    .slice(0, 15)
    .map(
      (c) =>
        `  #${c.legacyReceiptNo} ${c.studentName} · ${c.headLabel}: ₹${c.concessionRupees} off`,
    )
    .join("\n");

  return [
    imported != null
      ? `Posted ${imported} new voucher(s) · skipped ${summary.skippedReceipts}`
      : `Fee receipts in file: ${summary.feeReceipts} · skipped ${summary.skippedReceipts}`,
    `Total collected: ₹${summary.totalCollectedRupees.toLocaleString("en-IN")}`,
    `Concession (PDF): ₹${summary.concessionTotalRupees.toLocaleString("en-IN")}`,
    "By fee head:",
    headLines,
    concLines ? "Concessions (sample):" : "",
    concLines,
  ]
    .filter(Boolean)
    .join("\n");
}
