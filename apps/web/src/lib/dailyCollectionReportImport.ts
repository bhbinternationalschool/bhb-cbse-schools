/**
 * Parse BHB "Daily Collection" PDF export — per-student fee head columns,
 * receipt note (month / previous due), and concession from the report.
 */

import type { ParsedPaymentReceipt, ParsedReceiptLine } from "@/lib/inventoryPaymentReportImport";

const HEAD_CODES = [
  "AMENITY",
  "BELT",
  "COMMUNICATION",
  "EXAM",
  "MISC",
  "ARREARS",
  "ADMISSION",
  "CERT",
  "STORE_TIE",
  "TRANSPORT",
  "TUITION",
  "WATERPARK",
] as const;

const HEAD_LABELS: Record<(typeof HEAD_CODES)[number], string> = {
  AMENITY: "Amenity Fees",
  BELT: "BELT",
  COMMUNICATION: "Communication Fee",
  EXAM: "Examination Fee",
  MISC: "Miscellaneous Fee",
  ARREARS: "Previous Due-2025",
  ADMISSION: "Registration Fee",
  CERT: "TC",
  STORE_TIE: "TIE",
  TRANSPORT: "Transport",
  TUITION: "Tuition Fees",
  WATERPARK: "WaterPark",
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

export type PaymentScopeKind =
  | "monthly"
  | "arrears"
  | "mixed"
  | "registration"
  | "unknown";

export type ParsedReceiptScope = {
  kind: PaymentScopeKind;
  installmentCodes: string[];
  includesArrears: boolean;
  label: string;
};

export type DailyCollectionRow = ParsedPaymentReceipt & {
  admissionNo: string;
  receiptNote: string;
  receiptConcessionRupees: number;
  grossAmountRupees: number;
  receiptBalanceDueRupees: number;
  paymentScope: ParsedReceiptScope;
  paymentMode: string;
};

const PAGE_BREAK = /^--\s*\d+\s+of\s+\d+\s*--$/;
const ACADEMIC_YEAR_SPLIT = /2026-\s*2027/g;

const TAIL_RE =
  /(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)(?:\s+(\d{1,2}))?\s+(\d+)(?:\s+(\d{1,2}))?\s*$/;

function normSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function mergeSplitAmount(hi: number, lo: number | null, hint?: number): number {
  if (lo == null) return hi;
  const candidates = [hi * 100 + lo, hi * 10 + lo];
  const unique = [...new Set(candidates)];
  if (hint != null) {
    return unique.reduce((best, c) =>
      Math.abs(c - hint) < Math.abs(best - hint) ? c : best,
    );
  }
  return hi * 100 + lo;
}

function tailIsValid(
  heads: number[],
  amount: number,
  concession: number,
  payable: number,
): boolean {
  const sum = heads.reduce((s, n) => s + n, 0);
  if (sum + concession === amount) return true;
  if (sum === amount && concession === 0) return true;
  if (sum === payable - concession) return true;
  if (Math.abs(sum + concession - amount) <= 1) return true;
  if (Math.abs(sum - payable) <= 1) return true;
  return false;
}

type ParsedTail = {
  heads: number[];
  amount: number;
  concession: number;
  payable: number;
  paid: number;
  due: number;
};

function parseTailFromNumberRun(nums: number[]): ParsedTail | null {
  if (nums.length < 17) return null;
  for (let start = nums.length - 17; start >= 0; start -= 1) {
    const heads = nums.slice(start, start + 12);
    const amount = nums[start + 12]!;
    const concession = nums[start + 13]!;
    const payable = nums[start + 14]!;
    const paid = nums[start + 15]!;
    const due = nums[start + 16]!;
    if (!tailIsValid(heads, amount, concession, payable)) continue;
    if (paid < 0 || due < 0) continue;
    return { heads, amount, concession, payable, paid, due };
  }

  if (nums.length < 19) return null;
  for (let start = nums.length - 19; start >= 0; start -= 1) {
    const heads = nums.slice(start, start + 12);
    const amount = nums[start + 12]!;
    const concession = nums[start + 13]!;
    const payable = nums[start + 14]!;
    const paidHi = nums[start + 15]!;
    const paidLo = nums[start + 16]!;
    const dueHi = nums[start + 17]!;
    const dueLo = nums[start + 18]!;
    const paid = mergeSplitAmount(paidHi, paidLo, payable);
    const due = mergeSplitAmount(dueHi, dueLo, 0);
    if (!tailIsValid(heads, amount, concession, payable)) continue;
    if (paid < 0 || due < 0) continue;
    return { heads, amount, concession, payable, paid, due };
  }
  return null;
}

function parseTailFromChunk(chunk: string): ParsedTail | null {
  const s = normSpaces(chunk);
  const matches = [...s.matchAll(new RegExp(TAIL_RE.source, "g"))];
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!;
    const heads = Array.from({ length: 12 }, (_, j) => Number(m[j + 1]));
    const amount = Number(m[13]);
    const concession = Number(m[14]);
    const payable = Number(m[15]);
    const paidHi = Number(m[16]);
    const paidLo = m[17] != null ? Number(m[17]) : null;
    const dueHi = Number(m[18]);
    const dueLo = m[19] != null ? Number(m[19]) : null;
    const paid = mergeSplitAmount(paidHi, paidLo, payable);
    const due = mergeSplitAmount(dueHi, dueLo, 0);

    if (!tailIsValid(heads, amount, concession, payable)) continue;
    if (paid < 0 || due < 0) continue;
    return { heads, amount, concession, payable, paid, due };
  }

  const anchor = s.match(/DayScho\s*lar/i);
  const numericPart = anchor ? s.slice(anchor.index!) : s;
  const nums = [...numericPart.matchAll(/\d+/g)].map((m) => Number(m[0]));
  return parseTailFromNumberRun(nums);
}

export function normAdmissionNo(raw: string): string {
  const s = raw.trim().replace(/\s+/g, "").toUpperCase();
  if (!s) return "";
  if (s.startsWith("BHB-")) return s;
  if (/^\d{1,3}\/\d{4}$/.test(s)) return `BHB-${s}`;
  return s;
}

function extractAdmissionNo(chunk: string): string {
  const s = chunk.replace(/\s+/g, "").toUpperCase();
  const bhb = s.match(/BHB-\d+\/\d{4}/);
  if (bhb) return normAdmissionNo(bhb[0]);
  const plain = s.match(/\d{1,3}\/\d{4}/);
  if (plain) return normAdmissionNo(plain[0]);
  return "";
}

function extractReceiptMeta(chunk: string): {
  receiptNo: string;
  paymentDate: string;
  paymentMode: string;
} {
  const compact = chunk.replace(/\s+/g, " ");
  let receiptNo = "";
  let paymentDate = "";
  let paymentMode = "upi";

  const splitYear = compact.match(
    /(\d{4})\s+(\d{2}\/\d{2}\/\d{2})\s+(\d{2})\b/,
  );
  if (splitYear) {
    receiptNo = splitYear[1]!;
    paymentDate = normalizeSlashDate(`${splitYear[2]}/${splitYear[3]}`);
  } else {
    for (const m of compact.matchAll(/(\d{4})\s+(\d{2}\/\d{2}\/\d{4})/g)) {
      receiptNo = m[1]!;
      paymentDate = normalizeSlashDate(m[2]!);
    }
  }

  if (/\bCash\b/i.test(compact) || /Ca\s*sh/i.test(compact)) paymentMode = "cash";
  else if (/\bUPI\b/i.test(compact)) paymentMode = "upi";

  return { receiptNo, paymentDate, paymentMode };
}

function normalizeSlashDate(s: string): string {
  const split = s.match(/^(\d{2})\/(\d{2})\/(\d{2})\/(\d{2})$/);
  if (split) {
    return `20${split[4]}-${split[2]}-${split[1]}`;
  }
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return s;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function installmentCodesFromReceiptNote(note: string): string[] | null {
  const lower = note.replace(/\s+/g, " ").trim().toLowerCase();
  if (!lower) return null;
  if (lower.includes("previous_due") || lower.includes("previous due")) {
    const range = lower.match(/(\w+)\s+fee\s+to\s+(\w+)\s+fee/);
    if (range) {
      return monthRangeCodes(range[1]!, range[2]!);
    }
    return null;
  }

  const range = lower.match(/(\w+)\s+fee\s+to\s+(\w+)\s+fee/);
  if (range) return monthRangeCodes(range[1]!, range[2]!);

  for (const month of MONTH_NAMES) {
    if (lower.includes(`${month} fee`) || lower === month) {
      const code = MONTH_TO_INST[month];
      return code ? [code] : null;
    }
  }
  return null;
}

function monthRangeCodes(startName: string, endName: string): string[] | null {
  const start = MONTH_NAMES.indexOf(
    startName.toLowerCase() as (typeof MONTH_NAMES)[number],
  );
  const end = MONTH_NAMES.indexOf(
    endName.toLowerCase() as (typeof MONTH_NAMES)[number],
  );
  if (start < 0 || end < 0) return null;
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

export function parseReceiptScope(note: string): ParsedReceiptScope {
  const label = note.replace(/\s+/g, " ").trim();
  const lower = label.toLowerCase();
  const includesArrears =
    lower.includes("previous_due") || lower.includes("previous due");
  let installmentCodes = installmentCodesFromReceiptNote(label) ?? [];

  if (includesArrears && installmentCodes.length === 0) {
    const afterTo = lower.match(/to\s+(\w+)\s+fee/);
    if (afterTo) {
      const code =
        MONTH_TO_INST[afterTo[1]!.toLowerCase() as (typeof MONTH_NAMES)[number]];
      if (code) installmentCodes = [code];
    }
  }

  let kind: PaymentScopeKind = "unknown";
  if (/registration/i.test(lower) && !installmentCodes.length) {
    kind = "registration";
  } else if (includesArrears && installmentCodes.length) {
    kind = "mixed";
  } else if (includesArrears) {
    kind = "arrears";
  } else if (installmentCodes.length) {
    kind = "monthly";
  }

  return { kind, installmentCodes, includesArrears, label };
}

function extractReceiptNote(chunk: string): string {
  const s = normSpaces(chunk);
  const m = s.match(
    /Payment for (.+?)(?:\s+UPI|\s+Cash|\s+Ca\s+sh|\s+DayScho|\s+TUITIO|$)/i,
  );
  return m?.[1]?.trim() ?? "";
}

function extractStudentName(chunk: string): string | null {
  const s = normSpaces(chunk);
  const adm = extractAdmissionNo(chunk);
  if (!adm) return null;
  const admPlain = adm.replace(/^BHB-/, "");
  const idx = s.toUpperCase().indexOf(admPlain.replace("/", "/"));
  if (idx < 0) return null;
  const after = s.slice(idx + admPlain.length).trim();
  const nameMatch = after.match(
    /^[A-Z][A-Z\s.'-]{1,40}?\s+(?:Nur|LKG|UKG|I{1,3}|IV|V|VI{0,3}|IX|X|XI|XII|UK\s*G)\b/i,
  );
  if (!nameMatch) return null;
  return nameMatch[0]
    .replace(/\s+(Nur|LKG|UKG|I{1,3}|IV|V|VI{0,3}|IX|X|XI|XII|UK\s*G).*$/i, "")
    .trim();
}

function headsToLines(heads: number[]): ParsedReceiptLine[] {
  const lines: ParsedReceiptLine[] = [];
  HEAD_CODES.forEach((code, i) => {
    const amountRupees = heads[i] ?? 0;
    if (amountRupees <= 0) return;
    lines.push({
      headLabel: HEAD_LABELS[code],
      headCode: code,
      amountRupees,
    });
  });
  return lines;
}

export function isDailyCollectionReport(text: string): boolean {
  return /DAILY\s+COLLECTION\s+FOR/i.test(text);
}

/** Parse daily collection PDF text into structured receipt rows. */
export function parseDailyCollectionReport(text: string): DailyCollectionRow[] {
  const cleaned = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !PAGE_BREAK.test(l))
    .join("\n");

  const chunks = cleaned.split(ACADEMIC_YEAR_SPLIT);
  const rows: DailyCollectionRow[] = [];

  for (const chunk of chunks.slice(1)) {
    if (/Payment Summary|Total\s+\d/i.test(chunk)) continue;

    const tail = parseTailFromChunk(chunk);
    if (!tail || tail.paid <= 0) continue;

    const { receiptNo, paymentDate, paymentMode } = extractReceiptMeta(chunk);
    const admissionNo = extractAdmissionNo(chunk);
    const receiptNote = extractReceiptNote(chunk);
    const lines = enrichLinesWithPdfConcession(
      headsToLines(tail.heads),
      tail.concession,
    );
    if (lines.length === 0) continue;
    const paymentScope = receiptNote
      ? parseReceiptScope(receiptNote)
      : lines.some((l) => l.headCode === "ADMISSION")
        ? parseReceiptScope("Registration Fee")
        : parseReceiptScope("");

    const studentName = extractStudentName(chunk);
    const category =
      paymentScope.kind === "registration" ? "registration" : "fee";

    rows.push({
      srNo: rows.length + 1,
      legacyReceiptNo: receiptNo || `DC-${rows.length + 1}`,
      ledger: paymentMode.toUpperCase(),
      paymentDate: paymentDate || "2026-04-01",
      narration: receiptNote
        ? `Payment for ${receiptNote}`
        : `Fee collection · ${admissionNo}`,
      studentName,
      category,
      note: receiptNote,
      paperReceiptNo: receiptNo,
      totalRupees: tail.paid,
      lines,
      admissionNo,
      receiptNote,
      receiptConcessionRupees: tail.concession,
      grossAmountRupees: tail.amount,
      receiptBalanceDueRupees: tail.due,
      paymentScope,
      paymentMode,
    });
  }

  return rows;
}

export function summarizeDailyCollection(rows: DailyCollectionRow[]): {
  totalRows: number;
  totalPaidRupees: number;
  totalConcessionRupees: number;
  byHead: Map<string, { label: string; rupees: number }>;
  byScope: Record<PaymentScopeKind, number>;
} {
  const byHead = new Map<string, { label: string; rupees: number }>();
  const byScope: Record<PaymentScopeKind, number> = {
    monthly: 0,
    arrears: 0,
    mixed: 0,
    registration: 0,
    unknown: 0,
  };

  let totalPaidRupees = 0;
  let totalConcessionRupees = 0;

  for (const r of rows) {
    totalPaidRupees += r.totalRupees;
    totalConcessionRupees += r.receiptConcessionRupees;
    byScope[r.paymentScope.kind] += 1;
    for (const l of r.lines) {
      const prev = byHead.get(l.headCode) ?? {
        label: l.headLabel,
        rupees: 0,
      };
      prev.rupees += l.amountRupees;
      byHead.set(l.headCode, prev);
    }
  }

  return {
    totalRows: rows.length,
    totalPaidRupees,
    totalConcessionRupees,
    byHead,
    byScope,
  };
}

export function scopeLabel(scope: ParsedReceiptScope): string {
  if (scope.label) return scope.label;
  if (scope.installmentCodes.length) {
    return scope.installmentCodes.join("–");
  }
  if (scope.includesArrears) return "Previous due";
  return "Fee";
}

export function lineLabelForScope(
  headLabel: string,
  headCode: string,
  scope: ParsedReceiptScope,
): string {
  if (headCode === "ARREARS") return headLabel;
  const period = scopeLabel(scope);
  return `${headLabel} · ${period}`;
}

export function dueKeyForImportedLine(input: {
  admissionNo: string;
  legacyReceiptNo: string;
  headCode: string;
  lineIndex: number;
  scope: ParsedReceiptScope;
}): string {
  if (input.headCode === "ARREARS") {
    return `legacy:arrears:${normAdmissionNo(input.admissionNo)}:${input.legacyReceiptNo}:${input.lineIndex}`;
  }
  const inst =
    input.scope.installmentCodes[0] ??
    (input.scope.includesArrears ? "ARREARS" : "GEN");
  return `legacy:${inst}:${input.headCode}:${normAdmissionNo(input.admissionNo)}:${input.legacyReceiptNo}:${input.lineIndex}`;
}

export function scopeForImportedHead(
  headCode: string,
  receiptNote: string,
): ParsedReceiptScope {
  if (headCode === "ARREARS") {
    return {
      kind: "arrears",
      installmentCodes: [],
      includesArrears: true,
      label: "Previous Due-2025",
    };
  }
  const monthlyNote = receiptNote
    .replace(/previous_due\s*\([^)]*\)/gi, "")
    .replace(/previous\s+due[^,]*/gi, "")
    .replace(/^\s*to\s+/i, "")
    .trim();
  return parseReceiptScope(monthlyNote || receiptNote);
}

/** Enrich head lines with per-head concession from the PDF Concession column. */
export function enrichLinesWithPdfConcession(
  lines: ParsedReceiptLine[],
  receiptConcessionRupees: number,
): ParsedReceiptLine[] {
  const shares = allocateConcessionToLines(lines, receiptConcessionRupees);
  return lines.map((l, idx) => {
    const conc = shares.get(idx) ?? 0;
    return {
      ...l,
      concessionRupees: conc,
      billedRupees: l.amountRupees + conc,
    };
  });
}

/** Spread receipt-level Concession column across head lines by collected amount share. */
export function allocateConcessionToLines(
  lines: ParsedReceiptLine[],
  receiptConcessionRupees: number,
): Map<number, number> {
  const out = new Map<number, number>();
  if (receiptConcessionRupees <= 0 || lines.length === 0) return out;
  const total = lines.reduce((s, l) => s + l.amountRupees, 0);
  if (total <= 0) return out;

  let allocated = 0;
  lines.forEach((l, idx) => {
    if (idx === lines.length - 1) {
      out.set(idx, receiptConcessionRupees - allocated);
      return;
    }
    const share = Math.round(
      (receiptConcessionRupees * l.amountRupees) / total,
    );
    out.set(idx, share);
    allocated += share;
  });
  return out;
}
