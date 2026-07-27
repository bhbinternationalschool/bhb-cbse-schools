"use client";

import { useEffect, useMemo, useState } from "react";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  approvePayrollRun,
  formatInr,
  loadPayroll,
  rejectPayrollRun,
  type PayrollRun,
} from "@/lib/payroll";
import {
  approveIncrementBatch,
  applyIncrementBatch,
  incrementBatchStatusLabel,
  loadIncrementState,
  rejectIncrementBatch,
  type IncrementBatch,
} from "@/lib/salaryIncrement";
import { canApprovePayroll } from "@/lib/staffResolve";
import { useDemoSession } from "@/components/shell/SessionContext";
import { monthLabel } from "@/components/payroll/PrintPayslipsPanel";

function runTotals(run: PayrollRun) {
  let gross = 0;
  let net = 0;
  let payable = 0;
  for (const l of run.lines) {
    gross += l.gross;
    net += l.netPay;
    payable += l.amountPayable ?? (l.juneHold ? 0 : l.netPay);
  }
  return { gross, net, payable, staff: run.lines.length };
}

function batchDelta(batch: IncrementBatch) {
  const included = batch.lines.filter((l) => l.status === "included");
  const delta = included.reduce(
    (s, l) => s + Math.max(0, (l.newBasic || 0) - (l.oldBasic || 0)),
    0,
  );
  return { count: included.length, delta };
}

export function ApprovalsInboxPanel({
  academicYearCode,
  onOpenPayrollRun,
}: {
  academicYearCode: string;
  onOpenPayrollRun?: (runId: string) => void;
}) {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);

  useEffect(() => {
    setMasters(loadMasters());
  }, [tick]);

  const isApprover = useMemo(() => {
    if (!masters) return false;
    return canApprovePayroll(session, masters);
  }, [masters, session]);

  const payrollPending = useMemo(() => {
    void tick;
    return loadPayroll()
      .runs.filter(
        (r) =>
          r.academicYearCode === academicYearCode &&
          r.status === "pending_approval",
      )
      .sort((a, b) =>
        (b.submittedAt || "").localeCompare(a.submittedAt || ""),
      );
  }, [academicYearCode, tick]);

  const incrementPending = useMemo(() => {
    void tick;
    return loadIncrementState()
      .batches.filter(
        (b) =>
          b.academicYearCode === academicYearCode &&
          b.status === "pending_approval",
      )
      .sort((a, b) =>
        (b.submittedAt || "").localeCompare(a.submittedAt || ""),
      );
  }, [academicYearCode, tick]);

  const totalPending = payrollPending.length + incrementPending.length;

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

  function refresh() {
    setTick((t) => t + 1);
    setRejecting(null);
  }

  function noteFor(id: string) {
    return notes[id] || "";
  }

  function setNote(id: string, v: string) {
    setNotes((n) => ({ ...n, [id]: v }));
  }

  function onApprovePayroll(run: PayrollRun) {
    if (!isApprover) {
      flash("Only Principal / Admin can approve", true);
      return;
    }
    const r = approvePayrollRun(
      run.id,
      session.fullName,
      noteFor(run.id),
    );
    if (!r.ok) flash(r.error, true);
    else {
      flash(`Payroll ${run.month} approved — publish separately`);
      refresh();
    }
  }

  function onRejectPayroll(run: PayrollRun) {
    if (!isApprover) {
      flash("Only Principal / Admin can reject", true);
      return;
    }
    const reason = noteFor(run.id).trim();
    if (!reason) {
      setRejecting(run.id);
      flash("Enter a rejection reason first", true);
      return;
    }
    const r = rejectPayrollRun(run.id, session.fullName, reason);
    if (!r.ok) flash(r.error, true);
    else {
      flash(`Payroll ${run.month} rejected → draft`);
      refresh();
    }
  }

  function onApproveIncrement(batch: IncrementBatch) {
    if (!isApprover) {
      flash("Only Principal / Admin can approve", true);
      return;
    }
    const r = approveIncrementBatch(batch.id, session.fullName);
    if (!r.ok) {
      flash(r.error, true);
      return;
    }
    const applied = applyIncrementBatch(batch.id, session.fullName);
    if (!applied.ok) {
      flash(
        `Approved but apply failed: ${applied.error}. Apply from Increment tab.`,
        true,
      );
      refresh();
      return;
    }
    flash(`Increment approved & applied · ${applied.applied} staff`);
    refresh();
  }

  function onRejectIncrement(batch: IncrementBatch) {
    if (!isApprover) {
      flash("Only Principal / Admin can reject", true);
      return;
    }
    const reason = noteFor(batch.id).trim();
    if (!reason) {
      setRejecting(batch.id);
      flash("Enter a rejection reason first", true);
      return;
    }
    const r = rejectIncrementBatch(batch.id, session.fullName, reason);
    if (!r.ok) flash(r.error, true);
    else {
      flash("Increment rejected → draft");
      refresh();
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="font-display text-lg font-bold text-[var(--brand-deep)]">
          Approvals inbox
        </h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Pending payroll runs and salary increments. Office submits · Principal
          / Admin approves or rejects with a reason.
        </p>

        {notice ? (
          <p className="mt-2 text-sm font-medium text-[var(--brand-deep)]">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-sm font-medium text-[#b42318]">{error}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          <div className="rounded-lg border border-[rgba(32,48,80,0.1)] px-3 py-2">
            <span className="text-[var(--muted)]">Pending total</span>
            <p className="text-lg font-semibold text-[var(--brand-deep)]">
              {totalPending}
            </p>
          </div>
          <div className="rounded-lg border border-[rgba(32,48,80,0.1)] px-3 py-2">
            <span className="text-[var(--muted)]">Payroll</span>
            <p className="text-lg font-semibold text-[var(--brand-deep)]">
              {payrollPending.length}
            </p>
          </div>
          <div className="rounded-lg border border-[rgba(32,48,80,0.1)] px-3 py-2">
            <span className="text-[var(--muted)]">Increments</span>
            <p className="text-lg font-semibold text-[var(--brand-deep)]">
              {incrementPending.length}
            </p>
          </div>
          <div className="rounded-lg border border-[rgba(32,48,80,0.1)] px-3 py-2">
            <span className="text-[var(--muted)]">Your role</span>
            <p className="font-semibold text-[var(--brand-deep)]">
              {isApprover ? "Approver" : "Submitter / viewer"}
            </p>
          </div>
        </div>

        {!isApprover ? (
          <p className="mt-3 rounded-lg bg-[rgba(197,160,40,0.12)] px-3 py-2 text-xs text-[var(--brand-deep)]">
            You can view the queue. Sign in as Principal / Admin to approve or
            reject.
          </p>
        ) : null}
      </div>

      <section className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h3 className="font-display text-base font-bold text-[var(--brand-deep)]">
          Payroll runs
        </h3>
        {payrollPending.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            No payroll awaiting approval.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {payrollPending.map((run) => {
              const t = runTotals(run);
              return (
                <li
                  key={run.id}
                  className="rounded-lg border border-[rgba(32,48,80,0.1)] p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[var(--brand-deep)]">
                        {monthLabel(run.month)} · {run.kind} · {t.staff} staff
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        Submitted by {run.submittedBy || "—"}{" "}
                        {run.submittedAt
                          ? `· ${new Date(run.submittedAt).toLocaleString()}`
                          : ""}
                      </p>
                      <p className="mt-1 text-xs text-[var(--brand-deep)]">
                        Gross {formatInr(t.gross)} · Net {formatInr(t.net)} ·
                        Payable {formatInr(t.payable)}
                      </p>
                      {run.submissionNote ? (
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          Note: {run.submissionNote}
                        </p>
                      ) : null}
                    </div>
                    {onOpenPayrollRun ? (
                      <button
                        type="button"
                        className="text-xs font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
                        onClick={() => onOpenPayrollRun(run.id)}
                      >
                        Open run detail
                      </button>
                    ) : null}
                  </div>
                  <label className="mt-2 block text-xs font-semibold text-[var(--muted)]">
                    Decision note {rejecting === run.id ? "(required)" : "(optional for approve)"}
                    <textarea
                      className="field mt-1 min-h-[56px] w-full !py-2 text-xs"
                      value={noteFor(run.id)}
                      onChange={(e) => setNote(run.id, e.target.value)}
                      placeholder="Approve comment or rejection reason"
                    />
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-[#15803d] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                      disabled={!isApprover}
                      onClick={() => onApprovePayroll(run)}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-[#b42318]/40] px-3 py-1.5 text-xs font-semibold text-[#b42318] disabled:opacity-40"
                      disabled={!isApprover}
                      onClick={() => onRejectPayroll(run)}
                    >
                      Reject → draft
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h3 className="font-display text-base font-bold text-[var(--brand-deep)]">
          Salary increments
        </h3>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Approve applies basic overrides immediately. Details:{" "}
          <span className="font-semibold text-[var(--brand-deep)]">
            Payroll → Increment
          </span>
        </p>
        {incrementPending.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            No increment batches awaiting approval.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {incrementPending.map((batch) => {
              const d = batchDelta(batch);
              return (
                <li
                  key={batch.id}
                  className="rounded-lg border border-[rgba(32,48,80,0.1)] p-3"
                >
                  <p className="font-semibold text-[var(--brand-deep)]">
                    {batch.label} · {incrementBatchStatusLabel(batch.status)}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    Effective {batch.effectiveFrom || "—"} · {d.count} staff ·
                    +{formatInr(d.delta)} basic · Submitted by{" "}
                    {batch.submittedBy || "—"}
                    {batch.submittedAt
                      ? ` · ${new Date(batch.submittedAt).toLocaleString()}`
                      : ""}
                  </p>
                  {batch.note ? (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Note: {batch.note}
                    </p>
                  ) : null}
                  <label className="mt-2 block text-xs font-semibold text-[var(--muted)]">
                    Rejection reason (required to reject)
                    <textarea
                      className="field mt-1 min-h-[56px] w-full !py-2 text-xs"
                      value={noteFor(batch.id)}
                      onChange={(e) => setNote(batch.id, e.target.value)}
                      placeholder="Reason if rejecting"
                    />
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-[#15803d] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                      disabled={!isApprover}
                      onClick={() => onApproveIncrement(batch)}
                    >
                      Approve & apply
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-[#b42318]/40] px-3 py-1.5 text-xs font-semibold text-[#b42318] disabled:opacity-40"
                      disabled={!isApprover}
                      onClick={() => onRejectIncrement(batch)}
                    >
                      Reject → draft
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-xs text-[var(--muted)]">
        Leave approvals stay under Staff → Leave. Fee concessions and purchases
        will join this inbox in a later pass.
      </p>
    </div>
  );
}
