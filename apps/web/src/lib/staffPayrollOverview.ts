/**
 * Every staff member's pay, month by month, for one session (April–March) —
 * the staff app's management payslip view (GET /api/v1/staff/payroll-overview).
 *
 * The figures are the web's, never re-derived:
 *  - a month's gross / deductions / net / payable come from the person's
 *    best run of the month — paid → posted → approved — the same pick as
 *    monthPayslipLines and the payslip (lib/staffPayslips);
 *  - a payment's date follows the book (groupPayrollPayments): the line's own
 *    paid day, else — only when no line of that run carries one — the run's
 *    paid day;
 *  - a month nobody has run for this person is "not run", never ₹0; one
 *    still in draft / awaiting approval is "preparing".
 *
 * A month can be paid in parts (staggered runs, 13 Oct 2026): every
 * approved / posted / paid line of the person in that month is listed as a
 * part with its own amount and date, and what is still unpaid is shown.
 *
 * Pure: no storage, no network. Self-tested in staffPayrollMgmt.selftest.ts.
 */

import type { PayrollRun, PayrollRunStatus, PayrollStaffLine } from "@/lib/payroll";
import { linePayable } from "@/lib/payrollPayGroups";

const COMMITTED: ReadonlySet<PayrollRunStatus> = new Set(["approved", "posted", "paid"]);
const rank = (s: PayrollRunStatus) => (s === "paid" ? 3 : s === "posted" ? 2 : s === "approved" ? 1 : 0);

/** "2026-27" → its twelve months "2026-04" … "2027-03"; [] when malformed. */
export function sessionMonths(session: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(String(session || "").trim());
  if (!m) return [];
  const start = Number(m[1]);
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const mm = ((3 + i) % 12) + 1;
    const yy = i < 9 ? start : start + 1;
    out.push(`${yy}-${String(mm).padStart(2, "0")}`);
  }
  return out;
}

/** The session a month falls in: "2026-09" → "2026-27", "2027-02" → "2026-27". */
export function sessionOfMonth(ym: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(String(ym || ""));
  if (!m) return "";
  const y = Number(m[1]);
  const start = Number(m[2]) >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export type PayrollPart = {
  runId: string;
  runStatus: PayrollRunStatus;
  /** What this line pays (0 while on June hold). */
  amount: number;
  paid: boolean;
  /** YYYY-MM-DD the money left, "" while unpaid. */
  paidOn: string;
  paymentMode: string;
  paymentRef: string;
};

export type PayrollMonthState = "not_run" | "preparing" | "approved" | "posted" | "paid";

export type PayrollMonthRow = {
  month: string;
  state: PayrollMonthState;
  /** Null when not run / preparing — unknown, not zero. */
  gross: number | null;
  totalDeductions: number | null;
  netPay: number | null;
  /** Payable this month (net less a June hold). */
  payable: number | null;
  paid: number | null;
  /** payable − paid, never below 0. */
  unpaid: number | null;
  onHold: boolean;
  holdNote: string;
  parts: PayrollPart[];
  /** Approved/posted/paid lines of this person in the month beyond the first (should be 0). */
  extraRuns: number;
};

export type StaffPayrollRow = {
  staffId: string;
  empCode: string;
  fullName: string;
  /** On the active roster today. */
  active: boolean;
  months: PayrollMonthRow[];
  monthsRun: number;
  netTotal: number;
  paidTotal: number;
  unpaidTotal: number;
};

export type RosterEntry = { id: string; empCode: string; fullName: string; status?: string };

/** The day a committed line was paid, by the book's rule; "" = unpaid. */
export function linePaidOn(run: Pick<PayrollRun, "status" | "paidAt" | "lines">, line: Pick<PayrollStaffLine, "paidOn">): string {
  if (line.paidOn) return String(line.paidOn).slice(0, 10);
  if (run.status !== "paid") return "";
  if (run.lines.some((l) => !!l.paidOn)) return "";
  return paidAtDay(run.paidAt);
}

/** The IST calendar day of an ISO timestamp (a run's paidAt). */
function paidAtDay(iso: string): string {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t)) return String(iso || "").slice(0, 10);
  return new Date(t + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * Months listed for a session: all twelve for a past one; for the current
 * one, April up to this month (a future month is not "not run" yet).
 */
export function visibleSessionMonths(session: string, todayYm: string): string[] {
  return sessionMonths(session).filter((m) => !todayYm || m <= todayYm);
}

export function buildStaffPayrollOverview(input: {
  runs: readonly PayrollRun[];
  roster: readonly RosterEntry[];
  session: string;
  /** YYYY-MM of today (IST). */
  todayYm: string;
}): StaffPayrollRow[] {
  const months = visibleSessionMonths(input.session, input.todayYm);
  const monthSet = new Set(months);
  type Hit = { run: PayrollRun; line: PayrollStaffLine };
  // staffId → month → hits
  const byStaff = new Map<string, Map<string, Hit[]>>();
  const names = new Map<string, { empCode: string; fullName: string }>();
  for (const run of input.runs) {
    if (!monthSet.has(run.month)) continue;
    for (const line of run.lines) {
      if (!line.staffId) continue;
      const m = byStaff.get(line.staffId) ?? new Map<string, Hit[]>();
      const list = m.get(run.month) ?? [];
      list.push({ run, line });
      m.set(run.month, list);
      byStaff.set(line.staffId, m);
      if (!names.has(line.staffId)) names.set(line.staffId, { empCode: line.empCode, fullName: line.fullName });
    }
  }

  const people = new Map<string, { empCode: string; fullName: string; active: boolean }>();
  for (const s of input.roster) {
    if (!s.id) continue;
    const active = (s.status || "active") === "active";
    // A member who left shows only when the session paid them something.
    if (!active && !byStaff.has(s.id)) continue;
    people.set(s.id, { empCode: s.empCode || "", fullName: s.fullName || "", active });
  }
  for (const [id, n] of names) {
    if (!people.has(id)) people.set(id, { ...n, active: false });
  }

  const rows: StaffPayrollRow[] = [];
  for (const [staffId, who] of people) {
    const hitsByMonth = byStaff.get(staffId) ?? new Map<string, Hit[]>();
    const monthRows: PayrollMonthRow[] = months.map((month) => {
      const hits = hitsByMonth.get(month) ?? [];
      const committed = hits.filter((h) => COMMITTED.has(h.run.status));
      if (committed.length === 0) {
        return {
          month,
          state: hits.length > 0 ? "preparing" : "not_run",
          gross: null,
          totalDeductions: null,
          netPay: null,
          payable: null,
          paid: null,
          unpaid: null,
          onHold: false,
          holdNote: "",
          parts: [],
          extraRuns: 0,
        };
      }
      let best = committed[0]!;
      for (const h of committed) if (rank(h.run.status) > rank(best.run.status)) best = h;
      const parts: PayrollPart[] = committed
        .map(({ run, line }) => {
          const paidOn = linePaidOn(run, line);
          return {
            runId: run.id,
            runStatus: run.status,
            amount: linePayable(line),
            paid: !!paidOn,
            paidOn,
            paymentMode: String(line.paymentMode || ""),
            paymentRef: String(line.paymentRef || ""),
          };
        })
        .sort((a, b) => (a.paidOn || "9999").localeCompare(b.paidOn || "9999") || a.runId.localeCompare(b.runId));
      const payable = linePayable(best.line);
      const paid = parts.filter((p) => p.paid).reduce((s, p) => s + p.amount, 0);
      return {
        month,
        state: best.run.status as PayrollMonthState,
        gross: best.line.gross,
        totalDeductions: best.line.totalDeductions,
        netPay: best.line.netPay,
        payable,
        paid,
        unpaid: Math.max(0, payable - paid),
        onHold: !!best.line.juneHold && !best.line.eligibleForJuneDraw,
        holdNote: String(best.line.holdNote || ""),
        parts,
        extraRuns: committed.length - 1,
      };
    });
    const run = monthRows.filter((m) => m.netPay !== null);
    rows.push({
      staffId,
      empCode: who.empCode,
      fullName: who.fullName,
      active: who.active,
      months: monthRows,
      monthsRun: run.length,
      netTotal: run.reduce((s, m) => s + (m.netPay ?? 0), 0),
      paidTotal: run.reduce((s, m) => s + (m.paid ?? 0), 0),
      unpaidTotal: run.reduce((s, m) => s + (m.unpaid ?? 0), 0),
    });
  }
  return rows.sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      a.empCode.localeCompare(b.empCode) ||
      a.fullName.localeCompare(b.fullName),
  );
}
