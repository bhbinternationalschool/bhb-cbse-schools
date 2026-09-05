"use client";
// ratchet-allow: grids_without_row_menu — a staff member's own advances, read-only by design

import { useEffect, useMemo, useState } from "react";
import { loadMasters } from "@/lib/masters";
import {
  approvedPayslipsForStaff,
  formatInr,
  paymentModeLabel,
  payrollStatusLabel,
} from "@/lib/payroll";
import {
  advancesForStaff,
  advanceSourceLabel,
  formatRecoveryDetail,
  outstandingForStaff,
  outstandingOf,
  recoveredTotal,
  recoveryMethodLabel,
} from "@/lib/staffAdvance";
import {
  monthLabel,
  PrintablePayslip,
  printPayslipsBatch,
} from "@/components/payroll/PrintPayslipsPanel";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";

/** Staff-facing payslips: month filter + print. */
export function StaffMyPayslips({ staffId }: { staffId: string }) {
  const [month, setMonth] = useState<string>("all");
  const [tick, setTick] = useState(0);

  const slips = useMemo(() => {
    void tick;
    if (!staffId) return [];
    return approvedPayslipsForStaff(staffId);
  }, [staffId, tick]);

  const months = useMemo(() => {
    const set = new Set(slips.map((s) => s.run.month));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [slips]);

  const visible = useMemo(() => {
    if (month === "all") return slips;
    return slips.filter((s) => s.run.month === month);
  }, [slips, month]);

  const school = useMemo(() => {
    const m = loadMasters();
    const name =
      m.schoolProfile?.displayName ||
      m.schoolProfile?.legalName ||
      "BHB International School";
    const addr = [
      m.schoolProfile?.address,
      m.schoolProfile?.city,
      m.schoolProfile?.state,
      m.schoolProfile?.pincode,
    ]
      .filter(Boolean)
      .join(", ");
    return { name, addr };
  }, [tick]);

  useEffect(() => {
    setTick((n) => n + 1);
  }, []);

  if (!staffId) {
    return (
      <p className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3 text-sm text-[var(--muted)]">
        Sign in with your staff login (linked emp code) to see your payslips.
      </p>
    );
  }

  if (slips.length === 0) {
    return (
      <p className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3 text-sm text-[var(--muted)]">
        No approved payslips yet. Once payroll is approved or published, your
        slip will appear here.
      </p>
    );
  }

  const latest = slips[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4 print:hidden">
        <div>
          <h2 className="font-display text-lg font-bold text-[var(--brand-deep)]">
            My payslips
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {latest.line.fullName} ({latest.line.empCode}) · Latest{" "}
            {monthLabel(latest.run.month)} ·{" "}
            {formatInr(latest.line.amountPayable ?? latest.line.netPay)} payable
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-[var(--muted)]">
            Month
            <select
              className="field mt-1 !py-2"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              <option value="all">All months</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            disabled={visible.length === 0}
            onClick={() => printPayslipsBatch()}
          >
            Print {visible.length === 1 ? "payslip" : `${visible.length} slips`}
          </button>
        </div>
      </div>

      <div id="payslip-print-root" className="space-y-4">
        {visible.map(({ run, line }) => (
          <div key={run.id} className="space-y-2">
            <div className="print:hidden">
              <StaffPayslipSummary run={run} line={line} />
            </div>
            <PrintablePayslip
              schoolName={school.name}
              schoolAddr={school.addr}
              run={run}
              line={line}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function StaffPayslipSummary({
  run,
  line,
}: {
  run: { month: string; status: import("@/lib/payroll").PayrollRunStatus };
  line: {
    netPay: number;
    amountPayable?: number;
    paymentDate?: string;
    paymentMode?: import("@/lib/payroll").PayrollPaymentMode;
    juneHold?: boolean;
  };
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-[rgba(32,48,80,0.03)] px-3 py-2 text-xs">
      <span className="font-semibold text-[var(--brand-deep)]">
        {monthLabel(run.month)} · {payrollStatusLabel(run.status)}
      </span>
      <span className="text-[var(--muted)]">
        Net {formatInr(line.netPay)} · Payable{" "}
        {formatInr(line.amountPayable ?? line.netPay)}
        {line.paymentDate ? ` · ${line.paymentDate}` : ""}
        {line.paymentMode ? ` · ${paymentModeLabel(line.paymentMode)}` : ""}
        {line.juneHold ? " · June hold" : ""}
      </span>
    </div>
  );
}

/** Staff-facing advances: outstanding + history (read-only). */
export function StaffMyAdvances({ staffId }: { staffId: string }) {
  const [tick, setTick] = useState(0);
  const due = useMemo(() => {
    void tick;
    return staffId ? outstandingForStaff(staffId) : 0;
  }, [staffId, tick]);

  const list = useMemo(() => {
    void tick;
    return staffId ? advancesForStaff(staffId) : [];
  }, [staffId, tick]);

  useEffect(() => {
    setTick((n) => n + 1);
  }, []);

  if (!staffId) {
    return (
      <p className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3 text-sm text-[var(--muted)]">
        Sign in with your staff login to see advance balance.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="font-display text-lg font-bold text-[var(--brand-deep)]">
          My advances
        </h2>
        <p className="mt-1 text-sm text-[var(--brand-deep)]">
          Outstanding balance{" "}
          <strong className="text-lg">{formatInr(due)}</strong>
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Recovered from salary when payroll is published, or when you return
          cash to the school office. Contact Accounts for new advances.
        </p>
      </div>

      <ErpTableShell className="overflow-x-auto" exportAs="my_advances" exportTitle="My advances">
        <ErpTable className="text-xs">
          <ErpTableHead>
            <tr>
              <th className="px-3 py-2 font-semibold">Given</th>
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 font-semibold">Amount</th>
              <th className="px-3 py-2 font-semibold">Recovered</th>
              <th className="px-3 py-2 font-semibold">Balance</th>
              <th className="px-3 py-2 font-semibold">How recovered</th>
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {list.map((a) => {
              const bal = outstandingOf(a);
              return (
                <tr key={a.id} className="align-top">
                  <td className="px-3 py-2">
                    {a.givenDate}
                    {a.note ? (
                      <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
                        {a.note}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{advanceSourceLabel(a.source)}</td>
                  <td className="px-3 py-2">{formatInr(a.amount)}</td>
                  <td className="px-3 py-2">{formatInr(recoveredTotal(a))}</td>
                  <td className="px-3 py-2 font-semibold">
                    {formatInr(bal)}
                    {bal <= 0 ? (
                      <span className="ml-1 text-[10px] text-teal-700">
                        closed
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {a.recoveries.length === 0 ? (
                      <span className="text-[var(--muted)]">—</span>
                    ) : (
                      <ul className="space-y-1">
                        {a.recoveries.map((r) => (
                          <li key={r.id}>
                            <span className="font-semibold text-[var(--brand-deep)]">
                              {formatInr(r.amount)}
                            </span>
                            <span className="text-[var(--muted)]">
                              {" "}
                              · {recoveryMethodLabel(r.method)}
                            </span>
                            <span className="block text-[10px] text-[var(--muted)]">
                              {formatRecoveryDetail(r)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
            {list.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-sm text-[var(--muted)]"
                >
                  No advances on your ledger.
                </td>
              </tr>
            ) : null}
          </ErpTableBody>
        </ErpTable>
      </ErpTableShell>
    </div>
  );
}
