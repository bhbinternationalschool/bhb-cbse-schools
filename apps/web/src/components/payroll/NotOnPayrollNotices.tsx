"use client";

import Link from "next/link";
import {
  leftOutText,
  type NotOnPayrollEntry,
  type PayrollLeftOutEntry,
} from "@/lib/payrollNotOnPayroll";

const SETUP_HREF = "/masters?tab=salary";

/** After processing: who payroll left out — not on payroll, or joined after the month. */
export function NotOnPayrollLeftOut({
  month,
  rows,
  onClose,
}: {
  month: string;
  rows: PayrollLeftOutEntry[];
  onClose: () => void;
}) {
  if (!rows.length) return null;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-[var(--brand-deep)]">
          Left out ({rows.length}) · {month}
        </p>
        <button
          type="button"
          className="text-[11px] font-semibold text-[var(--muted)] underline-offset-2 hover:underline"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <ul className="mt-1.5 grid gap-0.5 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.staffId} className="text-[var(--brand-deep)]">
            {r.empCode} — {r.fullName}
            <span className="text-[var(--muted)]"> · {leftOutText(r)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[10px] text-[var(--muted)]">
        &ldquo;Not on payroll&rdquo; is set in{" "}
        <Link href={SETUP_HREF} className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline">
          Masters → Salary setup
        </Link>
        ; they stay active staff for attendance, the staff app and roles.
      </p>
    </div>
  );
}

/** On a draft: lines for staff since marked not on payroll. */
export function NotOnPayrollRunBanner({
  rows,
  onRemoveAll,
}: {
  rows: NotOnPayrollEntry[];
  onRemoveAll: () => void;
}) {
  if (!rows.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-[rgba(197,160,40,0.14)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--brand-deep)]">
      <span>
        {rows.length} {rows.length === 1 ? "person here is" : "people here are"} marked not on payroll
        ({rows.map((r) => r.fullName).join(", ")}) — remove them from this draft.
      </span>
      <button
        type="button"
        className="rounded-lg bg-[var(--primary)] px-2 py-1 text-[10px] font-semibold text-[var(--primary-foreground)]"
        onClick={() => {
          if (window.confirm(`Remove ${rows.length} not-on-payroll ${rows.length === 1 ? "line" : "lines"} from this draft?`)) {
            onRemoveAll();
          }
        }}
      >
        Remove {rows.length === 1 ? "them" : `all ${rows.length}`}
      </button>
    </div>
  );
}

/** On a draft line: this person is marked not on payroll. */
export function NotOnPayrollBadge({
  reason,
  onRemove,
}: {
  reason: string;
  onRemove?: () => void;
}) {
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]">
      <span
        className="rounded-md bg-[rgba(197,160,40,0.18)] px-1.5 py-0.5 font-semibold text-[var(--brand-deep)]"
        title="Marked not on payroll in Masters → Salary setup"
      >
        Not on payroll{reason ? ` · ${reason}` : ""}
      </span>
      {onRemove ? (
        <button
          type="button"
          className="font-semibold text-[var(--danger)] underline-offset-2 hover:underline"
          onClick={onRemove}
        >
          Remove from this run
        </button>
      ) : null}
    </span>
  );
}
