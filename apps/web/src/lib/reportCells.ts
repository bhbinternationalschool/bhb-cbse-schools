/**
 * What each column of an exported report holds, decided once for the whole
 * column, so Excel gets real numbers and dates and the PDF can right-align
 * and total them.
 *
 * Until 14 Oct 2026 every catalog handed the export engine display strings —
 * "₹1,200", "1200.00" (fees' paise()), "72.5%", "2026-10-13T08:20:49Z" — and
 * the engine wrote them into the workbook as text. Excel could not add up a
 * single fee, accounts, trust, transport or library amount, and no report had
 * a totals row. Payroll alone passed numbers.
 *
 * A column is only treated as numeric when EVERY filled cell parses and the
 * header says what it is (money words, count words) or the values carry ₹ or
 * %. Identifiers stay text whatever they look like — roll no., admission no.,
 * phone, Aadhaar, PIN, receipt no., UTR, account no. — and so does any value
 * with a leading zero, so "0123" never becomes 123. A catalog can override
 * the guess with `column.type`.
 *
 * Dependency-free on purpose (no "@/" imports): the PDF table and its tests
 * load it outside the app.
 */

export type ReportCellKind = "text" | "money" | "number" | "percent" | "date" | "datetime";

export type CellRaw = string | number | null | undefined;

/** The subset of ReportColumn this module reads. */
export type TypedColumn = {
  key: string;
  header: string;
  type?: ReportCellKind;
  /** true = add to the totals row; false = never. Default: money, and counts named like counts. */
  total?: boolean;
};

const BLANK = new Set(["", "—", "–", "-"]);

export function isBlankCell(v: CellRaw): boolean {
  if (v == null) return true;
  if (typeof v === "number") return !Number.isFinite(v);
  return BLANK.has(v.trim());
}

const MONEY_RE = /^\s*(-|−)?\s*(₹|rs\.?|inr)?\s*(-|−)?\s*(\d{1,3}(,\d{2,3})*|\d+)(\.\d+)?\s*(\/-)?\s*$/i;
const PERCENT_RE = /^\s*(-|−)?\d+(\.\d+)?\s*%\s*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** A money-ish string → rupees, or null. "₹1,23,456.50" → 123456.5 */
export function parseAmount(v: CellRaw): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  const s = String(v);
  if (!MONEY_RE.test(s)) return null;
  const neg = /^\s*(-|−)|(₹|rs\.?|inr)\s*(-|−)/i.test(s);
  const n = Number(s.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

export function parsePercent(v: CellRaw): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null || !PERCENT_RE.test(String(v))) return null;
  const s = String(v).replace("−", "-");
  return Number(s.replace(/[%\s]/g, ""));
}

const hasCurrency = (v: CellRaw) => typeof v === "string" && /₹|\brs\.?\s*\d|\binr\b/i.test(v);
const hasLeadingZero = (v: CellRaw) => typeof v === "string" && /^\s*0\d/.test(v);

// Identifier columns: their digits are a label, never a quantity. A header
// ENDING in no./number/id/code/ref ("Receipt no", "Adm no.") is one wherever
// it sits; the words below mark one anywhere unless the header is plainly
// money ("Admission fee", "Receipt amount").
const ID_SUFFIX = /(^|[^a-z])(no\.?|nos\.?|number|#|id|ids|code|ref|reference|a\/c|ac|account|acct)\s*$/i;
const ID_ANYWHERE =
  /phone|mobile|contact|whatsapp|aadhaa?r|pincode|\bpin\b|\broll\b|ifsc|\butr\b|\buan\b|apaar|\bpen\b|udise|gstin|\bpan\b|isbn|accession|admission|\badm\b|\byear\b|session|\bclass\b|section|\bsrn?\b|serial|\brank\b|txn|transaction/i;
const COUNT_PHRASE = /\bno\.?\s*of\b|\bnumber\s+of\b/i;
const MONEY_HEADER =
  /₹|\brs\b|\binr\b|amount|\bamt\b|paid|\bdues?\b|outstanding|balance|\bfees?\b|\bfines?\b|collected|collection|billed|\bcost\b|salary|gross|\bnet\b|\bpay\b|payable|deduction|advance|price|value|debit|credit|\btds\b|\bemi\b|loan|interest|discount|concession|waiver|refund|receipts?\s*₹|revenue|margin|expense|income|budget|spent|wages?|allowance|bonus|arrears?|premium|charges?|tariff/i;
// Money words that, next to these, name a day count, a date or a label —
// "Paid days", "Salary day", "Paid leave", "Due odo", "Fee type" — not rupees.
const NOT_MONEY_HEADER = /\bdays?\b|leave|odo|\bdate\b|\bon\b|\bat\b|label|status|\btype\b|\bhead\b|group|reminder|cert|\bmode\b|\bby\b/i;
const COUNT_HEADER =
  /count|receipts|students|children|riders|staff|qty|quantity|\bdays?\b|periods|present|absent|leaves?|late|marked|strength|boys|girls|total|issued|returned|copies|books|items|lines|seats|trips|km\b|litres?|hours|minutes|marks|obtained|\bmax\b|score|posts|bookings|slots|visits|units|stock|on hand/i;
// Never summed even when numeric: a sum of balances-after or rates is noise.
const NO_SUM_HEADER = /running|closing|opening|\bbalance\b(?!.*(due|outstanding))|\brate\b|price|\bavg\b|average|\bper\b|\/\s*km|%|percent|\bmax\b|marks|obtained|score|\bage\b|hours|minutes|\bkm\b|odometer|reading/i;
const SUMMABLE_COUNT = /receipts|count|students|children|riders|qty|quantity|no\.?\s*of|number\s+of|boys|girls|issued|returned|copies|items|lines|bookings|visits|posts|trips|strength|leaves?|days?\b|periods|present|absent|late/i;

/**
 * Decide each column's kind from its header and every filled cell.
 * `column.type` wins when a catalog sets it.
 */
export function classifyColumns(
  columns: TypedColumn[],
  rows: Record<string, CellRaw>[],
): ReportCellKind[] {
  return columns.map((col) => {
    if (col.type) return col.type;
    const vals = rows.map((r) => r[col.key]).filter((v) => !isBlankCell(v));
    if (vals.length === 0) return "text";
    const header = col.header || "";
    const isId =
      !COUNT_PHRASE.test(header) &&
      (ID_SUFFIX.test(header) || (ID_ANYWHERE.test(header) && !MONEY_HEADER.test(header)));

    if (vals.every((v) => typeof v === "string" && DATE_RE.test(v.trim()))) return "date";
    if (vals.every((v) => typeof v === "string" && DATETIME_RE.test(v.trim()))) return "datetime";
    if (isId) return "text";
    if (vals.some(hasLeadingZero)) return "text";
    if (vals.every((v) => parsePercent(v) !== null) && vals.some((v) => typeof v === "string")) return "percent";
    if (vals.every((v) => parseAmount(v) !== null)) {
      if (vals.some((v) => typeof v === "string" && v.replace(/\D/g, "").length > 15)) return "text";
      if (vals.some(hasCurrency) || (MONEY_HEADER.test(header) && !NOT_MONEY_HEADER.test(header))) return "money";
      if (COUNT_PHRASE.test(header) || COUNT_HEADER.test(header) || vals.every((v) => typeof v === "number")) {
        return "number";
      }
    }
    return "text";
  });
}

/** Excel cell value for a kind: numbers, percent as a fraction, dates as Date (UTC, wall-clock). */
export function xlsxValue(kind: ReportCellKind, v: CellRaw): string | number | Date | null {
  if (isBlankCell(v)) return v == null ? null : typeof v === "number" ? null : String(v);
  switch (kind) {
    case "money":
    case "number":
      return parseAmount(v) ?? String(v);
    case "percent": {
      const p = parsePercent(v);
      return p === null ? String(v) : p / 100;
    }
    case "date": {
      const m = DATE_RE.exec(String(v).trim()) ? String(v).trim().split("-").map(Number) : null;
      return m ? new Date(Date.UTC(m[0]!, m[1]! - 1, m[2]!)) : String(v);
    }
    case "datetime": {
      const ist = istWallClock(String(v));
      return ist ? new Date(Date.UTC(ist.y, ist.mo - 1, ist.d, ist.h, ist.mi)) : String(v);
    }
    default:
      return typeof v === "number" ? v : String(v);
  }
}

export function xlsxNumFmt(kind: ReportCellKind, column: TypedColumn, rows: Record<string, CellRaw>[]): string | undefined {
  switch (kind) {
    case "money":
      return "#,##0.00";
    case "number": {
      const ints = rows.every((r) => {
        const n = parseAmount(r[column.key]);
        return n === null || Number.isInteger(n);
      });
      return ints ? "#,##0" : "#,##0.00";
    }
    case "percent":
      return "0.0%";
    case "date":
      return "dd-mm-yyyy";
    case "datetime":
      return "dd-mm-yyyy hh:mm";
    default:
      return undefined;
  }
}

/** Indian digit grouping: 1234567.5 → "12,34,567.50" */
export function formatIndian(n: number, decimals = 2): string {
  const neg = n < 0;
  const [int, frac] = Math.abs(n).toFixed(decimals).split(".");
  const last3 = int!.slice(-3);
  const rest = int!.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${neg ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

function istWallClock(iso: string): { y: number; mo: number; d: number; h: number; mi: number } | null {
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso.replace(" ", "T")}+05:30`);
  if (!Number.isFinite(t)) return null;
  const x = new Date(t + 5.5 * 3600_000);
  return { y: x.getUTCFullYear(), mo: x.getUTCMonth() + 1, d: x.getUTCDate(), h: x.getUTCHours(), mi: x.getUTCMinutes() };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** What the PDF prints: grouped money, DD-MM-YYYY dates, IST times. */
export function displayValue(kind: ReportCellKind, v: CellRaw): string {
  if (v == null) return "";
  if (isBlankCell(v)) return typeof v === "number" ? "" : String(v);
  switch (kind) {
    case "money": {
      const n = parseAmount(v);
      return n === null ? String(v) : formatIndian(n, 2);
    }
    case "number": {
      const n = parseAmount(v);
      if (n === null) return String(v);
      return Number.isInteger(n) ? formatIndian(n, 0) : formatIndian(n, 2);
    }
    case "percent": {
      const p = parsePercent(v);
      return p === null ? String(v) : `${Math.round(p * 10) / 10}%`;
    }
    case "date": {
      const [y, m, d] = String(v).trim().split("-");
      return `${d}-${m}-${y}`;
    }
    case "datetime": {
      const t = istWallClock(String(v));
      return t ? `${pad(t.d)}-${pad(t.mo)}-${t.y} ${pad(t.h)}:${pad(t.mi)}` : String(v);
    }
    default:
      return String(v);
  }
}

/** What a CSV carries: plain numbers (no ₹, no commas), ISO dates, IST times. */
export function csvValue(kind: ReportCellKind, v: CellRaw): string {
  if (v == null) return "";
  if (isBlankCell(v)) return typeof v === "number" ? "" : String(v);
  switch (kind) {
    case "money":
    case "number": {
      const n = parseAmount(v);
      return n === null ? String(v) : String(n);
    }
    case "percent": {
      const p = parsePercent(v);
      return p === null ? String(v) : String(p);
    }
    case "datetime": {
      const t = istWallClock(String(v));
      return t ? `${t.y}-${pad(t.mo)}-${pad(t.d)} ${pad(t.h)}:${pad(t.mi)}` : String(v);
    }
    default:
      return String(v);
  }
}

const TOTAL_LABEL = /^\s*(grand\s+)?totals?\b/i;

/** The report already carries its own total row (fines summary, strength…). */
export function hasOwnTotalRow(columns: TypedColumn[], rows: Record<string, CellRaw>[]): boolean {
  return rows.some((r) => columns.some((c) => typeof r[c.key] === "string" && TOTAL_LABEL.test(String(r[c.key]))));
}

/** Which columns the totals row adds up. */
export function summedColumns(columns: TypedColumn[], kinds: ReportCellKind[]): boolean[] {
  return columns.map((c, i) => {
    if (c.total !== undefined) return c.total && (kinds[i] === "money" || kinds[i] === "number");
    if (NO_SUM_HEADER.test(c.header)) return false;
    if (kinds[i] === "money") return true;
    if (kinds[i] === "number") return SUMMABLE_COUNT.test(c.header);
    return false;
  });
}

/**
 * The totals row, or null when there is nothing to add up, fewer than two
 * rows, or the report already has its own total.
 */
export function buildTotalsRow(
  columns: TypedColumn[],
  rows: Record<string, CellRaw>[],
  kinds: ReportCellKind[],
): { row: Record<string, CellRaw>; summed: boolean[] } | null {
  if (rows.length < 2 || hasOwnTotalRow(columns, rows)) return null;
  const summed = summedColumns(columns, kinds);
  if (!summed.some(Boolean)) return null;
  const row: Record<string, CellRaw> = {};
  columns.forEach((c, i) => {
    if (!summed[i]) return;
    let t = 0;
    for (const r of rows) t += parseAmount(r[c.key]) ?? 0;
    row[c.key] = Math.round(t * 100) / 100;
  });
  // The label goes in the first column that is not summed.
  const labelAt = summed.findIndex((s) => !s);
  if (labelAt >= 0) row[columns[labelAt]!.key] = "TOTAL";
  return { row, summed };
}
