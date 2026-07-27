"use client";

import { useEffect, useMemo, useState } from "react";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSalarySetup } from "@/lib/salarySetup";
import { currentMonthIso, PAYROLL_PAYMENT_MODES } from "@/lib/payroll";
import {
  PAYROLL_REPORT_CATEGORIES,
  PAYROLL_REPORTS,
  runPayrollReport,
  type PayrollReportFormat,
  type PayrollReportId,
} from "@/lib/payrollReportCatalog";
import type { StaffStream } from "@/lib/foundationMasters";
import type { PayrollRunStatus, PayrollPaymentMode } from "@/lib/payroll";

export function PayrollReportsPanel({
  academicYearCode,
}: {
  academicYearCode: string;
}) {
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [monthFrom, setMonthFrom] = useState("");
  const [monthTo, setMonthTo] = useState(currentMonthIso);
  const [month, setMonth] = useState("");
  const [stream, setStream] = useState<StaffStream | "all">("all");
  const [staffId, setStaffId] = useState("");
  const [status, setStatus] = useState<
    PayrollRunStatus | "all" | "published"
  >("published");
  const [runKind, setRunKind] = useState<"bulk" | "individual" | "all">("all");
  const [paymentMode, setPaymentMode] = useState<PayrollPaymentMode | "all">(
    "all",
  );
  const [structureId, setStructureId] = useState("");
  const [includeDraft, setIncludeDraft] = useState(false);
  const [includeVoided, setIncludeVoided] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("payroll");

  useEffect(() => {
    setMasters(loadMasters());
  }, []);

  const roster = useMemo(
    () =>
      (masters?.staff ?? [])
        .filter((s) => s.status === "active")
        .sort((a, b) => a.empCode.localeCompare(b.empCode)),
    [masters],
  );

  const structures = useMemo(() => {
    const s = loadSalarySetup();
    return s.structures.filter((x) => x.isActive);
  }, []);

  const reports = useMemo(
    () => PAYROLL_REPORTS.filter((r) => r.category === category),
    [category],
  );

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

  function onRun(id: PayrollReportId, format: PayrollReportFormat) {
    const key = `${id}:${format}`;
    setRunning(key);
    const result = runPayrollReport(id, {
      academicYearCode,
      month: month || undefined,
      monthFrom: month ? undefined : monthFrom || undefined,
      monthTo: month ? undefined : monthTo || undefined,
      stream,
      staffId: staffId || undefined,
      status,
      runKind,
      paymentMode,
      structureId: structureId || undefined,
      includeDraft,
      includeVoidedAccount: includeVoided,
      format,
      masters: masters ?? undefined,
    });
    setRunning(null);
    if (!result.ok) flash(result.error, true);
    else flash(result.message);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="font-display text-lg font-bold text-[var(--brand-deep)]">
          Payroll reports
        </h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Excel or PDF · apply filters below · every payroll / advance / hold /
          increment / account report
        </p>

        {notice ? (
          <p className="mt-2 text-sm font-medium text-[var(--brand-deep)]">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-sm font-medium text-[#b42318]">{error}</p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-semibold text-[var(--muted)]">
            Single month (optional)
            <input
              type="month"
              className="field mt-1 !py-2"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
            <span className="mt-0.5 block text-[10px] font-normal">
              Clears range when set
            </span>
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Month from
            <input
              type="month"
              className="field mt-1 !py-2"
              value={monthFrom}
              disabled={!!month}
              onChange={(e) => setMonthFrom(e.target.value)}
            />
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Month to
            <input
              type="month"
              className="field mt-1 !py-2"
              value={monthTo}
              disabled={!!month}
              onChange={(e) => setMonthTo(e.target.value)}
            />
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Run status
            <select
              className="field mt-1 !py-2"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as typeof status)
              }
            >
              <option value="published">Posted + Paid</option>
              <option value="all">All (non-draft default)</option>
              <option value="draft">Draft</option>
              <option value="pending_approval">Pending approval</option>
              <option value="approved">Approved</option>
              <option value="posted">Posted</option>
              <option value="paid">Paid</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Stream
            <select
              className="field mt-1 !py-2"
              value={stream}
              onChange={(e) =>
                setStream(e.target.value as StaffStream | "all")
              }
            >
              <option value="all">All</option>
              <option value="teaching">Teaching</option>
              <option value="non_teaching">Non-teaching</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Staff
            <select
              className="field mt-1 !py-2"
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
            >
              <option value="">All staff</option>
              {roster.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.empCode} — {s.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Run kind
            <select
              className="field mt-1 !py-2"
              value={runKind}
              onChange={(e) =>
                setRunKind(e.target.value as typeof runKind)
              }
            >
              <option value="all">Bulk + individual</option>
              <option value="bulk">Bulk only</option>
              <option value="individual">Individual only</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Payment mode
            <select
              className="field mt-1 !py-2"
              value={paymentMode}
              onChange={(e) =>
                setPaymentMode(e.target.value as typeof paymentMode)
              }
            >
              <option value="all">All modes</option>
              {PAYROLL_PAYMENT_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--muted)]">
            Salary structure
            <select
              className="field mt-1 !py-2"
              value={structureId}
              onChange={(e) => setStructureId(e.target.value)}
            >
              <option value="">All structures</option>
              {structures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 self-end text-xs font-medium text-[var(--brand-deep)]">
            <input
              type="checkbox"
              checked={includeDraft}
              onChange={(e) => setIncludeDraft(e.target.checked)}
            />
            Include drafts in “All”
          </label>
          <label className="flex items-center gap-2 self-end text-xs font-medium text-[var(--brand-deep)]">
            <input
              type="checkbox"
              checked={includeVoided}
              onChange={(e) => setIncludeVoided(e.target.checked)}
            />
            Include voided account rows
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {PAYROLL_REPORT_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              category === c.id
                ? "bg-[var(--brand-deep)] text-white"
                : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]"
            }`}
            onClick={() => setCategory(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {reports.map((r) => (
          <div
            key={r.id}
            className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4"
          >
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              {r.title}
            </h3>
            <p className="mt-1 text-xs text-[var(--muted)]">{r.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-deep)] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                disabled={running === `${r.id}:excel`}
                onClick={() => onRun(r.id, "excel")}
              >
                {running === `${r.id}:excel` ? "…" : "Excel"}
              </button>
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.2)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-50"
                disabled={running === `${r.id}:pdf`}
                onClick={() => onRun(r.id, "pdf")}
              >
                {running === `${r.id}:pdf` ? "…" : "PDF"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
