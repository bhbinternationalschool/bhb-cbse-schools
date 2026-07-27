"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadMasters } from "@/lib/masters";
import {
  approvedPayslipsForStaff,
  formatInr,
  payrollStatusLabel,
} from "@/lib/payroll";
import {
  canManagePayroll,
  resolveSessionStaff,
} from "@/lib/staffResolve";
import { useDemoSession } from "@/components/shell/SessionContext";

/** Staff self-service payslips (+ link to Payroll for managers). */
export function StaffPayslipsPanel() {
  const session = useDemoSession();
  const [tick, setTick] = useState(0);

  const masters = useMemo(() => {
    void tick;
    return loadMasters();
  }, [tick]);

  const self = useMemo(
    () => resolveSessionStaff(session, masters),
    [session, masters],
  );

  const manager = useMemo(
    () => canManagePayroll(session, masters),
    [session, masters],
  );

  const slips = useMemo(() => {
    void tick;
    if (!self) return [];
    return approvedPayslipsForStaff(self.id);
  }, [self, tick]);

  useEffect(() => {
    setTick((n) => n + 1);
  }, []);

  return (
    <div className="space-y-4">
      {manager ? (
        <p className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] px-4 py-3 text-sm text-[var(--muted)]">
          Run payroll and view all payslips in{" "}
          <Link
            href="/payroll"
            className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
          >
            Payroll
          </Link>
          . Structures live in Masters → Salary setup.
        </p>
      ) : null}

      {!self ? (
        <p className="text-sm text-[var(--muted)]">
          Sign in with your staff login to see your payslips.
        </p>
      ) : slips.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No approved payslips yet for {self.fullName}.
        </p>
      ) : (
        <div className="space-y-3">
          {slips.map(({ run, line }) => (
            <div
              key={run.id}
              className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-[var(--brand-deep)]">
                    {run.month}
                  </h3>
                  <p className="text-[11px] text-[var(--muted)]">
                    {payrollStatusLabel(run.status)} · {line.structureName}
                  </p>
                </div>
                <div className="text-right font-bold text-[var(--brand-deep)]">
                  {formatInr(line.netPay)}
                </div>
              </div>
              <div className="mt-2 grid gap-2 text-[11px] text-[var(--muted)] sm:grid-cols-2">
                <div>
                  Earnings:{" "}
                  {line.components
                    .filter((c) => c.kind === "earning")
                    .map((c) => `${c.headName} ${formatInr(c.amount)}`)
                    .join(" · ")}
                </div>
                <div>
                  Deductions:{" "}
                  {formatInr(line.totalDeductions)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
