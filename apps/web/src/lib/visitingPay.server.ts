/**
 * Visiting staff month work sheets — the server half. Rules and arithmetic in
 * lib/visitingPay.ts; this file reads the sources, keeps the sheet, and books
 * the payment.
 *
 *   build     a draft from the person's basis: register marks (punch), the
 *             timetable + published calendar (per period), survey days (per
 *             day). Any source that cannot be read refuses the build — a
 *             sheet of zeros would read as "did no work".
 *   refresh   the same on a draft, keeping every line the office changed
 *   adjust    add / change / remove a line, each with a reason (audited)
 *   approve   payroll approve, maker ≠ checker; TDS frozen; sheet locked
 *   reopen    payroll approve + a reason, only while unpaid
 *   pay       Cashfree (a payout request — booked when the money lands), or
 *             cash from the cash box, or a bank transfer made by hand.
 *             payment_key is claimed before the books move, so a sheet is
 *             paid once.
 */

import "server-only";

import { cashgramPhone, cashgramPhoneProblem } from "@/lib/cashgram";
import { classifyClassHolidayDay } from "@/lib/holidayPolicy";
import type { MastersState } from "@/lib/masters";
import { getServerTenantContext } from "@/lib/serverTenant";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import {
  ayOfMonth,
  buildVisitingLines,
  checkAdjustment,
  computeTds194J,
  fyMonths,
  fyOfMonth,
  cashfreeApplyDecision,
  cashfreeKey,
  cashfreePrepareDecision,
  handKey,
  handPayDecision,
  isMonthKey,
  isVisitingStaff,
  payrollOverlapProblem,
  tdsBasisKey,
  istToday,
  makerCheckerProblem,
  monthDates,
  normalizeVisitingPay,
  planRebuild,
  readSheetStatus,
  sheetGrossPaise,
  staffPayInstrument,
  unitForBasis,
  visitingPaymentLines,
  visitingRatePaise,
  visitingSetupProblems,
  type ComputedLine,
  type DayPunch,
  type SheetStatus,
  type StoredLine,
  type TdsComputation,
  type VisitingPayBasis,
  type VisitingPayMode,
  type VisitingUnit,
  type WorkLineSource,
  type WorkLineStatus,
} from "@/lib/visitingPay";

export type Fail = { ok: false; error: string };

/* ── shapes ───────────────────────────────────────────────────────────── */

export type VisitingStaffView = {
  id: string;
  empCode: string;
  fullName: string;
  status: string;
  basis: VisitingPayBasis | "";
  ratePaise: number | null;
  tds194j: boolean;
  panNo: string;
  hasBank: boolean;
  hasUpi: boolean;
  mobile: string;
  problems: { errors: string[]; warnings: string[] };
};

export type SheetView = {
  id: string;
  staffId: string;
  staffName: string;
  month: string;
  basis: VisitingPayBasis;
  ratePaise: number;
  tdsApplies: boolean;
  status: SheetStatus;
  grossPaise: number;
  tdsPaise: number;
  netPaise: number;
  tdsDetail: TdsComputation | null;
  warnings: string[];
  builtBy: string;
  builtAt: string | null;
  makers: string[];
  approvedBy: string;
  approvedAt: string | null;
  payMode: VisitingPayMode | "";
  /** Set while one payment holds the sheet ("cash:<id>", "bank:<id>", "cashfree:<id>"). */
  paymentKey: string;
  payoutRequestId: string;
  paidAt: string | null;
  paidBy: string;
  paidRef: string;
  ledgerVoucherNo: string;
  lastError: string;
  updatedAt: string;
};

export type LineView = StoredLine & {
  adjustedBy: string;
  adjustReason: string;
};

export type AuditView = { id: string; at: string; by: string; action: string; reason: string; detail: Record<string, unknown> };

function rowToSheet(r: Record<string, unknown>): SheetView {
  const tds = r.tds_detail && typeof r.tds_detail === "object" && "fy" in (r.tds_detail as object) ? (r.tds_detail as TdsComputation) : null;
  const pm = String(r.pay_mode ?? "");
  return {
    id: String(r.id),
    staffId: String(r.staff_id ?? ""),
    staffName: String(r.staff_name ?? ""),
    month: String(r.month ?? ""),
    basis: (["per_period", "per_hour", "per_day"].includes(String(r.basis)) ? r.basis : "per_day") as VisitingPayBasis,
    ratePaise: Number(r.rate_paise ?? 0),
    tdsApplies: r.tds_applies === true,
    status: readSheetStatus(r.status),
    grossPaise: Number(r.gross_paise ?? 0),
    tdsPaise: Number(r.tds_paise ?? 0),
    netPaise: Number(r.net_paise ?? 0),
    tdsDetail: tds,
    warnings: Array.isArray(r.warnings) ? (r.warnings as unknown[]).map(String) : [],
    builtBy: String(r.built_by ?? ""),
    builtAt: r.built_at ? String(r.built_at) : null,
    makers: Array.isArray(r.makers) ? (r.makers as unknown[]).map(String) : [],
    approvedBy: String(r.approved_by ?? ""),
    approvedAt: r.approved_at ? String(r.approved_at) : null,
    payMode: pm === "cashfree" || pm === "cash" || pm === "bank" ? pm : "",
    paymentKey: String(r.payment_key ?? ""),
    payoutRequestId: String(r.payout_request_id ?? ""),
    paidAt: r.paid_at ? String(r.paid_at) : null,
    paidBy: String(r.paid_by ?? ""),
    paidRef: String(r.paid_ref ?? ""),
    ledgerVoucherNo: String(r.ledger_voucher_no ?? ""),
    lastError: String(r.last_error ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

const UNITS = new Set(["period", "hour", "day"]);
const SOURCES = new Set(["timetable", "punch", "survey", "office"]);
const STATUSES = new Set(["counted", "unconfirmed", "flagged", "removed"]);

function rowToLine(r: Record<string, unknown>): LineView {
  return {
    id: String(r.id),
    key: String(r.line_key ?? ""),
    date: String(r.work_date ?? "").slice(0, 10),
    unit: (UNITS.has(String(r.unit)) ? r.unit : "day") as VisitingUnit,
    qty: Number(r.qty ?? 0),
    ratePaise: Number(r.rate_paise ?? 0),
    amountPaise: Number(r.amount_paise ?? 0),
    source: (SOURCES.has(String(r.source)) ? r.source : "office") as WorkLineSource,
    // Unknown status is not money: it never counts.
    status: (STATUSES.has(String(r.status)) ? r.status : "flagged") as WorkLineStatus,
    note: String(r.note ?? ""),
    adjustedAt: r.adjusted_at ? String(r.adjusted_at) : null,
    adjustedBy: String(r.adjusted_by ?? ""),
    adjustReason: String(r.adjust_reason ?? ""),
  };
}

function nid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function inr(p: number): string {
  return `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

async function ctxOrFail() {
  const ctx = await getServerTenantContext();
  return ctx;
}

async function audit(sheetId: string, by: string, action: string, reason = "", detail: Record<string, unknown> = {}) {
  const ctx = await ctxOrFail();
  if (!ctx) return;
  await ctx.sb.from("visiting_work_audit").insert({
    id: nid("vwa"),
    tenant_id: ctx.tenantId,
    sheet_id: sheetId,
    by_name: by,
    action,
    reason,
    detail,
  });
}

/* ── staff ────────────────────────────────────────────────────────────── */

type StaffProfile = Record<string, unknown> & {
  empCode?: string;
  fullName?: string;
  panNo?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  bankAccountName?: string;
  upiId?: string;
  mobile?: string;
  visitingPay?: unknown;
};

type StaffRowLite = { id: string; full_name: string | null; emp_code: string | null; category: string | null; status: string | null; mobile: string | null; profile: unknown };

function profileOf(r: StaffRowLite): StaffProfile {
  return r.profile && typeof r.profile === "object" ? (r.profile as StaffProfile) : {};
}

function toStaffView(r: StaffRowLite): VisitingStaffView {
  const p = profileOf(r);
  const vp = normalizeVisitingPay(p.visitingPay);
  const inst = staffPayInstrument({ bankAccountNo: p.bankAccountNo, bankIfsc: p.bankIfsc, upiId: "", mobile: "" }, () => "x");
  const upi = staffPayInstrument({ upiId: p.upiId }, () => "x");
  return {
    id: r.id,
    empCode: String(r.emp_code ?? p.empCode ?? ""),
    fullName: String(r.full_name ?? p.fullName ?? ""),
    status: String(r.status ?? "active"),
    basis: vp.basis,
    ratePaise: visitingRatePaise(vp),
    tds194j: vp.tds194j,
    panNo: String(p.panNo ?? ""),
    hasBank: inst.ok && inst.channel === "transfer",
    hasUpi: upi.ok && upi.channel === "transfer",
    mobile: String(r.mobile ?? p.mobile ?? ""),
    problems: visitingSetupProblems({ visitingPay: p.visitingPay, panNo: String(p.panNo ?? "") }),
  };
}

async function readStaffRow(staffId: string): Promise<StaffRowLite | null | "error"> {
  const ctx = await ctxOrFail();
  if (!ctx) return "error";
  const { data, error } = await ctx.sb
    .from("sis_staff")
    .select("id, full_name, emp_code, category, status, mobile, profile")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", staffId)
    .maybeSingle();
  if (error) return "error";
  return (data as StaffRowLite | null) ?? null;
}

export async function listVisitingStaff(): Promise<{ ok: true; staff: VisitingStaffView[] } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const res = await fetchAllPages<StaffRowLite>((from, to) =>
    ctx.sb
      .from("sis_staff")
      .select("id, full_name, emp_code, category, status, mobile, profile")
      .eq("tenant_id", ctx.tenantId)
      .eq("category", "visiting")
      .order("id")
      .range(from, to),
  );
  if (res.error) return { ok: false, error: `Could not read the staff list: ${res.error}` };
  return { ok: true, staff: res.rows.map(toStaffView).sort((a, b) => a.fullName.localeCompare(b.fullName)) };
}

/** Who Cashfree pays, as the staff record says NOW (never the screen). */
export async function readStaffPayee(
  staffId: string,
  wanted: "transfer" | "link" | "",
): Promise<
  | { ok: true; channel: "transfer" | "link"; name: string; accountNumber: string; ifsc: string; vpa: string; phone: string }
  | Fail
> {
  const row = await readStaffRow(staffId);
  if (row === "error") return { ok: false, error: "Could not read the staff record" };
  if (!row) return { ok: false, error: "Staff record not found" };
  if (!isVisitingStaff(row)) return { ok: false, error: "This person is not visiting staff any more" };
  const p = profileOf(row);
  const mobile = String(row.mobile || p.mobile || "");
  const inst = staffPayInstrument({ bankAccountNo: p.bankAccountNo, bankIfsc: p.bankIfsc, upiId: p.upiId, mobile }, cashgramPhoneProblem, wanted);
  if (!inst.ok) return inst;
  const name = String(p.bankAccountName || row.full_name || p.fullName || "").trim();
  if (inst.channel === "link") return { ok: true, channel: "link", name, accountNumber: "", ifsc: "", vpa: "", phone: cashgramPhone(mobile) };
  return { ok: true, channel: "transfer", name, accountNumber: inst.accountNumber, ifsc: inst.ifsc, vpa: inst.vpa, phone: cashgramPhone(mobile) };
}

/* ── sources ──────────────────────────────────────────────────────────── */

async function readPunches(staffId: string, month: string): Promise<{ ok: true; punches: Record<string, DayPunch> } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const dates = monthDates(month);
  const regs = await fetchAllPages<{ id: string; attendance_date: string }>((from, to) =>
    ctx.sb
      .from("staff_attendance_desk_registers")
      .select("id, attendance_date")
      .eq("tenant_id", ctx.tenantId)
      .gte("attendance_date", dates[0]!)
      .lte("attendance_date", dates[dates.length - 1]!)
      .order("id")
      .range(from, to),
  );
  if (regs.error) return { ok: false, error: `The staff attendance register could not be read (${regs.error})` };
  const dateOf = new Map(regs.rows.map((r) => [String(r.id), String(r.attendance_date).slice(0, 10)]));
  const punches: Record<string, DayPunch> = {};
  if (dateOf.size === 0) return { ok: true, punches };
  const marks = await fetchAllPages<{ id: string; register_id: string; status: string; in_time: string; out_time: string }>((from, to) =>
    ctx.sb
      .from("staff_attendance_desk_marks")
      .select("id, register_id, status, in_time, out_time")
      .eq("tenant_id", ctx.tenantId)
      .eq("staff_id", staffId)
      .in("register_id", [...dateOf.keys()])
      .order("id")
      .range(from, to),
  );
  if (marks.error) return { ok: false, error: `The staff attendance marks could not be read (${marks.error})` };
  for (const m of marks.rows) {
    const d = dateOf.get(String(m.register_id));
    if (!d) continue;
    punches[d] = { status: String(m.status || ""), inTime: String(m.in_time || ""), outTime: String(m.out_time || "") };
  }
  return { ok: true, punches };
}

async function readSurveyDays(staffId: string, month: string): Promise<{ ok: true; days: { day: string; status: string }[] } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const dates = monthDates(month);
  const res = await fetchAllPages<{ id: string; day: string; status: string }>((from, to) =>
    ctx.sb
      .from("survey_days")
      .select("id, day, status")
      .eq("tenant_id", ctx.tenantId)
      .eq("staff_id", staffId)
      .gte("day", dates[0]!)
      .lte("day", dates[dates.length - 1]!)
      .order("id")
      .range(from, to),
  );
  if (res.error) return { ok: false, error: `Survey days could not be read (${res.error})` };
  return { ok: true, days: res.rows.map((r) => ({ day: String(r.day).slice(0, 10), status: String(r.status || "") })) };
}

async function readMasters(): Promise<{ ok: true; masters: MastersState } | Fail> {
  const { fetchMastersDeskFromDb, deskBundleToMastersState } = await import("@/lib/mastersNormalized.server");
  const r = await fetchMastersDeskFromDb();
  if (r.readFailed) return { ok: false, error: "The school calendar (Masters) could not be read" };
  return { ok: true, masters: deskBundleToMastersState(r.bundle) };
}

/* ── sheets ───────────────────────────────────────────────────────────── */

async function readSheetRow(id: string): Promise<SheetView | null | "error"> {
  const ctx = await ctxOrFail();
  if (!ctx) return "error";
  const { data, error } = await ctx.sb.from("visiting_work_sheets").select("*").eq("tenant_id", ctx.tenantId).eq("id", id).maybeSingle();
  if (error) return "error";
  return data ? rowToSheet(data as Record<string, unknown>) : null;
}

async function readLines(sheetId: string): Promise<{ ok: true; lines: LineView[] } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const res = await fetchAllPages<Record<string, unknown>>((from, to) =>
    ctx.sb.from("visiting_work_lines").select("*").eq("tenant_id", ctx.tenantId).eq("sheet_id", sheetId).order("id").range(from, to),
  );
  if (res.error) return { ok: false, error: `Could not read the sheet's lines (${res.error})` };
  const lines = res.rows.map(rowToLine).sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  return { ok: true, lines };
}

export async function listSheets(filter: { month?: string; fromMonth?: string; toMonth?: string }): Promise<{ ok: true; sheets: SheetView[] } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const res = await fetchAllPages<Record<string, unknown>>((from, to) => {
    let q = ctx.sb.from("visiting_work_sheets").select("*").eq("tenant_id", ctx.tenantId);
    if (filter.month) q = q.eq("month", filter.month);
    if (filter.fromMonth) q = q.gte("month", filter.fromMonth);
    if (filter.toMonth) q = q.lte("month", filter.toMonth);
    return q.order("id").range(from, to);
  });
  if (res.error) return { ok: false, error: `Could not read the sheets (${res.error})` };
  return { ok: true, sheets: res.rows.map(rowToSheet).sort((a, b) => b.month.localeCompare(a.month) || a.staffName.localeCompare(b.staffName)) };
}

export async function getSheet(id: string): Promise<{ ok: true; sheet: SheetView; lines: LineView[]; audit: AuditView[] } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const sheet = await readSheetRow(id);
  if (sheet === "error") return { ok: false, error: "Could not read the sheet" };
  if (!sheet) return { ok: false, error: "No such sheet" };
  const lines = await readLines(id);
  if (!lines.ok) return lines;
  const au = await fetchAllPages<Record<string, unknown>>((from, to) =>
    ctx.sb.from("visiting_work_audit").select("*").eq("tenant_id", ctx.tenantId).eq("sheet_id", id).order("id").range(from, to),
  );
  if (au.error) return { ok: false, error: `Could not read the sheet's history (${au.error})` };
  const auditRows = au.rows
    .map((r) => ({
      id: String(r.id),
      at: String(r.at ?? ""),
      by: String(r.by_name ?? ""),
      action: String(r.action ?? ""),
      reason: String(r.reason ?? ""),
      detail: (r.detail && typeof r.detail === "object" ? r.detail : {}) as Record<string, unknown>,
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
  return { ok: true, sheet, lines: lines.lines, audit: auditRows };
}

/** Payroll runs that carry this person for this month (any status: a draft is salary on its way). */
async function payrollOverlap(staffId: string, month: string): Promise<{ ok: true; problem: string } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const { data: runs, error } = await ctx.sb.from("payroll_desk_runs").select("id, status, month").eq("tenant_id", ctx.tenantId).eq("month", month);
  // Fail closed: an unreadable payroll may already be paying these days.
  if (error) return { ok: false, error: `Payroll could not be read to rule out paying the month twice (${error.message})` };
  const ids = (runs ?? []).map((r) => String((r as { id: string }).id));
  if (!ids.length) return { ok: true, problem: "" };
  const { data: lines, error: lErr } = await ctx.sb
    .from("payroll_desk_run_lines")
    .select("run_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("staff_id", staffId)
    .in("run_id", ids)
    .limit(5);
  if (lErr) return { ok: false, error: `Payroll lines could not be read to rule out paying the month twice (${lErr.message})` };
  const onRun = new Set((lines ?? []).map((l) => String((l as { run_id: string }).run_id)));
  const hits = (runs ?? [])
    .filter((r) => onRun.has(String((r as { id: string }).id)))
    .map((r) => {
      const x = r as { id: string; status: string; month: string };
      return { runId: String(x.id), status: String(x.status), month: String(x.month) };
    });
  return { ok: true, problem: payrollOverlapProblem(hits, month) };
}

/** The year's other approved / paid sheets of this person — what TDS looks back over. */
async function earlierInFy(staffId: string, month: string, exceptId: string): Promise<{ ok: true; earlier: { id: string; month: string; grossPaise: number; tdsPaise: number }[] } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const months = fyMonths(fyOfMonth(month));
  const { data, error } = await ctx.sb
    .from("visiting_work_sheets")
    .select("id, month, status, gross_paise, tds_paise")
    .eq("tenant_id", ctx.tenantId)
    .eq("staff_id", staffId)
    .in("month", months)
    .in("status", ["approved", "paid"]);
  if (error) return { ok: false, error: `Could not read this year's earlier sheets for TDS (${error.message})` };
  return {
    ok: true,
    earlier: (data ?? [])
      .filter((r) => String((r as Record<string, unknown>).id) !== exceptId)
      .map((r) => {
        const x = r as Record<string, unknown>;
        return { id: String(x.id), month: String(x.month), grossPaise: Number(x.gross_paise ?? 0), tdsPaise: Number(x.tds_paise ?? 0) };
      }),
  };
}

/** Totals + TDS from the lines as stored. Draft sheets only. */
async function retotal(sheet: SheetView): Promise<{ ok: true; sheet: SheetView } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const lines = await readLines(sheet.id);
  if (!lines.ok) return lines;
  const gross = sheetGrossPaise(lines.lines);
  const prior = await earlierInFy(sheet.staffId, sheet.month, sheet.id);
  if (!prior.ok) return prior;
  const tds = computeTds194J({ applies: sheet.tdsApplies, month: sheet.month, grossPaise: gross, earlier: prior.earlier });
  const { error } = await ctx.sb
    .from("visiting_work_sheets")
    .update({ gross_paise: gross, tds_paise: tds.tdsPaise, net_paise: tds.netPaise, tds_detail: tds, updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", sheet.id)
    .eq("status", "draft");
  if (error) return { ok: false, error: `Could not save the totals (${error.message})` };
  const fresh = await readSheetRow(sheet.id);
  if (fresh === "error" || !fresh) return { ok: false, error: "Could not read the sheet back" };
  return { ok: true, sheet: fresh };
}

function lineToRow(l: ComputedLine, tenantId: string, sheetId: string) {
  return {
    id: nid("vwl"),
    tenant_id: tenantId,
    sheet_id: sheetId,
    line_key: l.key,
    work_date: l.date,
    unit: l.unit,
    qty: l.qty,
    rate_paise: l.ratePaise,
    amount_paise: l.amountPaise,
    source: l.source,
    status: l.status,
    note: l.note.slice(0, 300),
  };
}

/**
 * Build a month's sheet, or refresh a draft. Refused — not zero — when any
 * source the person's basis needs cannot be read.
 */
export async function buildSheet(input: { staffId: string; month: string; by: string; byKey: string }): Promise<{ ok: true; sheet: SheetView; message: string } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  if (!isMonthKey(input.month)) return { ok: false, error: "Pick a month" };
  const today = istToday();
  if (`${input.month}-01` > today) return { ok: false, error: "That month has not started yet" };

  const row = await readStaffRow(input.staffId);
  if (row === "error") return { ok: false, error: "Could not read the staff record" };
  if (!row) return { ok: false, error: "Staff record not found" };
  if (!isVisitingStaff(row)) return { ok: false, error: "Only visiting staff have a work sheet — set Employment type to Visiting on their profile" };
  const p = profileOf(row);
  const vp = normalizeVisitingPay(p.visitingPay);
  const setup = visitingSetupProblems({ visitingPay: p.visitingPay, panNo: String(p.panNo ?? "") });
  if (setup.errors.length) return { ok: false, error: setup.errors.join("; ") };
  const basis = vp.basis as VisitingPayBasis;
  const ratePaise = visitingRatePaise(vp)!;
  const name = String(row.full_name || p.fullName || row.id);

  const { data: existingRaw, error: exErr } = await ctx.sb
    .from("visiting_work_sheets")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("staff_id", input.staffId)
    .eq("month", input.month)
    .maybeSingle();
  if (exErr) return { ok: false, error: `Could not read the existing sheet (${exErr.message})` };
  const existing = existingRaw ? rowToSheet(existingRaw as Record<string, unknown>) : null;
  if (existing && existing.status !== "draft") {
    return { ok: false, error: `This sheet is ${existing.status} — reopen it (with a reason) before rebuilding` };
  }
  const overlap = await payrollOverlap(input.staffId, input.month);
  if (!overlap.ok) return overlap;
  if (overlap.problem) return { ok: false, error: overlap.problem };

  // Sources. Every read is checked: unknown must not become "no work".
  const punches = await readPunches(input.staffId, input.month);
  if (!punches.ok) return punches;
  let surveyDays: { day: string; status: string }[] | undefined;
  if (basis === "per_day") {
    const sv = await readSurveyDays(input.staffId, input.month);
    if (!sv.ok) return sv;
    surveyDays = sv.days;
  }
  let timetable: Parameters<typeof buildVisitingLines>[0]["timetable"];
  let classDay: Parameters<typeof buildVisitingLines>[0]["classDay"];
  let periodLabel: Parameters<typeof buildVisitingLines>[0]["periodLabel"];
  if (basis === "per_period") {
    const { fetchTimetableDeskFromDb } = await import("@/lib/timetableNormalized.server");
    const tt = await fetchTimetableDeskFromDb();
    if (!tt.ok) return { ok: false, error: "The timetable could not be read — periods cannot be counted. Try again in a minute." };
    const m = await readMasters();
    if (!m.ok) return m;
    const ay = ayOfMonth(input.month);
    // The live grids — the same ones the substitution desk reads.
    timetable = {
      grids: tt.bundle.grids.filter((g) => g.academicYearCode === ay),
      substitutions: tt.bundle.substitutions.filter((s) => s.date.startsWith(input.month)),
    };
    const masters = m.masters;
    classDay = (date, classId) => classifyClassHolidayDay(masters, date, ay, classId).status;
    const className = new Map(masters.classes.map((c) => [c.id, c.name]));
    const sectionName = new Map(masters.sections.map((s) => [s.id, s.name]));
    const subjectName = new Map((masters.subjects ?? []).map((s) => [s.id, s.nameEn || s.code]));
    periodLabel = (classId, sectionId, subjectId, periodNo) =>
      `${className.get(classId) || "Class"}${sectionName.get(sectionId) ? `-${sectionName.get(sectionId)}` : ""} · P${periodNo}${subjectName.get(subjectId) ? ` · ${subjectName.get(subjectId)}` : ""}`;
  }

  const built = buildVisitingLines({
    staffId: input.staffId,
    basis,
    ratePaise,
    month: input.month,
    todayIso: today,
    punches: punches.punches,
    surveyDays,
    timetable,
    classDay,
    periodLabel,
  });
  if (!built.ok) return built;
  const warnings = [...setup.warnings, ...built.warnings];

  let sheetId = existing?.id ?? "";
  const now = new Date().toISOString();
  if (!existing) {
    sheetId = nid("vws");
    const { error } = await ctx.sb.from("visiting_work_sheets").insert({
      id: sheetId,
      tenant_id: ctx.tenantId,
      staff_id: input.staffId,
      staff_name: name,
      month: input.month,
      basis,
      rate_paise: ratePaise,
      tds_applies: vp.tds194j,
      status: "draft",
      warnings,
      built_by: input.by,
      built_at: now,
      makers: [input.byKey],
    });
    if (error) {
      return { ok: false, error: /duplicate|unique/i.test(error.message) ? "Someone else just built this sheet — open it" : `Could not create the sheet (${error.message})` };
    }
    const rows = built.lines.map((l) => lineToRow(l, ctx.tenantId, sheetId));
    for (let i = 0; i < rows.length; i += 200) {
      const { error: lErr } = await ctx.sb.from("visiting_work_lines").insert(rows.slice(i, i + 200));
      if (lErr) {
        // A half-written sheet would pay part of the month: take it away whole.
        await ctx.sb.from("visiting_work_sheets").delete().eq("tenant_id", ctx.tenantId).eq("id", sheetId).eq("status", "draft");
        return { ok: false, error: `Could not save the sheet's lines (${lErr.message})` };
      }
    }
    await audit(sheetId, input.by, "built", "", { lines: built.lines.length, basis, ratePaise });
  } else {
    const stored = await readLines(existing.id);
    if (!stored.ok) return stored;
    const plan = planRebuild(stored.lines, built.lines);
    for (let i = 0; i < plan.insert.length; i += 200) {
      const { error } = await ctx.sb.from("visiting_work_lines").insert(plan.insert.slice(i, i + 200).map((l) => lineToRow(l, ctx.tenantId, existing.id)));
      if (error) return { ok: false, error: `Could not add new lines (${error.message})` };
    }
    for (const u of plan.update) {
      const { error } = await ctx.sb
        .from("visiting_work_lines")
        .update({
          work_date: u.line.date,
          unit: u.line.unit,
          qty: u.line.qty,
          rate_paise: u.line.ratePaise,
          amount_paise: u.line.amountPaise,
          source: u.line.source,
          status: u.line.status,
          note: u.line.note.slice(0, 300),
          updated_at: now,
        })
        .eq("tenant_id", ctx.tenantId)
        .eq("id", u.id)
        .is("adjusted_at", null);
      if (error) return { ok: false, error: `Could not update a line (${error.message})` };
    }
    // Named deletes only: computed lines whose source fact is gone and that
    // nobody touched.
    if (plan.remove.length) {
      const { error } = await ctx.sb
        .from("visiting_work_lines")
        .delete()
        .eq("tenant_id", ctx.tenantId)
        .eq("sheet_id", existing.id)
        .in("id", plan.remove)
        .is("adjusted_at", null)
        .neq("source", "office");
      if (error) return { ok: false, error: `Could not drop stale lines (${error.message})` };
    }
    const makers = existing.makers.includes(input.byKey) ? existing.makers : [...existing.makers, input.byKey];
    await ctx.sb
      .from("visiting_work_sheets")
      .update({ basis, rate_paise: ratePaise, tds_applies: vp.tds194j, staff_name: name, warnings, built_by: input.by, built_at: now, makers, updated_at: now })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", existing.id)
      .eq("status", "draft");
    await audit(existing.id, input.by, "refreshed", "", {
      added: plan.insert.length,
      changed: plan.update.length,
      dropped: plan.remove.length,
      basis,
      ratePaise,
      ...(existing.ratePaise !== ratePaise ? { rateWas: existing.ratePaise } : {}),
      ...(existing.basis !== basis ? { basisWas: existing.basis } : {}),
    });
  }

  const sheet = await readSheetRow(sheetId);
  if (sheet === "error" || !sheet) return { ok: false, error: "Could not read the sheet back" };
  const t = await retotal(sheet);
  if (!t.ok) return t;
  return { ok: true, sheet: t.sheet, message: existing ? "Sheet refreshed — lines the office changed were kept" : "Sheet built" };
}

async function draftSheetOrFail(sheetId: string): Promise<{ ok: true; sheet: SheetView } | Fail> {
  const s = await readSheetRow(sheetId);
  if (s === "error") return { ok: false, error: "Could not read the sheet" };
  if (!s) return { ok: false, error: "No such sheet" };
  if (s.status !== "draft") return { ok: false, error: `This sheet is ${s.status} and locked — reopen it (with a reason) to change it` };
  return { ok: true, sheet: s };
}

async function noteMaker(sheet: SheetView, by: string) {
  if (sheet.makers.includes(by)) return;
  const ctx = await ctxOrFail();
  if (!ctx) return;
  await ctx.sb
    .from("visiting_work_sheets")
    .update({ makers: [...sheet.makers, by], updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", sheet.id);
}

/** Change a line's quantity (confirms an unconfirmed one too). */
export async function adjustLine(input: { sheetId: string; lineId: string; qty: number; reason: string; by: string; byKey: string }): Promise<{ ok: true; sheet: SheetView } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const d = await draftSheetOrFail(input.sheetId);
  if (!d.ok) return d;
  const lines = await readLines(input.sheetId);
  if (!lines.ok) return lines;
  const l = lines.lines.find((x) => x.id === input.lineId);
  if (!l) return { ok: false, error: "No such line" };
  const bad = checkAdjustment({ qty: input.qty, unit: l.unit, reason: input.reason });
  if (bad) return { ok: false, error: bad };
  const amount = Math.round(input.qty * l.ratePaise);
  const now = new Date().toISOString();
  const { error } = await ctx.sb
    .from("visiting_work_lines")
    .update({ qty: input.qty, amount_paise: amount, status: "counted", adjusted_by: input.by, adjusted_at: now, adjust_reason: input.reason.trim().slice(0, 300), updated_at: now })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", l.id)
    .eq("sheet_id", input.sheetId);
  if (error) return { ok: false, error: `Could not change the line (${error.message})` };
  await audit(input.sheetId, input.by, l.status === "counted" ? "line_changed" : "line_confirmed", input.reason.trim(), {
    lineId: l.id,
    date: l.date,
    note: l.note,
    from: { qty: l.qty, status: l.status, amountPaise: l.amountPaise },
    to: { qty: input.qty, status: "counted", amountPaise: amount },
  });
  await noteMaker(d.sheet, input.byKey);
  return retotal(d.sheet);
}

/** Take a line off the sheet (kept, marked removed, with the reason). */
export async function removeLine(input: { sheetId: string; lineId: string; reason: string; by: string; byKey: string }): Promise<{ ok: true; sheet: SheetView } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  if (String(input.reason || "").trim().length < 4) return { ok: false, error: "Give a reason (it is kept with the sheet)" };
  const d = await draftSheetOrFail(input.sheetId);
  if (!d.ok) return d;
  const lines = await readLines(input.sheetId);
  if (!lines.ok) return lines;
  const l = lines.lines.find((x) => x.id === input.lineId);
  if (!l) return { ok: false, error: "No such line" };
  if (l.status === "removed") return { ok: false, error: "Already removed" };
  const now = new Date().toISOString();
  const { error } = await ctx.sb
    .from("visiting_work_lines")
    .update({ status: "removed", amount_paise: 0, adjusted_by: input.by, adjusted_at: now, adjust_reason: input.reason.trim().slice(0, 300), updated_at: now })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", l.id)
    .eq("sheet_id", input.sheetId);
  if (error) return { ok: false, error: `Could not remove the line (${error.message})` };
  await audit(input.sheetId, input.by, "line_removed", input.reason.trim(), { lineId: l.id, date: l.date, note: l.note, qty: l.qty, amountPaise: l.amountPaise });
  await noteMaker(d.sheet, input.byKey);
  return retotal(d.sheet);
}

/** Work the sources do not show (a class taken elsewhere, a forgotten punch) — with a reason. */
export async function addLine(input: { sheetId: string; date: string; qty: number; note: string; reason: string; by: string; byKey: string }): Promise<{ ok: true; sheet: SheetView } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const d = await draftSheetOrFail(input.sheetId);
  if (!d.ok) return d;
  if (!monthDates(d.sheet.month).includes(input.date)) return { ok: false, error: `The date must be in ${d.sheet.month}` };
  if (input.date > istToday()) return { ok: false, error: "That date has not come yet" };
  const unit = unitForBasis(d.sheet.basis);
  const bad = checkAdjustment({ qty: input.qty, unit, reason: input.reason });
  if (bad) return { ok: false, error: bad };
  if (!(input.qty > 0)) return { ok: false, error: "Enter how many to add" };
  const now = new Date().toISOString();
  const amount = Math.round(input.qty * d.sheet.ratePaise);
  const id = nid("vwl");
  const { error } = await ctx.sb.from("visiting_work_lines").insert({
    id,
    tenant_id: ctx.tenantId,
    sheet_id: input.sheetId,
    line_key: "",
    work_date: input.date,
    unit,
    qty: input.qty,
    rate_paise: d.sheet.ratePaise,
    amount_paise: amount,
    source: "office",
    status: "counted",
    note: (input.note || "Added by the office").trim().slice(0, 300),
    adjusted_by: input.by,
    adjusted_at: now,
    adjust_reason: input.reason.trim().slice(0, 300),
  });
  if (error) return { ok: false, error: `Could not add the line (${error.message})` };
  await audit(input.sheetId, input.by, "line_added", input.reason.trim(), { lineId: id, date: input.date, qty: input.qty, amountPaise: amount, note: input.note });
  await noteMaker(d.sheet, input.byKey);
  return retotal(d.sheet);
}

/** Approve: TDS recomputed against the year as it stands and frozen; the sheet locks. */
export async function approveSheet(input: { sheetId: string; by: string; byKey: string; byOwner: boolean }): Promise<{ ok: true; sheet: SheetView } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const d = await draftSheetOrFail(input.sheetId);
  if (!d.ok) return d;
  const mc = makerCheckerProblem({ approver: input.byKey, makers: d.sheet.makers, approverIsOwner: input.byOwner });
  if (mc) return { ok: false, error: mc };
  const lines = await readLines(input.sheetId);
  if (!lines.ok) return lines;
  const flagged = lines.lines.filter((l) => l.status === "flagged");
  if (flagged.length) {
    return { ok: false, error: `${flagged.length} line(s) are flagged (e.g. ${flagged[0]!.date}: ${flagged[0]!.note}). Fix the source and refresh, or change / remove them with a reason, before approving.` };
  }
  const gross = sheetGrossPaise(lines.lines);
  if (gross <= 0) return { ok: false, error: "Nothing is counted on this sheet — there is nothing to approve" };
  // Salary for the same days (a mid-month switch) is checked again here:
  // payroll may have been drafted after the sheet was built.
  const overlap = await payrollOverlap(d.sheet.staffId, d.sheet.month);
  if (!overlap.ok) return overlap;
  if (overlap.problem) return { ok: false, error: overlap.problem };
  const prior = await earlierInFy(d.sheet.staffId, d.sheet.month, d.sheet.id);
  if (!prior.ok) return prior;
  const tds = computeTds194J({ applies: d.sheet.tdsApplies, month: d.sheet.month, grossPaise: gross, earlier: prior.earlier });
  const basis = tdsBasisKey(prior.earlier);
  const now = new Date().toISOString();
  const { data, error } = await ctx.sb
    .from("visiting_work_sheets")
    .update({
      status: "approved",
      gross_paise: gross,
      tds_paise: tds.tdsPaise,
      net_paise: tds.netPaise,
      tds_detail: tds,
      approved_by: input.by,
      approved_at: now,
      updated_at: now,
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.sheetId)
    .eq("status", "draft")
    .select("id");
  if (error) return { ok: false, error: `Could not approve (${error.message})` };
  if (!data || data.length === 0) return { ok: false, error: "The sheet changed while you were looking — open it again" };
  // Another sheet of this person in the same FY approved at the same moment
  // would mean both took the year's catch-up TDS. Re-read what this TDS was
  // worked out against; if it moved, undo this approval.
  const after = await earlierInFy(d.sheet.staffId, d.sheet.month, d.sheet.id);
  if (!after.ok || tdsBasisKey(after.earlier) !== basis) {
    await ctx.sb
      .from("visiting_work_sheets")
      .update({ status: "draft", approved_by: "", approved_at: null, updated_at: new Date().toISOString() })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", input.sheetId)
      .eq("status", "approved")
      .eq("approved_at", now)
      .is("payment_key", null);
    return { ok: false, error: "Another of this person's sheets was approved at the same moment, which changes their TDS — approve again" };
  }
  await audit(input.sheetId, input.by, "approved", "", { grossPaise: gross, tdsPaise: tds.tdsPaise, netPaise: tds.netPaise });
  const fresh = await readSheetRow(input.sheetId);
  return fresh && fresh !== "error" ? { ok: true, sheet: fresh } : { ok: false, error: "Approved, but could not be read back" };
}

async function openPayoutRequestFor(sheetId: string): Promise<{ ok: true; open: { id: string; status: string } | null } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const { data, error } = await ctx.sb
    .from("payout_requests")
    .select("id, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("kind", "visiting_fee")
    .eq("bill_id", sheetId)
    .in("status", ["PENDING_APPROVAL", "SENT"])
    .limit(1);
  // Fail closed: an unreadable request may be money on its way.
  if (error) return { ok: false, error: `Could not check for a Cashfree payment on its way (${error.message})` };
  const r = (data ?? [])[0] as { id: string; status: string } | undefined;
  return { ok: true, open: r ? { id: String(r.id), status: String(r.status) } : null };
}

/** Back to draft — only while unpaid and nothing is on its way. */
export async function reopenSheet(input: { sheetId: string; reason: string; by: string; byKey: string }): Promise<{ ok: true; sheet: SheetView } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  if (String(input.reason || "").trim().length < 4) return { ok: false, error: "Give a reason for reopening (it is kept with the sheet)" };
  const s = await readSheetRow(input.sheetId);
  if (s === "error") return { ok: false, error: "Could not read the sheet" };
  if (!s) return { ok: false, error: "No such sheet" };
  if (s.status !== "approved") return { ok: false, error: s.status === "paid" ? "A paid sheet cannot be reopened — the money has gone" : "Only an approved sheet can be reopened" };
  const open = await openPayoutRequestFor(s.id);
  if (!open.ok) return open;
  if (open.open) return { ok: false, error: "A Cashfree payment for this sheet is waiting or on its way — cancel it first" };
  const now = new Date().toISOString();
  const { data, error } = await ctx.sb
    .from("visiting_work_sheets")
    .update({ status: "draft", approved_by: "", approved_at: null, makers: s.makers.includes(input.byKey) ? s.makers : [...s.makers, input.byKey], updated_at: now })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", s.id)
    .eq("status", "approved")
    .is("payment_key", null)
    .select("id");
  if (error) return { ok: false, error: `Could not reopen (${error.message})` };
  if (!data || data.length === 0) return { ok: false, error: "The sheet is being paid or has changed — open it again" };
  await audit(s.id, input.by, "reopened", input.reason.trim(), { approvedBy: s.approvedBy, approvedAt: s.approvedAt });
  const fresh = await readSheetRow(s.id);
  return fresh && fresh !== "error" ? { ok: true, sheet: fresh } : { ok: false, error: "Reopened, but could not be read back" };
}

/* ── paying ───────────────────────────────────────────────────────────── */
/*
 * One payment holds the sheet at a time, through payment_key:
 *   cash:<sheet> / bank:<sheet>   a hand payment being recorded
 *   cashfree:<sheet>              a Cashfree request prepared, on its way or
 *                                 waiting for approval (released if it dies)
 * The claim is one conditional UPDATE (… where payment_key is null), so two
 * ways of paying cannot both start. The voucher is keyed (visiting_fee, sheet
 * id), so a retry after a crash finds the voucher already posted and only
 * finishes marking the sheet paid.
 */

/** Claim the sheet for one payment. Whoever claims first pays; everyone else is refused. */
async function claimPayment(sheetId: string, key: string): Promise<boolean | "error"> {
  const ctx = await ctxOrFail();
  if (!ctx) return "error";
  const { data, error } = await ctx.sb
    .from("visiting_work_sheets")
    .update({ payment_key: key, updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", sheetId)
    .eq("status", "approved")
    .is("payment_key", null)
    .select("id");
  if (error) return "error";
  return !!data && data.length > 0;
}

async function releaseClaim(sheetId: string, key: string, why: string) {
  const ctx = await ctxOrFail();
  if (!ctx) return;
  await ctx.sb
    .from("visiting_work_sheets")
    .update({ payment_key: null, last_error: why.slice(0, 500), updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", sheetId)
    .eq("payment_key", key)
    .eq("status", "approved");
}

async function postPayment(sheet: SheetView, mode: VisitingPayMode, opts: { date: string; ref: string; by: string; bankLedgerCode?: string; bankAccountId?: string }) {
  const narration = `Visiting fees ${sheet.month} — ${sheet.staffName}`;
  const lines = visitingPaymentLines({
    grossPaise: sheet.grossPaise,
    tdsPaise: sheet.tdsPaise,
    netPaise: sheet.netPaise,
    mode,
    bankLedgerCode: opts.bankLedgerCode,
    bankAccountId: opts.bankAccountId,
    staff: { id: sheet.staffId, name: sheet.staffName },
    narration,
    instrument: { mode, ref: opts.ref.slice(0, 80), date: opts.date },
  });
  if (!lines.ok) return lines;
  const { ledgerPost } = await import("@/lib/ledger/ledger.server");
  return ledgerPost({
    voucherType: "payment",
    date: opts.date,
    narration: `${narration} (gross ${inr(sheet.grossPaise)}, TDS ${inr(sheet.tdsPaise)})`.slice(0, 240),
    // One voucher per sheet, ever: a replay answers created=false.
    sourceType: "visiting_fee",
    sourceId: sheet.id,
    createdBy: opts.by,
    lines: lines.lines,
  });
}

/**
 * The voucher is in the book: the sheet must end 'paid'. Retried, because a
 * sheet left 'approved' after its voucher posted could be paid again.
 */
async function markPaid(sheetId: string, key: string, patch: Record<string, unknown>): Promise<{ ok: true } | Fail> {
  const ctx = await ctxOrFail();
  if (!ctx) return { ok: false, error: "No tenant context" };
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await ctx.sb
      .from("visiting_work_sheets")
      .update({ status: "paid", last_error: "", ...patch, updated_at: new Date().toISOString() })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", sheetId)
      .eq("payment_key", key)
      .select("id");
    if (!error && data && data.length > 0) return { ok: true };
    last = error?.message || "the sheet no longer holds this payment";
    if (!error) break; // claim moved: retrying will not help
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  await ctx.sb
    .from("visiting_work_sheets")
    .update({ last_error: `Voucher posted but the sheet could not be marked paid (${last}) — pay again with the same method to finish; the voucher will not be posted twice.` })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", sheetId);
  return { ok: false, error: last };
}

/**
 * Paid by hand: cash from the cash box (Cr 1000) or a bank transfer the
 * office made (Cr that bank).
 */
export async function payByHand(input: {
  sheetId: string;
  mode: "cash" | "bank";
  date: string;
  ref: string;
  bankLedgerCode?: string;
  by: string;
}): Promise<{ ok: true; sheet: SheetView; message: string } | Fail> {
  const s = await readSheetRow(input.sheetId);
  if (s === "error") return { ok: false, error: "Could not read the sheet" };
  if (!s) return { ok: false, error: "No such sheet" };
  if (s.status === "paid") return { ok: false, error: "This sheet is already paid" };
  if (s.status !== "approved") return { ok: false, error: "Approve the sheet before paying it" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date > istToday()) return { ok: false, error: "Enter the date it was paid (not in the future)" };
  let bankAccountId = "";
  if (input.mode === "bank") {
    if (input.ref.trim().length < 4) return { ok: false, error: "Enter the bank's UTR / reference" };
    const { topupBanks } = await import("@/lib/payoutRequests.server");
    const bank = (await topupBanks()).find((b) => b.code === input.bankLedgerCode);
    if (!bank) return { ok: false, error: "Choose the school bank the money left" };
    bankAccountId = bank.bankAccountId;
  }

  const key = handKey(input.mode, s.id);
  const decision = handPayDecision({ status: s.status, paymentKey: s.paymentKey, mode: input.mode, sheetId: s.id });
  if (decision.action === "refuse") return { ok: false, error: decision.error };
  if (decision.action === "claim") {
    const claimed = await claimPayment(s.id, key);
    if (claimed === "error") return { ok: false, error: "Could not claim the sheet for payment — try again" };
    if (!claimed) return { ok: false, error: "This sheet is already being paid" };
  }
  // Checked after the claim: a request made before the claim existed would
  // otherwise slip past and pay the month a second time.
  const open = await openPayoutRequestFor(s.id);
  if (!open.ok || open.open) {
    await releaseClaim(s.id, key, open.ok ? "A Cashfree payment is on its way" : open.error);
    return { ok: false, error: open.ok ? "A Cashfree payment for this sheet is waiting or on its way — cancel it before paying another way" : open.error };
  }
  const posted = await postPayment(s, input.mode, { date: input.date, ref: input.ref.trim(), by: input.by, bankLedgerCode: input.bankLedgerCode, bankAccountId });
  if (!posted.ok) {
    await releaseClaim(s.id, key, posted.error);
    return { ok: false, error: `The books refused the payment: ${posted.error}` };
  }
  const marked = await markPaid(s.id, key, { pay_mode: input.mode, paid_at: new Date().toISOString(), paid_by: input.by, paid_ref: input.ref.trim().slice(0, 80), ledger_voucher_no: posted.voucherNo });
  if (!marked.ok) return { ok: false, error: `Voucher ${posted.voucherNo} posted, but the sheet could not be marked paid (${marked.error}). Record the payment again the same way to finish — it will not post twice.` };
  await audit(s.id, input.by, "paid", "", { mode: input.mode, date: input.date, ref: input.ref.trim(), voucherNo: posted.voucherNo, netPaise: s.netPaise, tdsPaise: s.tdsPaise, replay: !posted.created });
  const fresh = await readSheetRow(s.id);
  return fresh && fresh !== "error"
    ? { ok: true, sheet: fresh, message: `Paid ${inr(s.netPaise)}${s.tdsPaise ? ` (TDS ${inr(s.tdsPaise)} to 2310)` : ""} — voucher ${posted.voucherNo}` }
    : { ok: false, error: `Paid (voucher ${posted.voucherNo}), but could not be read back` };
}

/**
 * Hold an approved sheet for a Cashfree payment (approved, unpaid, net ≥ ₹1,
 * nothing else holding it). Released by releaseCashfreeClaim if the request
 * dies before any money moves.
 */
export async function claimSheetForCashfree(sheetId: string): Promise<{ ok: true; sheet: SheetView } | Fail> {
  const s = await readSheetRow(sheetId);
  if (s === "error") return { ok: false, error: "Could not read the sheet" };
  if (!s) return { ok: false, error: "No such sheet" };
  if (s.status === "paid") return { ok: false, error: "This sheet is already paid" };
  if (s.status !== "approved") return { ok: false, error: "Approve the sheet before paying it" };
  if (s.netPaise < 100) return { ok: false, error: "The net amount is under ₹1 — pay it in cash" };
  const d = cashfreePrepareDecision({ status: s.status, paymentKey: s.paymentKey, sheetId: s.id });
  if (d) return { ok: false, error: d };
  const claimed = await claimPayment(s.id, cashfreeKey(s.id));
  if (claimed === "error") return { ok: false, error: "Could not claim the sheet for payment — try again" };
  if (!claimed) return { ok: false, error: "This sheet is already being paid" };
  return { ok: true, sheet: { ...s, paymentKey: cashfreeKey(s.id) } };
}

/** The Cashfree request died (failed, rejected, cancelled) before money moved: free the sheet. */
export async function releaseCashfreeClaim(sheetId: string, why: string) {
  await releaseClaim(sheetId, cashfreeKey(sheetId), why);
}

export async function notePayoutRequest(sheetId: string, requestId: string, by: string) {
  const ctx = await ctxOrFail();
  if (!ctx) return;
  await ctx.sb
    .from("visiting_work_sheets")
    .update({ payout_request_id: requestId, last_error: "", updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", sheetId);
  await audit(sheetId, by, "cashfree_requested", "", { requestId });
}

/**
 * Cashfree says the money arrived (transfer SUCCESS / link REDEEMED): book it
 * from the wallet, once. A sheet already paid another way is flagged, not
 * booked twice.
 */
export async function applyVisitingFeePaid(input: { sheetId: string; requestId: string; ref: string; by: string }): Promise<{ ok: true; voucherNo: string } | Fail> {
  const s = await readSheetRow(input.sheetId);
  if (s === "error") return { ok: false, error: "Could not read the sheet" };
  if (!s) return { ok: false, error: "The sheet is gone" };
  const key = cashfreeKey(s.id);
  const paidTwice = async (how: string) => {
    await audit(s.id, "cashfree", "paid_twice", "", { requestId: input.requestId, paidBefore: how });
    const ctx = await ctxOrFail();
    if (ctx) {
      await ctx.sb
        .from("visiting_work_sheets")
        .update({ last_error: `PAID TWICE: Cashfree paid ${inr(s.netPaise)} (request ${input.requestId}) but the sheet was already paid ${how}. Recover it from ${s.staffName}, or set it against next month.` })
        .eq("tenant_id", ctx.tenantId)
        .eq("id", s.id);
    }
    return { ok: true as const, voucherNo: "PAID TWICE — see the sheet" };
  };
  const d = cashfreeApplyDecision({ status: s.status, paymentKey: s.paymentKey, sheetId: s.id, payMode: s.payMode, payoutRequestId: s.payoutRequestId, requestId: input.requestId });
  if (d.action === "done") return { ok: true, voucherNo: s.ledgerVoucherNo };
  if (d.action === "paid_twice") return paidTwice(d.how);
  if (d.action === "claim") {
    // Released after a false failure, then the money landed after all.
    const claimed = await claimPayment(s.id, key);
    if (claimed === "error") return { ok: false, error: "Could not claim the sheet" };
    if (!claimed) return applyVisitingFeePaid(input);
  }
  const date = istToday();
  const posted = await postPayment(s, "cashfree", { date, ref: input.ref, by: input.by });
  if (!posted.ok) return { ok: false, error: posted.error };
  const marked = await markPaid(s.id, key, { pay_mode: "cashfree", payout_request_id: input.requestId, paid_at: new Date().toISOString(), paid_by: input.by, paid_ref: input.ref.slice(0, 80), ledger_voucher_no: posted.voucherNo });
  // Not ok → the request stays unapplied and Check status retries; the voucher will not repeat.
  if (!marked.ok) return { ok: false, error: `voucher ${posted.voucherNo} posted; sheet not marked paid (${marked.error})` };
  await audit(s.id, "cashfree", "paid", "", { mode: "cashfree", requestId: input.requestId, ref: input.ref, voucherNo: posted.voucherNo, netPaise: s.netPaise, tdsPaise: s.tdsPaise });
  return { ok: true, voucherNo: posted.voucherNo };
}

/**
 * The bank returned a Cashfree payment after it was booked. The sheet stays
 * paid (its voucher is the record of what was owed and deducted); what the
 * office must do is written on the sheet.
 */
export async function flagVisitingFeeReturned(sheetId: string, requestId: string) {
  const s = await readSheetRow(sheetId);
  if (!s || s === "error") return;
  const ctx = await ctxOrFail();
  if (!ctx) return;
  await ctx.sb
    .from("visiting_work_sheets")
    .update({
      last_error: `RETURNED: the bank sent back ${inr(s.netPaise)} (request ${requestId}) after it was booked as voucher ${s.ledgerVoucherNo}; the money is back in the Cashfree wallet. To pay ${s.staffName} again: in Accounts → Vouchers reverse ${s.ledgerVoucherNo}, then post a payment voucher with the same split (Dr 5075 ${inr(s.grossPaise)} / Cr 2310 ${inr(s.tdsPaise)} / Cr cash or bank ${inr(s.netPaise)}) when you pay them — fix their bank details first.`,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", sheetId);
  await audit(sheetId, "cashfree", "payment_returned", "", { requestId, voucherNo: s.ledgerVoucherNo });
}

/** Banks the office can say a hand-made transfer left from. */
export async function payBanks(): Promise<{ code: string; name: string; bankAccountId: string }[]> {
  const { topupBanks } = await import("@/lib/payoutRequests.server");
  return topupBanks();
}
