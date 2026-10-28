/**
 * The arithmetic of the staff advance register, with no storage and no
 * browser: how a stored row is read, what has been recovered and what is
 * still due. lib/staffAdvance.ts (the web Advances screen) and the staff
 * app's management view (GET /api/v1/staff/advances-overview) both use
 * these, so the phone can never show a figure the web would not.
 *
 * Pure: self-tested in staffPayrollMgmt.selftest.ts.
 */

import type { PayrollPaymentMode } from "@/lib/payroll";
import type {
  AdvanceRecovery,
  AdvanceRecoveryMethod,
  AdvanceSource,
  AdvanceStatus,
  StaffAdvance,
} from "@/lib/staffAdvance";

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeAdvanceRecovery(r: Partial<AdvanceRecovery>): AdvanceRecovery {
  const method: AdvanceRecoveryMethod =
    r.method === "return_to_school" ? "return_to_school" : "salary";
  return {
    id: String(r.id || nid("ar")),
    advanceId: String(r.advanceId || ""),
    method,
    payrollRunId: String(r.payrollRunId || ""),
    month: String(r.month || ""),
    amount: Math.max(0, Number(r.amount) || 0),
    recoveredAt: String(r.recoveredAt || ""),
    recoveredBy: String(r.recoveredBy || ""),
    note: String(r.note || ""),
    returnMode: (r.returnMode as PayrollPaymentMode) || "",
  };
}

export function normalizeStaffAdvance(a: Partial<StaffAdvance>): StaffAdvance {
  const amount = Math.max(0, Number(a.amount) || 0);
  const recoveries = (Array.isArray(a.recoveries) ? a.recoveries : []).map(
    normalizeAdvanceRecovery,
  );
  const recovered = recoveries.reduce((s, r) => s + r.amount, 0);
  const status: AdvanceStatus =
    recovered >= amount - 0.5 ? "closed" : "open";
  const source: AdvanceSource =
    a.source === "with_salary" || a.source === "other" ? a.source : "cash";
  return {
    id: String(a.id || nid("adv")),
    staffId: String(a.staffId || ""),
    empCode: String(a.empCode || ""),
    fullName: String(a.fullName || ""),
    amount,
    givenDate: String(a.givenDate || "").slice(0, 10),
    paymentMode: (a.paymentMode as PayrollPaymentMode) || "cash",
    note: String(a.note || ""),
    source,
    payrollRunId: String(a.payrollRunId || ""),
    status,
    createdBy: String(a.createdBy || ""),
    createdAt: String(a.createdAt || ""),
    recoveries,
  };
}

export function recoveredTotal(adv: StaffAdvance): number {
  return adv.recoveries.reduce((s, r) => s + r.amount, 0);
}

export function outstandingOf(adv: StaffAdvance): number {
  return Math.max(0, adv.amount - recoveredTotal(adv));
}

export type StaffAdvanceTotals = {
  staffId: string;
  empCode: string;
  fullName: string;
  /** Every advance ever given (principal). */
  taken: number;
  /** Every recovery — from salary or returned to the school. */
  recovered: number;
  /** Sum of each advance's own outstanding (never below 0 per advance). */
  due: number;
  advanceCount: number;
  openCount: number;
  /** Newest advance first. */
  advances: StaffAdvance[];
};

/**
 * Per-person totals over the register — only people with at least one
 * advance. `due` is the web's figure exactly: the sum of outstandingOf over
 * that person's advances (advanceSummary / outstandingForStaff), so an
 * over-recovered advance never cancels another one's balance.
 */
export function advanceTotalsByStaff(raw: readonly unknown[]): StaffAdvanceTotals[] {
  const map = new Map<string, StaffAdvanceTotals>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const a = normalizeStaffAdvance(row as Partial<StaffAdvance>);
    if (!a.staffId) continue;
    const t = map.get(a.staffId) ?? {
      staffId: a.staffId,
      empCode: a.empCode,
      fullName: a.fullName,
      taken: 0,
      recovered: 0,
      due: 0,
      advanceCount: 0,
      openCount: 0,
      advances: [],
    };
    // The newest row names the person (a rename shows its latest spelling).
    if (!t.fullName && a.fullName) t.fullName = a.fullName;
    if (!t.empCode && a.empCode) t.empCode = a.empCode;
    const bal = outstandingOf(a);
    t.taken += a.amount;
    t.recovered += recoveredTotal(a);
    t.due += bal;
    t.advanceCount += 1;
    if (bal > 0) t.openCount += 1;
    t.advances.push(a);
    map.set(a.staffId, t);
  }
  for (const t of map.values()) {
    t.advances.sort((x, y) => y.givenDate.localeCompare(x.givenDate));
  }
  // Most due first, then by code — the people the office must chase on top.
  return [...map.values()].sort(
    (x, y) => y.due - x.due || x.empCode.localeCompare(y.empCode) || x.fullName.localeCompare(y.fullName),
  );
}
