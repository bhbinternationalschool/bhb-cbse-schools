/**
 * Staff salary advances — issue → outstanding → recover via payroll or return to school.
 * Payroll advance outstanding is always locked to ledger total due.
 */

import type { MastersState } from "@/lib/masters";
import type { PayrollPaymentMode, PayrollRun } from "@/lib/payroll";
import { assertStaffAdvancesPermission } from "@/lib/rbacGuard";
export type AdvanceStatus = "open" | "closed";

export type AdvanceSource = "cash" | "with_salary" | "other";

export type AdvanceRecoveryMethod = "salary" | "return_to_school";

export type StaffAdvance = {
  id: string;
  staffId: string;
  empCode: string;
  fullName: string;
  /** Principal advanced */
  amount: number;
  givenDate: string;
  paymentMode: PayrollPaymentMode;
  note: string;
  source: AdvanceSource;
  /** Set when issued with a payroll run (advance with salary) */
  payrollRunId: string;
  status: AdvanceStatus;
  createdBy: string;
  createdAt: string;
  recoveries: AdvanceRecovery[];
};

export type AdvanceRecovery = {
  id: string;
  advanceId: string;
  method: AdvanceRecoveryMethod;
  /** Payroll run id when method = salary */
  payrollRunId: string;
  /** YYYY-MM when from salary; empty for return */
  month: string;
  amount: number;
  /** When returned to school / recovered */
  recoveredAt: string;
  recoveredBy: string;
  note: string;
  returnMode: PayrollPaymentMode | "";
};

export type AdvanceState = {
  version: 1;
  advances: StaffAdvance[];
};

const STORAGE_KEY = "bhb_staff_advances_v1";

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function loadAdvances(): AdvanceState {
  if (typeof window === "undefined") return { version: 1, advances: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, advances: [] };
    const parsed = JSON.parse(raw) as Partial<AdvanceState>;
    return {
      version: 1,
      advances: Array.isArray(parsed.advances)
        ? parsed.advances.map(normalizeAdvance)
        : [],
    };
  } catch {
    return { version: 1, advances: [] };
  }
}

export function saveAdvances(state: AdvanceState) {
  if (!assertStaffAdvancesPermission("edit", "saveAdvances")) return;
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/staffAdvancesPersistence").then(
    ({ scheduleStaffAdvancesSync }) => {
      scheduleStaffAdvancesSync(state);
    },
  );
}

export function writeAdvancesLocalRaw(state: AdvanceState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function advancesStateIsEmpty(state: AdvanceState): boolean {
  return (state.advances?.length ?? 0) === 0;
}

function normalizeRecovery(r: Partial<AdvanceRecovery>): AdvanceRecovery {
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

function normalizeAdvance(a: Partial<StaffAdvance>): StaffAdvance {
  const amount = Math.max(0, Number(a.amount) || 0);
  const recoveries = (Array.isArray(a.recoveries) ? a.recoveries : []).map(
    normalizeRecovery,
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

export function outstandingForStaff(staffId: string): number {
  return loadAdvances()
    .advances.filter((a) => a.staffId === staffId)
    .reduce((s, a) => s + outstandingOf(a), 0);
}

export function advancesForStaff(staffId: string): StaffAdvance[] {
  return loadAdvances()
    .advances.filter((a) => a.staffId === staffId)
    .sort((a, b) => b.givenDate.localeCompare(a.givenDate));
}

export function openAdvancesForStaff(staffId: string): StaffAdvance[] {
  return advancesForStaff(staffId)
    .filter((a) => outstandingOf(a) > 0)
    .sort((a, b) => a.givenDate.localeCompare(b.givenDate));
}

export function recoveryMethodLabel(m: AdvanceRecoveryMethod): string {
  return m === "return_to_school" ? "Returned to school" : "Salary deduction";
}

export function advanceSourceLabel(s: AdvanceSource): string {
  switch (s) {
    case "with_salary":
      return "With salary";
    case "other":
      return "Other";
    default:
      return "Cash / direct";
  }
}

export function issueStaffAdvance(input: {
  masters: MastersState;
  staffId: string;
  amount: number;
  givenDate: string;
  paymentMode: PayrollPaymentMode;
  note: string;
  createdBy: string;
  source?: AdvanceSource;
  payrollRunId?: string;
}): { ok: true; advance: StaffAdvance } | { ok: false; error: string } {
  const staff = (input.masters.staff ?? []).find((s) => s.id === input.staffId);
  if (!staff) return { ok: false, error: "Staff not found" };
  const amount = Math.max(0, Math.round(input.amount));
  if (amount <= 0) return { ok: false, error: "Enter advance amount" };
  const givenDate = (input.givenDate || "").slice(0, 10);
  if (!givenDate) return { ok: false, error: "Enter given date" };

  const advance: StaffAdvance = {
    id: nid("adv"),
    staffId: staff.id,
    empCode: staff.empCode,
    fullName: staff.fullName,
    amount,
    givenDate,
    paymentMode: input.paymentMode || "cash",
    note: (input.note || "").trim(),
    source: input.source || "cash",
    payrollRunId: input.payrollRunId || "",
    status: "open",
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    recoveries: [],
  };
  const state = loadAdvances();
  saveAdvances({ version: 1, advances: [advance, ...state.advances] });
  return { ok: true, advance };
}

export function voidStaffAdvance(
  advanceId: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadAdvances();
  const adv = state.advances.find((a) => a.id === advanceId);
  if (!adv) return { ok: false, error: "Advance not found" };
  if (adv.recoveries.length > 0) {
    return {
      ok: false,
      error: "Cannot delete — recoveries already recorded",
    };
  }
  saveAdvances({
    version: 1,
    advances: state.advances.filter((a) => a.id !== advanceId),
  });
  return { ok: true };
}

/**
 * Staff returns cash/UPI etc. to school against outstanding advances (FIFO).
 */
export function recordAdvanceReturnToSchool(input: {
  staffId: string;
  amount: number;
  returnDate: string;
  returnMode: PayrollPaymentMode;
  note: string;
  by: string;
}): { ok: true; applied: number } | { ok: false; error: string } {
  let remaining = Math.max(0, Math.round(input.amount));
  if (remaining <= 0) return { ok: false, error: "Enter return amount" };
  const returnDate = (input.returnDate || "").slice(0, 10);
  if (!returnDate) return { ok: false, error: "Enter return date" };

  const state = loadAdvances();
  let advances = [...state.advances];
  const open = advances
    .filter((a) => a.staffId === input.staffId)
    .map((a) => ({ a, bal: outstandingOf(a) }))
    .filter((x) => x.bal > 0)
    .sort((x, y) => x.a.givenDate.localeCompare(y.a.givenDate));

  if (open.length === 0) {
    return { ok: false, error: "No outstanding advance for this staff" };
  }

  const totalDue = open.reduce((s, x) => s + x.bal, 0);
  if (remaining > totalDue) {
    return {
      ok: false,
      error: `Return cannot exceed outstanding ${totalDue}`,
    };
  }

  let applied = 0;
  const at = `${returnDate}T12:00:00.000Z`;

  for (const { a, bal } of open) {
    if (remaining <= 0) break;
    const take = Math.min(bal, remaining);
    remaining -= take;
    applied += take;
    advances = advances.map((row) => {
      if (row.id !== a.id) return row;
      return normalizeAdvance({
        ...row,
        recoveries: [
          ...row.recoveries,
          {
            id: nid("ar"),
            advanceId: row.id,
            method: "return_to_school",
            payrollRunId: "",
            month: returnDate.slice(0, 7),
            amount: take,
            recoveredAt: at,
            recoveredBy: input.by,
            note: input.note || "Returned to school",
            returnMode: input.returnMode,
          },
        ],
      });
    });
  }

  saveAdvances({ version: 1, advances: advances.map(normalizeAdvance) });
  return { ok: true, applied };
}

/**
 * On payroll publish:
 * 1) salary recoveries for advanceDeduct (FIFO)
 * 2) issue new advances for advanceNewWithSalary
 */
export function syncAdvanceRecoveriesFromPayroll(input: {
  run: PayrollRun;
  by: string;
  masters: MastersState;
}): AdvanceState {
  const state = loadAdvances();
  let advances = [...state.advances];

  // Drop prior salary recoveries + with-salary advances from this run
  advances = advances
    .filter(
      (a) =>
        !(a.payrollRunId === input.run.id && a.source === "with_salary"),
    )
    .map((a) => ({
      ...a,
      recoveries: a.recoveries.filter(
        (r) =>
          !(r.method === "salary" && r.payrollRunId === input.run.id),
      ),
    }));

  const at = new Date().toISOString();
  const payDate = `${input.run.month}-01`;

  for (const line of input.run.lines) {
    let remaining = Math.max(0, Math.round(line.advanceDeduct || 0));
    if (remaining > 0) {
      const open = advances
        .filter((a) => a.staffId === line.staffId)
        .map((a) => ({ a, bal: outstandingOf(a) }))
        .filter((x) => x.bal > 0)
        .sort((x, y) => x.a.givenDate.localeCompare(y.a.givenDate));

      for (const { a, bal } of open) {
        if (remaining <= 0) break;
        const take = Math.min(bal, remaining);
        remaining -= take;
        advances = advances.map((row) => {
          if (row.id !== a.id) return row;
          return normalizeAdvance({
            ...row,
            recoveries: [
              ...row.recoveries,
              {
                id: nid("ar"),
                advanceId: row.id,
                method: "salary",
                payrollRunId: input.run.id,
                month: input.run.month,
                amount: take,
                recoveredAt: at,
                recoveredBy: input.by,
                note: `Salary ${input.run.month}`,
                returnMode: "",
              },
            ],
          });
        });
      }
    }

    const withSal = Math.max(0, Math.round(line.advanceNewWithSalary || 0));
    if (withSal > 0) {
      const staff = (input.masters.staff ?? []).find(
        (s) => s.id === line.staffId,
      );
      advances.unshift(
        normalizeAdvance({
          id: nid("adv"),
          staffId: line.staffId,
          empCode: line.empCode,
          fullName: line.fullName,
          amount: withSal,
          givenDate: payDate,
          paymentMode: line.paymentMode || "bank_transfer",
          note: `Advance with salary ${input.run.month}`,
          source: "with_salary",
          payrollRunId: input.run.id,
          status: "open",
          createdBy: input.by,
          createdAt: at,
          recoveries: [],
        }),
      );
      void staff;
    }
  }

  const next = {
    version: 1 as const,
    advances: advances.map(normalizeAdvance),
  };
  saveAdvances(next);
  return next;
}

/** When payroll recalled after post, remove salary recoveries & with-salary issues for that run. */
export function voidAdvanceRecoveriesForRun(runId: string): AdvanceState {
  const state = loadAdvances();
  const advances = state.advances
    .filter(
      (a) => !(a.payrollRunId === runId && a.source === "with_salary"),
    )
    .map((a) =>
      normalizeAdvance({
        ...a,
        recoveries: a.recoveries.filter(
          (r) => !(r.method === "salary" && r.payrollRunId === runId),
        ),
      }),
    );
  const next = { version: 1 as const, advances };
  saveAdvances(next);
  return next;
}

export function advanceSummary(masters?: MastersState | null): {
  openCount: number;
  outstandingTotal: number;
  byStaff: {
    staffId: string;
    empCode: string;
    fullName: string;
    outstanding: number;
    openCount: number;
  }[];
} {
  const state = loadAdvances();
  const map = new Map<
    string,
    {
      staffId: string;
      empCode: string;
      fullName: string;
      outstanding: number;
      openCount: number;
    }
  >();
  for (const a of state.advances) {
    const bal = outstandingOf(a);
    if (bal <= 0) continue;
    const prev = map.get(a.staffId) || {
      staffId: a.staffId,
      empCode: a.empCode,
      fullName: a.fullName,
      outstanding: 0,
      openCount: 0,
    };
    prev.outstanding += bal;
    prev.openCount += 1;
    map.set(a.staffId, prev);
  }
  void masters;
  const byStaff = [...map.values()].sort((a, b) =>
    a.empCode.localeCompare(b.empCode),
  );
  return {
    openCount: byStaff.reduce((s, r) => s + r.openCount, 0),
    outstandingTotal: byStaff.reduce((s, r) => s + r.outstanding, 0),
    byStaff,
  };
}

export function formatRecoveryDetail(r: AdvanceRecovery): string {
  if (r.method === "return_to_school") {
    const mode = r.returnMode ? ` · ${r.returnMode}` : "";
    return `Returned ${r.recoveredAt.slice(0, 10)}${mode}${
      r.note ? ` · ${r.note}` : ""
    }`;
  }
  return `Salary ${r.month || "—"}${r.note ? ` · ${r.note}` : ""}`;
}
