"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  currentMonthIso,
  formatInr,
  loadPayroll,
  payrollStatusLabel,
} from "@/lib/payroll";
import {
  BANK_FILE_FORMATS,
  buildBankExportPreview,
  downloadBankExceptionReport,
  downloadBankFile,
  type BankFileFormat,
} from "@/lib/bankFileExport";
import { monthLabel } from "@/components/payroll/PrintPayslipsPanel";
import {
  loadSalarySetup,
  normalizeSalarySettings,
} from "@/lib/salarySetup";

export function BankFileExportPanel({
  academicYearCode,
}: {
  academicYearCode: string;
}) {
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [month, setMonth] = useState(currentMonthIso);
  const [format, setFormat] = useState<BankFileFormat>("ubi_neft");
  const [includeUpi, setIncludeUpi] = useState(false);
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMasters(loadMasters());
  }, [tick]);

  const monthsAvailable = useMemo(() => {
    const set = new Set<string>();
    for (const r of loadPayroll().runs) {
      if (r.academicYearCode !== academicYearCode) continue;
      if (r.status === "posted" || r.status === "paid" || r.status === "approved") {
        set.add(r.month);
      }
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [academicYearCode, tick]);

  useEffect(() => {
    if (monthsAvailable.length && !monthsAvailable.includes(month)) {
      setMonth(monthsAvailable[0]);
    }
  }, [monthsAvailable, month]);

  const preview = useMemo(() => {
    if (!masters) {
      return null;
    }
    return buildBankExportPreview({
      masters,
      month,
      academicYearCode,
      modes: includeUpi ? ["bank_transfer", "upi"] : ["bank_transfer"],
      requirePosted: true,
    });
  }, [masters, month, academicYearCode, includeUpi, tick]);

  const settings = normalizeSalarySettings(loadSalarySetup().settings);

  function flash(msg: string, isErr = false) {
    if (isErr) {
      setError(msg);
      setNotice(null);
    } else {
      setNotice(msg);
      setError(null);
    }
    window.setTimeout(() => {
      setNotice(null);
      setError(null);
    }, 4000);
  }

  function onDownload() {
    if (!preview) return;
    const r = downloadBankFile(preview, format);
    if (!r.ok) flash(r.error, true);
    else flash(r.message);
  }

  function onExceptions() {
    if (!preview) return;
    const r = downloadBankExceptionReport(preview);
    if (!r.ok) flash(r.error, true);
    else flash(r.message);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="font-display text-lg font-bold text-[var(--brand-deep)]">
          Bank file export
        </h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Download NEFT / bulk salary credit file for the bank portal. Uses
          staff bank A/c + IFSC from Staff profile. Only positive payable on
          posted/paid (or approved) runs.
        </p>

        {notice ? (
          <p className="mt-2 text-sm font-medium text-[var(--brand-deep)]">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-sm font-medium text-[#b42318]">{error}</p>
        ) : null}

        <div className="mt-3 rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-2 text-xs text-[var(--muted)]">
          Debit bank:{" "}
          <strong className="text-[var(--brand-deep)]">
            {settings.salaryBankName || "Union Bank of India"}
          </strong>
          {settings.salaryBankBranch
            ? ` · ${settings.salaryBankBranch}`
            : " · Murdaha Bazar, Varanasi"}
          <br />
          A/c:{" "}
          <strong className="text-[var(--brand-deep)]">
            {settings.salaryBankAccountNo || "— enter salary a/c no. —"}
          </strong>
          {` · IFSC ${settings.salaryBankIfsc || "UBIN0548847"}`}
          {" · "}
          <Link
            href="/masters"
            className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
          >
            Masters → Salary setup
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-[var(--muted)]">
            Month
            <select
              className="field mt-1 !py-2"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              {monthsAvailable.length === 0 ? (
                <option value={month}>{monthLabel(month)} (none yet)</option>
              ) : (
                monthsAvailable.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="text-xs font-semibold text-[var(--muted)]">
            Bank format
            <select
              className="field mt-1 min-w-[200px] !py-2"
              value={format}
              onChange={(e) => setFormat(e.target.value as BankFileFormat)}
            >
              {BANK_FILE_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 self-end pb-2 text-xs font-medium text-[var(--brand-deep)]">
            <input
              type="checkbox"
              checked={includeUpi}
              onChange={(e) => setIncludeUpi(e.target.checked)}
            />
            Include UPI mode lines
          </label>

          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white"
            onClick={onDownload}
            disabled={!preview || preview.readyCount === 0}
          >
            Download bank CSV
          </button>
          <button
            type="button"
            className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
            onClick={onExceptions}
            disabled={!preview || preview.blockedCount === 0}
          >
            Exception list
          </button>
          <button
            type="button"
            className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-semibold text-[var(--muted)]"
            onClick={() => setTick((t) => t + 1)}
          >
            Refresh
          </button>
        </div>

        <p className="mt-2 text-[11px] text-[var(--muted)]">
          {BANK_FILE_FORMATS.find((f) => f.value === format)?.hint}
        </p>
      </div>

      {preview ? (
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          {!preview.run ? (
            <p className="text-sm text-[var(--muted)]">
              No approved/posted/paid payroll for {monthLabel(month)}. Publish a
              run first.
            </p>
          ) : (
            <>
              <p className="text-sm text-[var(--brand-deep)]">
                Run{" "}
                <strong>{payrollStatusLabel(preview.run.status)}</strong> ·{" "}
                {preview.readyCount} ready · {preview.blockedCount} blocked ·
                Total credit{" "}
                <strong>{formatInr(preview.totalAmount)}</strong>
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[rgba(32,48,80,0.1)] text-[var(--muted)]">
                      <th className="py-2 pr-2 font-semibold">Staff</th>
                      <th className="py-2 pr-2 font-semibold">A/c</th>
                      <th className="py-2 pr-2 font-semibold">IFSC</th>
                      <th className="py-2 pr-2 font-semibold">Amount</th>
                      <th className="py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr
                        key={r.staffId}
                        className="border-b border-[rgba(32,48,80,0.06)]"
                      >
                        <td className="py-2 pr-2">
                          <span className="font-semibold text-[var(--brand-deep)]">
                            {r.empCode}
                          </span>
                          <span className="block text-[var(--muted)]">
                            {r.accountName || r.fullName}
                          </span>
                        </td>
                        <td className="py-2 pr-2 font-mono">
                          {r.accountNo || "—"}
                        </td>
                        <td className="py-2 pr-2 font-mono">
                          {r.ifsc || "—"}
                        </td>
                        <td className="py-2 pr-2 font-semibold">
                          {formatInr(r.amount)}
                        </td>
                        <td className="py-2">
                          {r.ok ? (
                            <span className="text-teal-700">Ready</span>
                          ) : (
                            <span className="text-[#b42318]">
                              {r.issues.join(" · ")}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {preview.rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="py-6 text-center text-sm text-[var(--muted)]"
                        >
                          No bank-transfer payable lines (zero payable or
                          cash/cheque only).
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
