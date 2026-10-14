/**
 * Transport → Finance, from the books — pure logic shared by the server
 * routes and the screen.
 *
 * Until 14 Oct 2026 the Finance tab read the transport desk (vehicleLoans,
 * emiSchedule, certificateRenewals, insurancePolicies). Those slices were
 * never saved to the server: a loan typed there lived in one browser and
 * never reached the books, so the tab said "No open EMIs" while three real
 * Mahindra loans sat in Ledger v2 (2150–2152). Now:
 *
 *   - LOANS are read from the ledger. A vehicle loan is a liability account
 *     the office opened in Accounts; this file decides which accounts those
 *     are, which vouchers are EMIs, and which months have no EMI posted.
 *     Nothing here posts an EMI — the principal/interest split comes from the
 *     lender's schedule, which the system does not hold.
 *   - DOCUMENTS (PUC, fitness, permit, road tax, CNG hydro test, AIS-140,
 *     fire extinguisher, insurance) live server-side in one module_local_state
 *     row (TRANSPORT_VEHICLE_DOCS_KEY), written only through
 *     /api/transport/vehicle-docs.
 *
 * No imports from the desk modules: this runs on the server and in tests.
 */

import type { LedgerLineInput } from "@/lib/ledger/types";

/* ─── Stores ──────────────────────────────────────────────── */

/** module_local_state key: every vehicle document, with history. */
export const TRANSPORT_VEHICLE_DOCS_KEY = "transport_vehicle_docs";
/** module_local_state key: loan account ↔ transport vehicle (and EMI day). */
export const TRANSPORT_LOAN_LINKS_KEY = "transport_loan_links";

/* ─── Dates ───────────────────────────────────────────────── */

/** Today's date in India. */
export function istToday(nowMs = Date.now()): string {
  return new Date(nowMs + 330 * 60 * 1000).toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "2026-10-14" → "2026-10". */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** "2026-12" + 1 → "2027-01". */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** The due date of a month's EMI; a day past the month's end clamps to it. */
export function dueDateIn(month: string, dueDay: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = Math.min(Math.max(1, Math.round(dueDay) || 10), last);
  return `${month}-${String(d).padStart(2, "0")}`;
}

/** Indian financial year (April–March) holding `date`. */
export function fyBounds(date: string): { code: string; from: string; to: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return {
    code: `FY${start}-${String(start + 1).slice(-2)}`,
    from: `${start}-04-01`,
    to: `${start + 1}-03-31`,
  };
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09" → "Sep 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${MONTH_NAMES[m - 1] ?? "?"} ${y}`;
}

/* ─── Loans ───────────────────────────────────────────────── */

export const DEFAULT_EMI_DUE_DAY = 10;

/** What the office says about one loan account (Accounts · edit). */
export type LoanLink = {
  /** Transport vehicle id ("" = not linked yet). */
  vehicleId: string;
  /** Day of the month the EMI is debited (NACH). */
  emiDueDay: number;
  /** Who actually pays, as the office wants it shown ("Bank NACH", "Trustee"). */
  paidBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type LoanLinksState = { links: Record<string, LoanLink> };

export function normalizeLoanLinks(raw: unknown): LoanLinksState {
  const src = (raw && typeof raw === "object" ? (raw as { links?: unknown }).links : null) ?? {};
  const links: Record<string, LoanLink> = {};
  if (src && typeof src === "object") {
    for (const [code, v] of Object.entries(src as Record<string, unknown>)) {
      if (!code || !v || typeof v !== "object") continue;
      const r = v as Record<string, unknown>;
      const day = Number(r.emiDueDay);
      links[code] = {
        vehicleId: String(r.vehicleId ?? ""),
        emiDueDay: day >= 1 && day <= 31 ? Math.round(day) : DEFAULT_EMI_DUE_DAY,
        paidBy: String(r.paidBy ?? "").slice(0, 80),
        updatedAt: String(r.updatedAt ?? ""),
        updatedBy: String(r.updatedBy ?? ""),
      };
    }
  }
  return { links };
}

/**
 * Is this ledger account a vehicle loan?
 *
 * A liability the office has linked to a vehicle, or one whose name says
 * "vehicle loan" (how 2150–2152 were opened). Matched on the name, not on
 * hard-coded codes, because the chart is the office's to edit; the link is
 * the way to bring in a loan named some other way ("Bus loan — HDFC").
 * Group headings (no parent) are never loans.
 */
export function isVehicleLoanAccount(
  a: { code: string; name: string; kind: string; parentCode?: string; isActive?: boolean },
  linkedCodes: ReadonlySet<string>,
): boolean {
  if (a.kind !== "liability") return false;
  if (a.isActive === false) return false;
  if (!a.parentCode) return false;
  if (linkedCodes.has(a.code)) return true;
  return /\bvehicle\s+loan\b/i.test(a.name) || /\b(bus|van|vehicle)\s+(loan|finance)\b/i.test(a.name);
}

/** Interest on a loan is the expense line beside the principal in the EMI voucher. */
export function isInterestAccount(a: { kind: string; name: string }): boolean {
  return a.kind === "expense" && /\binterest\b/i.test(a.name);
}

/** One voucher touching a loan account, as the summary needs it. */
export type LoanVoucherRow = {
  voucherId: string;
  voucherNo: string;
  voucherType: string;
  date: string;
  /** Sum on the loan account in this voucher. */
  debitPaise: number;
  creditPaise: number;
  /** Interest-account debits in the same voucher (minus credits). */
  interestPaise: number;
  /** A reversal, or a voucher a reversal has cancelled — neither is an EMI. */
  cancelled: boolean;
};

export type LoanSummary = {
  /** Credit balance: what is still owed (from every line, cancelled ones net out). */
  outstandingPaise: number;
  principalThisFyPaise: number;
  interestThisFyPaise: number;
  lastEmi: { voucherId: string; voucherNo: string; date: string; principalPaise: number; interestPaise: number } | null;
  /** Months whose EMI date has passed with no EMI posted for them, oldest first. */
  missingMonths: string[];
  /** The next due date with no EMI posted yet (today or later). "" once the loan is repaid. */
  nextDueOn: string;
  /** The last EMI's total (principal + interest) — what the next one is likely to be. */
  lastEmiTotalPaise: number;
  /** Opening/first-credit month: where "missing" starts counting. */
  anchorMonth: string;
  emiCount: number;
  /** Every live EMI ever posted, oldest first (the EMI register and TCO read these). */
  emis: { voucherNo: string; date: string; principalPaise: number; interestPaise: number }[];
  /** All-time principal and interest paid by those EMIs. */
  principalPaidPaise: number;
  interestPaidPaise: number;
};

/** An EMI: a live voucher that pays the loan down (Dr the loan), not the opening. */
export function isEmiVoucher(v: LoanVoucherRow): boolean {
  return !v.cancelled && v.debitPaise > 0 && v.voucherType !== "opening" && v.voucherType !== "reversal";
}

/**
 * Months that should have an EMI and do not.
 *
 * Counting starts the month after `anchorMonth` (the loan's opening balance
 * or its first disbursal) and runs to the current month — but a month counts
 * only once its due date has passed. Every month in that range with no EMI
 * posted is listed, holes in the middle included: a June left out between a
 * May and a July is as unposted as an October.
 */
export function missingEmiMonths(input: {
  anchorMonth: string;
  postedMonths: readonly string[];
  today: string;
  dueDay: number;
  /** The first month an EMI is owed (loan terms); default the month after the anchor. */
  firstDueMonth?: string;
}): string[] {
  if (!/^\d{4}-\d{2}$/.test(input.anchorMonth) || !isIsoDate(input.today)) return [];
  const posted = new Set(input.postedMonths);
  const out: string[] = [];
  const current = monthOf(input.today);
  const start = input.firstDueMonth && /^\d{4}-\d{2}$/.test(input.firstDueMonth) ? input.firstDueMonth : addMonths(input.anchorMonth, 1);
  for (let m = start; m <= current; m = addMonths(m, 1)) {
    if (dueDateIn(m, input.dueDay) >= input.today) break; // not due yet (due today = not yet missed)
    if (!posted.has(m)) out.push(m);
    if (out.length > 240) break; // a bad anchor must not spin
  }
  return out;
}

/** The next due date on or after today whose month has no EMI posted. */
export function nextEmiDue(input: { postedMonths: readonly string[]; today: string; dueDay: number }): string {
  if (!isIsoDate(input.today)) return "";
  const posted = new Set(input.postedMonths);
  let m = monthOf(input.today);
  for (let i = 0; i < 24; i++, m = addMonths(m, 1)) {
    const due = dueDateIn(m, input.dueDay);
    if (due >= input.today && !posted.has(m)) return due;
  }
  return "";
}

export function summarizeLoan(input: {
  rows: readonly LoanVoucherRow[];
  today: string;
  dueDay: number;
  /**
   * The first month an EMI is owed, from the loan's terms (lib/loans.ts). A
   * loan sanctioned 20 Jul with its first EMI on 10 Sep owes nothing in
   * August; without terms, the month after the anchor is assumed.
   */
  firstDueMonth?: string;
}): LoanSummary {
  const fy = fyBounds(input.today);
  let outstanding = 0;
  for (const r of input.rows) outstanding += r.creditPaise - r.debitPaise;

  const emis = input.rows.filter(isEmiVoucher).sort((a, b) => a.date.localeCompare(b.date) || a.voucherNo.localeCompare(b.voucherNo));
  let principalFy = 0;
  let interestFy = 0;
  for (const e of emis) {
    if (e.date >= fy.from && e.date <= fy.to) {
      principalFy += e.debitPaise - e.creditPaise;
      interestFy += e.interestPaise;
    }
  }
  // Where counting starts: the opening balance or the first money lent —
  // the earliest live voucher that CREDITS the loan.
  const credits = input.rows
    .filter((r) => !r.cancelled && r.creditPaise > 0)
    .map((r) => r.date)
    .sort();
  const firstEmi = emis[0]?.date ?? "";
  const anchorDate = credits[0] ?? (firstEmi ? monthOf(addMonths(monthOf(firstEmi), -1)) + "-01" : "");
  const anchorMonth = anchorDate ? monthOf(anchorDate) : "";

  const postedMonths = emis.map((e) => monthOf(e.date));
  const last = emis[emis.length - 1] ?? null;
  const repaid = outstanding <= 0;
  return {
    outstandingPaise: outstanding,
    principalThisFyPaise: principalFy,
    interestThisFyPaise: interestFy,
    lastEmi: last
      ? {
          voucherId: last.voucherId,
          voucherNo: last.voucherNo,
          date: last.date,
          principalPaise: last.debitPaise - last.creditPaise,
          interestPaise: last.interestPaise,
        }
      : null,
    missingMonths:
      repaid || !anchorMonth
        ? []
        : missingEmiMonths({ anchorMonth, postedMonths, today: input.today, dueDay: input.dueDay, firstDueMonth: input.firstDueMonth }),
    nextDueOn: repaid ? "" : nextEmiDue({ postedMonths, today: input.today, dueDay: input.dueDay }),
    lastEmiTotalPaise: last ? last.debitPaise - last.creditPaise + last.interestPaise : 0,
    anchorMonth,
    emiCount: emis.length,
    emis: emis.map((e) => ({
      voucherNo: e.voucherNo,
      date: e.date,
      principalPaise: e.debitPaise - e.creditPaise,
      interestPaise: e.interestPaise,
    })),
    principalPaidPaise: emis.reduce((n, e) => n + e.debitPaise - e.creditPaise, 0),
    interestPaidPaise: emis.reduce((n, e) => n + e.interestPaise, 0),
  };
}

/* ─── Vehicle documents ───────────────────────────────────── */

export const VEHICLE_DOC_TYPES = [
  "insurance",
  "puc",
  "fitness",
  "permit",
  "road_tax",
  "cng_hydro",
  "ais140",
  "fire_extinguisher",
] as const;
export type VehicleDocType = (typeof VEHICLE_DOC_TYPES)[number];

export const VEHICLE_DOC_LABELS: Record<VehicleDocType, string> = {
  insurance: "Insurance",
  puc: "PUC",
  fitness: "Fitness",
  permit: "Permit",
  road_tax: "Road tax",
  cng_hydro: "CNG hydro test",
  ais140: "AIS-140 tracker",
  fire_extinguisher: "Fire extinguisher",
};

export function isVehicleDocType(t: unknown): t is VehicleDocType {
  return typeof t === "string" && (VEHICLE_DOC_TYPES as readonly string[]).includes(t);
}

export type VehicleDocFeePosting = {
  voucherId: string;
  voucherNo: string;
  mode: "cash" | "bank";
  bankCode: string;
  paidOn: string;
  expenseCode: string;
  postedAt: string;
  postedBy: string;
  /** Set when the document was voided and the fee voucher reversed. */
  reversalVoucherNo: string;
};

export type VehicleDoc = {
  id: string;
  vehicleId: string;
  type: VehicleDocType;
  /** Certificate / permit / receipt number. */
  number: string;
  issuedOn: string;
  expiresOn: string;
  feePaise: number;
  /** Insurance only. */
  insurer: string;
  policyNo: string;
  fileUrl: string;
  fileName: string;
  note: string;
  status: "active" | "void";
  voidReason: string;
  /** The fee in the books, once posted. Fee and payment are locked then. */
  fee: VehicleDocFeePosting | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type VehicleDocsState = { docs: VehicleDoc[] };

function str(v: unknown, max = 200): string {
  return String(v ?? "").trim().slice(0, max);
}

export function normalizeVehicleDoc(raw: unknown): VehicleDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 80);
  const type = r.type;
  if (!id || !isVehicleDocType(type)) return null;
  const f = r.fee && typeof r.fee === "object" ? (r.fee as Record<string, unknown>) : null;
  return {
    id,
    vehicleId: str(r.vehicleId, 80),
    type,
    number: str(r.number, 80),
    issuedOn: isIsoDate(r.issuedOn) ? r.issuedOn : "",
    expiresOn: isIsoDate(r.expiresOn) ? r.expiresOn : "",
    feePaise: Math.max(0, Math.round(Number(r.feePaise) || 0)),
    insurer: str(r.insurer, 120),
    policyNo: str(r.policyNo, 80),
    fileUrl: str(r.fileUrl, 500),
    fileName: str(r.fileName, 160),
    note: str(r.note, 500),
    status: r.status === "void" ? "void" : "active",
    voidReason: str(r.voidReason, 300),
    fee:
      f && str(f.voucherNo)
        ? {
            voucherId: str(f.voucherId, 80),
            voucherNo: str(f.voucherNo, 80),
            mode: f.mode === "bank" ? "bank" : "cash",
            bankCode: str(f.bankCode, 40),
            paidOn: isIsoDate(f.paidOn) ? f.paidOn : "",
            expenseCode: str(f.expenseCode, 40),
            postedAt: str(f.postedAt, 40),
            postedBy: str(f.postedBy, 120),
            reversalVoucherNo: str(f.reversalVoucherNo, 80),
          }
        : null,
    createdAt: str(r.createdAt, 40),
    createdBy: str(r.createdBy, 120),
    updatedAt: str(r.updatedAt, 40),
    updatedBy: str(r.updatedBy, 120),
  };
}

export function normalizeVehicleDocs(raw: unknown): VehicleDocsState {
  const list = raw && typeof raw === "object" ? (raw as { docs?: unknown }).docs : null;
  const docs: VehicleDoc[] = [];
  const seen = new Set<string>();
  for (const d of Array.isArray(list) ? list : []) {
    const n = normalizeVehicleDoc(d);
    if (n && !seen.has(n.id)) {
      seen.add(n.id);
      docs.push(n);
    }
  }
  return { docs };
}

/** What a save may carry from the screen; everything else the server sets. */
export type VehicleDocInput = {
  vehicleId: string;
  type: VehicleDocType;
  number: string;
  issuedOn: string;
  expiresOn: string;
  feePaise: number;
  insurer: string;
  policyNo: string;
  fileUrl: string;
  fileName: string;
  note: string;
};

export function validateVehicleDocInput(raw: unknown, knownVehicleIds: ReadonlySet<string> | null):
  | { ok: true; input: VehicleDocInput }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Nothing to save" };
  const r = raw as Record<string, unknown>;
  const vehicleId = str(r.vehicleId, 80);
  if (!vehicleId) return { ok: false, error: "Choose the vehicle" };
  if (knownVehicleIds && !knownVehicleIds.has(vehicleId)) return { ok: false, error: "That vehicle is not in the fleet" };
  if (!isVehicleDocType(r.type)) return { ok: false, error: "Choose the document type" };
  const expiresOn = str(r.expiresOn, 10);
  if (!isIsoDate(expiresOn)) return { ok: false, error: "Enter the expiry date" };
  const issuedOn = str(r.issuedOn, 10);
  if (issuedOn && !isIsoDate(issuedOn)) return { ok: false, error: "The issue date is not a date" };
  if (issuedOn && issuedOn > expiresOn) return { ok: false, error: "It cannot expire before it was issued" };
  const fee = Number(r.feePaise ?? 0);
  if (!Number.isFinite(fee) || fee < 0) return { ok: false, error: "The fee must be a positive amount" };
  const fileUrl = str(r.fileUrl, 500);
  // Only our own private file path or a storage URL — never an arbitrary link.
  if (fileUrl && !/^\/api\/file\//.test(fileUrl) && !/^https:\/\/[a-z0-9-]+\.supabase\.co\//i.test(fileUrl)) {
    return { ok: false, error: "Upload the document here rather than pasting a link" };
  }
  const type = r.type;
  return {
    ok: true,
    input: {
      vehicleId,
      type,
      number: str(r.number, 80),
      issuedOn,
      expiresOn,
      feePaise: Math.round(fee),
      insurer: type === "insurance" ? str(r.insurer, 120) : "",
      policyNo: type === "insurance" ? str(r.policyNo, 80) : "",
      fileUrl,
      fileName: fileUrl ? str(r.fileName, 160) : "",
      note: str(r.note, 500),
    },
  };
}

export type ExpiryStatus = "expired" | "due" | "ok" | "missing";
export const EXPIRY_SOON_DAYS = 30;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Expired once the expiry date is behind us (a PUC valid "till 14 Oct" is
 * still good on 14 Oct); due within 30 days; otherwise ok.
 */
export function expiryStatus(expiresOn: string, today: string, soonDays = EXPIRY_SOON_DAYS): { status: ExpiryStatus; daysLeft: number | null } {
  if (!isIsoDate(expiresOn) || !isIsoDate(today)) return { status: "missing", daysLeft: null };
  const left = daysBetween(today, expiresOn);
  if (left < 0) return { status: "expired", daysLeft: left };
  if (left <= soonDays) return { status: "due", daysLeft: left };
  return { status: "ok", daysLeft: left };
}

/**
 * The document in force for each type on one vehicle: the live one that
 * runs latest. A renewal is a new document, so history stays.
 */
export function currentDocsFor(docs: readonly VehicleDoc[], vehicleId: string): Partial<Record<VehicleDocType, VehicleDoc>> {
  const out: Partial<Record<VehicleDocType, VehicleDoc>> = {};
  for (const d of docs) {
    if (d.vehicleId !== vehicleId || d.status !== "active") continue;
    const cur = out[d.type];
    if (!cur || d.expiresOn > cur.expiresOn || (d.expiresOn === cur.expiresOn && d.createdAt > cur.createdAt)) {
      out[d.type] = d;
    }
  }
  return out;
}

export type DocAlert = {
  vehicleId: string;
  vehicleLabel: string;
  type: VehicleDocType;
  status: "expired" | "due";
  expiresOn: string;
  daysLeft: number;
};

/**
 * Expired and due-soon documents across the fleet, worst first. A type never
 * recorded is not an alert: not every vehicle needs every paper (a diesel bus
 * has no CNG hydro test) — the grid shows those as "not recorded" instead.
 */
export function vehicleDocAlerts(
  docs: readonly VehicleDoc[],
  vehicles: readonly { id: string; label: string }[],
  today: string,
): DocAlert[] {
  const out: DocAlert[] = [];
  for (const v of vehicles) {
    const cur = currentDocsFor(docs, v.id);
    for (const t of VEHICLE_DOC_TYPES) {
      const d = cur[t];
      if (!d) continue;
      const s = expiryStatus(d.expiresOn, today);
      if (s.status === "expired" || s.status === "due") {
        out.push({ vehicleId: v.id, vehicleLabel: v.label, type: t, status: s.status, expiresOn: d.expiresOn, daysLeft: s.daysLeft ?? 0 });
      }
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.vehicleLabel.localeCompare(b.vehicleLabel));
}

/* ─── Renewal fee → the books ─────────────────────────────── */

/**
 * The expense head a renewal fee is booked to: an expense account named for
 * vehicle insurance / permits / compliance (5033 "Vehicle Insurance &
 * Permits" in this school's chart). Picked by name for the same reason fuel
 * is (lib/fuelExpenseLine.ts): the office renames and renumbers heads. A
 * heading with sub-heads is never chosen — the forms do not post to those.
 * null = no suitable head; the fee is then recorded, not posted.
 */
export function pickVehicleDocExpenseAccount<T extends { code: string; name: string; kind: string; hasChildren?: boolean }>(
  accounts: readonly T[],
): T | null {
  const leaves = accounts.filter((a) => a.kind === "expense" && !a.hasChildren);
  const score = (a: T): number => {
    const n = a.name.toLowerCase();
    if (!/\b(vehicle|transport|bus|fleet)\b/.test(n)) return 0;
    if (/\binsurance\b/.test(n) && /\bpermit/.test(n)) return 3;
    if (/\b(insurance|permit|compliance|registration|road\s*tax)\b/.test(n)) return 2;
    return 0;
  };
  let best: T | null = null;
  let bestScore = 0;
  for (const a of leaves) {
    const s = score(a);
    if (s > bestScore || (s === bestScore && s > 0 && best && a.code < best.code)) {
      best = a;
      bestScore = s;
    }
  }
  return bestScore > 0 ? best : null;
}

/** Ledger idempotency source for a document's fee: one voucher per document, ever. */
export const VEHICLE_DOC_FEE_SOURCE = "transport_vehicle_doc";

/**
 * Dr the vehicle-papers head / Cr the cash box (1000) or the school bank the
 * money left. The same split as a hand payment elsewhere (lib/visitingPay.ts).
 */
export function vehicleDocFeeLines(input: {
  feePaise: number;
  expenseCode: string;
  mode: "cash" | "bank";
  cashCode: string;
  bankCode?: string;
  bankAccountId?: string;
  narration: string;
  ref?: string;
  date: string;
}): { ok: true; lines: LedgerLineInput[] } | { ok: false; error: string } {
  const amount = Math.round(input.feePaise);
  if (!(amount > 0)) return { ok: false, error: "There is no fee to book" };
  if (!input.expenseCode) return { ok: false, error: "No expense head for vehicle papers" };
  let money: { code: string; sub?: { kind: "bank_account"; id: string } };
  if (input.mode === "cash") money = { code: input.cashCode };
  else {
    const code = String(input.bankCode || "");
    if (!code || code === input.cashCode) return { ok: false, error: "Choose the school bank the money left" };
    money = { code, ...(input.bankAccountId ? { sub: { kind: "bank_account" as const, id: input.bankAccountId } } : {}) };
  }
  return {
    ok: true,
    lines: [
      { accountCode: input.expenseCode, debitPaise: amount, creditPaise: 0, narration: input.narration },
      {
        accountCode: money.code,
        debitPaise: 0,
        creditPaise: amount,
        narration: input.narration,
        ...(money.sub ? { subledgerKind: money.sub.kind, subledgerId: money.sub.id } : {}),
        instrument: { mode: input.mode, ref: (input.ref ?? "").slice(0, 80), date: input.date },
      },
    ],
  };
}
