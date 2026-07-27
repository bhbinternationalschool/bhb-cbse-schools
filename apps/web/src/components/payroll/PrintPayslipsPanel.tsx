"use client";

import { useEffect, useMemo, useState } from "react";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  currentMonthIso,
  formatInr,
  loadPayroll,
  paymentModeLabel,
  payrollStatusLabel,
  pickPayslipRun,
  type PayrollRun,
  type PayrollStaffLine,
} from "@/lib/payroll";

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export { pickPayslipRun };

export function printPayslipsBatch() {
  const root = document.getElementById("payslip-print-root");
  if (!root) {
    window.print();
    return;
  }
  document.body.classList.add("printing-payslips");
  root.classList.add("print-target");
  const cleanup = () => {
    document.body.classList.remove("printing-payslips");
    root.classList.remove("print-target");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  window.setTimeout(cleanup, 1500);
}

export function PrintPayslipsPanel({
  academicYearCode,
}: {
  academicYearCode: string;
}) {
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [month, setMonth] = useState(currentMonthIso);
  const [mode, setMode] = useState<"bulk" | "individual">("bulk");
  const [staffId, setStaffId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    setMasters(loadMasters());
    setRuns(loadPayroll().runs);
  }, []);

  const monthsAvailable = useMemo(() => {
    const set = new Set<string>();
    for (const r of runs) {
      if (r.academicYearCode !== academicYearCode) continue;
      if (
        r.status === "approved" ||
        r.status === "posted" ||
        r.status === "paid"
      ) {
        set.add(r.month);
      }
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [runs, academicYearCode]);

  useEffect(() => {
    if (monthsAvailable.length && !monthsAvailable.includes(month)) {
      setMonth(monthsAvailable[0]);
    }
  }, [monthsAvailable, month]);

  const run = useMemo(
    () => pickPayslipRun(runs, month, academicYearCode),
    [runs, month, academicYearCode],
  );

  const lines = useMemo(() => {
    if (!run) return [];
    return [...run.lines].sort((a, b) => a.empCode.localeCompare(b.empCode));
  }, [run]);

  useEffect(() => {
    setSelectedIds(lines.map((l) => l.staffId));
    if (lines.length && !lines.some((l) => l.staffId === staffId)) {
      setStaffId(lines[0]?.staffId || "");
    }
  }, [run?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const printLines = useMemo(() => {
    if (!run) return [];
    if (mode === "individual") {
      const line = lines.find((l) => l.staffId === staffId);
      return line ? [line] : [];
    }
    return lines.filter((l) => selectedIds.includes(l.staffId));
  }, [run, mode, lines, staffId, selectedIds]);

  const schoolName =
    masters?.schoolProfile?.displayName ||
    masters?.schoolProfile?.legalName ||
    "BHB International School";
  const schoolAddr = [
    masters?.schoolProfile?.address,
    masters?.schoolProfile?.city,
    masters?.schoolProfile?.state,
    masters?.schoolProfile?.pincode,
  ]
    .filter(Boolean)
    .join(", ");

  function toggleStaff(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function selectAll(on: boolean) {
    setSelectedIds(on ? lines.map((l) => l.staffId) : []);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4 print:hidden">
        <div>
          <h2 className="font-display text-lg font-bold text-[var(--brand-deep)]">
            Print payslips
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Choose any approved / posted / paid month — print one staff or bulk
            for the month.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-[var(--muted)]">
            Month
            <select
              className="field mt-1 !py-2"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              {monthsAvailable.length === 0 ? (
                <option value={month}>{month} (no payslips yet)</option>
              ) : (
                monthsAvailable.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))
              )}
            </select>
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                mode === "bulk"
                  ? "bg-[var(--brand-deep)] text-white"
                  : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]"
              }`}
              onClick={() => setMode("bulk")}
            >
              Bulk
            </button>
            <button
              type="button"
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                mode === "individual"
                  ? "bg-[var(--brand-deep)] text-white"
                  : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]"
              }`}
              onClick={() => setMode("individual")}
            >
              Individual
            </button>
          </div>

          {mode === "individual" ? (
            <label className="text-xs font-semibold text-[var(--muted)]">
              Staff
              <select
                className="field mt-1 min-w-[220px] !py-2"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
              >
                {lines.map((l) => (
                  <option key={l.staffId} value={l.staffId}>
                    {l.empCode} — {l.fullName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            disabled={!run || printLines.length === 0}
            onClick={() => printPayslipsBatch()}
          >
            Print {printLines.length} payslip
            {printLines.length === 1 ? "" : "s"}
          </button>
        </div>

        {!run ? (
          <p className="text-sm text-[var(--muted)]">
            No approved/posted/paid payroll for {monthLabel(month)}. Process and
            publish first.
          </p>
        ) : (
          <p className="text-xs text-[var(--muted)]">
            Using run status <strong>{payrollStatusLabel(run.status)}</strong> ·{" "}
            {lines.length} staff in month
          </p>
        )}

        {mode === "bulk" && lines.length > 0 ? (
          <div className="rounded-lg border border-[rgba(32,48,80,0.08)] bg-[rgba(32,48,80,0.02)] p-3">
            <div className="mb-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="text-[11px] font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
                onClick={() => selectAll(true)}
              >
                Select all
              </button>
              <button
                type="button"
                className="text-[11px] font-semibold text-[var(--muted)] underline-offset-2 hover:underline"
                onClick={() => selectAll(false)}
              >
                Clear
              </button>
            </div>
            <div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {lines.map((l) => (
                <label
                  key={l.staffId}
                  className="flex items-center gap-2 text-xs text-[var(--brand-deep)]"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(l.staffId)}
                    onChange={() => toggleStaff(l.staffId)}
                  />
                  {l.empCode} — {l.fullName}
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div id="payslip-print-root" className="space-y-4">
        {run && printLines.length > 0 ? (
          printLines.map((line) => (
            <PrintablePayslip
              key={line.staffId}
              schoolName={schoolName}
              schoolAddr={schoolAddr}
              run={run}
              line={line}
            />
          ))
        ) : (
          <p className="rounded-xl border border-dashed border-[rgba(32,48,80,0.15)] bg-white px-4 py-8 text-center text-sm text-[var(--muted)] print:hidden">
            Select month and staff to preview payslips here.
          </p>
        )}
      </div>
    </div>
  );
}

export function PrintablePayslip({
  schoolName,
  schoolAddr,
  run,
  line,
}: {
  schoolName: string;
  schoolAddr: string;
  run: PayrollRun;
  line: PayrollStaffLine;
}) {
  const earnings = line.components.filter((c) => c.kind === "earning");
  const deductions = line.components.filter((c) => c.kind === "deduction");
  const employer = line.components.filter((c) => c.kind === "employer");

  return (
    <article className="payslip-sheet break-inside-avoid rounded-xl border border-[rgba(32,48,80,0.14)] bg-white p-5 shadow-sm print:break-after-page print:rounded-none print:border print:border-black print:shadow-none">
      <header className="border-b border-[rgba(32,48,80,0.12)] pb-3 text-center print:border-black">
        <h1 className="font-display text-lg font-bold text-[var(--brand-deep)] print:text-black">
          {schoolName}
        </h1>
        {schoolAddr ? (
          <p className="mt-0.5 text-[10px] text-[var(--muted)] print:text-black">
            {schoolAddr}
          </p>
        ) : null}
        <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-[var(--brand-deep)] print:text-black">
          Salary payslip · {monthLabel(run.month)}
        </p>
      </header>

      <div className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
        <p>
          <span className="text-[var(--muted)]">Employee: </span>
          <strong>
            {line.fullName} ({line.empCode})
          </strong>
        </p>
        <p>
          <span className="text-[var(--muted)]">Stream: </span>
          {line.stream.replace("_", "-")}
        </p>
        <p>
          <span className="text-[var(--muted)]">Structure: </span>
          {line.structureName}
        </p>
        <p>
          <span className="text-[var(--muted)]">Status: </span>
          {payrollStatusLabel(run.status)}
        </p>
        {line.paymentDate ? (
          <p>
            <span className="text-[var(--muted)]">Pay date: </span>
            {line.paymentDate}
          </p>
        ) : null}
        {line.paymentMode ? (
          <p>
            <span className="text-[var(--muted)]">Mode: </span>
            {paymentModeLabel(line.paymentMode)}
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-1 border-b border-[rgba(32,48,80,0.1)] pb-1 text-[11px] font-bold uppercase text-[var(--muted)] print:border-black print:text-black">
            Earnings
          </h3>
          <ul className="space-y-0.5 text-sm">
            {earnings.map((c) => (
              <li key={c.headCode} className="flex justify-between gap-2">
                <span>{c.headName}</span>
                <span>{formatInr(c.amount)}</span>
              </li>
            ))}
            <li className="flex justify-between border-t border-[rgba(32,48,80,0.1)] pt-1 font-semibold print:border-black">
              <span>Gross</span>
              <span>{formatInr(line.gross)}</span>
            </li>
          </ul>
        </div>
        <div>
          <h3 className="mb-1 border-b border-[rgba(32,48,80,0.1)] pb-1 text-[11px] font-bold uppercase text-[var(--muted)] print:border-black print:text-black">
            Deductions
          </h3>
          <ul className="space-y-0.5 text-sm">
            {deductions.map((c) => (
              <li key={c.headCode} className="flex justify-between gap-2">
                <span>{c.headName}</span>
                <span>−{formatInr(c.amount)}</span>
              </li>
            ))}
            <li className="flex justify-between border-t border-[rgba(32,48,80,0.1)] pt-1 font-semibold print:border-black">
              <span>Total deductions</span>
              <span>−{formatInr(line.totalDeductions)}</span>
            </li>
          </ul>
        </div>
      </div>

      {employer.length > 0 ? (
        <div className="mt-3">
          <h3 className="mb-1 text-[11px] font-bold uppercase text-[var(--muted)] print:text-black">
            Employer contributions (not deducted from staff)
          </h3>
          <ul className="space-y-0.5 text-xs text-[var(--muted)] print:text-black">
            {employer.map((c) => (
              <li key={c.headCode} className="flex justify-between gap-2">
                <span>{c.headName}</span>
                <span>{formatInr(c.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-[rgba(32,48,80,0.12)] pt-3 print:border-black">
        <div className="text-xs text-[var(--muted)] print:text-black">
          <p>
            Attendance: P {line.daysPresent} · A {line.daysAbsent} · HD{" "}
            {line.daysHalf} · LWP {line.daysLwp} · Holiday {line.daysHoliday}
          </p>
          {(line.advanceDeduct || 0) > 0 ||
          (line.advanceNewWithSalary || 0) > 0 ? (
            <p className="mt-0.5">
              Advance: due {formatInr(line.advanceTaken || 0)} · deduct{" "}
              {formatInr(line.advanceDeduct || 0)}
              {(line.advanceNewWithSalary || 0) > 0
                ? ` · new with salary ${formatInr(line.advanceNewWithSalary)}`
                : ""}
            </p>
          ) : null}
          {line.juneHold ? (
            <p className="mt-0.5">June salary hold applied</p>
          ) : null}
          {line.note ? <p className="mt-0.5">Note: {line.note}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase text-[var(--muted)] print:text-black">
            Net pay
          </p>
          <p className="text-xl font-bold text-[var(--brand-deep)] print:text-black">
            {formatInr(line.netPay)}
          </p>
          <p className="text-[10px] text-[var(--muted)] print:text-black">
            Payable {formatInr(line.amountPayable ?? line.netPay)}
          </p>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-8 text-center text-[10px] text-[var(--muted)] print:text-black">
        <div>
          <div className="mx-auto mb-1 h-8 w-32 border-b border-[rgba(32,48,80,0.25)] print:border-black" />
          Employee signature
        </div>
        <div>
          <div className="mx-auto mb-1 h-8 w-32 border-b border-[rgba(32,48,80,0.25)] print:border-black" />
          Authorised signatory
        </div>
      </div>
    </article>
  );
}
