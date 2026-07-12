"use client";

import { useMemo, useState } from "react";
import {
  cancelInstallmentPlan,
  createInstallmentPlan,
  formatInr,
  loadFees,
  paidByDueKey,
} from "@/lib/fees";
import {
  PLAN_INTERVALS,
  activePlanForStudent,
  composeWhatsAppInstallmentPlan,
  planPaidTotal,
  proposeInstallmentSchedule,
  type InstallmentPlan,
  type InstallmentPlanInterval,
} from "@/lib/installmentPlans";
import {
  householdOf,
  householdWhatsApp,
  isValidMobile,
  loadSis,
} from "@/lib/sis";
import { whatsAppPaymentLinkUrl } from "@/lib/payments";
import { TENANT } from "@/lib/types";
import type { LiveDefaulter } from "@/lib/playbook";

export function InstallmentPlanDialog({
  row,
  createdBy,
  onClose,
  onSaved,
}: {
  row: LiveDefaulter;
  createdBy: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const fees = loadFees();
  const existing = activePlanForStudent(
    fees.installmentPlans,
    row.studentId,
  );

  if (existing) {
    return (
      <ActivePlanPanel
        row={row}
        plan={existing}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  }

  return (
    <CreatePlanPanel
      row={row}
      createdBy={createdBy}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function CreatePlanPanel({
  row,
  createdBy,
  onClose,
  onSaved,
}: {
  row: LiveDefaulter;
  createdBy: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const coverDues = row.overdueDues.filter((d) => d.kind !== "plan");
  const totalPaise = coverDues.reduce((s, d) => s + d.balancePaise, 0);
  const today = new Date().toISOString().slice(0, 10);

  const [parts, setParts] = useState(3);
  const [firstDueOn, setFirstDueOn] = useState(today);
  const [interval, setInterval] =
    useState<InstallmentPlanInterval>("monthly");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sendWa, setSendWa] = useState(true);

  const preview = useMemo(
    () =>
      proposeInstallmentSchedule({
        totalPaise,
        parts,
        firstDueOn,
        interval,
      }),
    [totalPaise, parts, firstDueOn, interval],
  );

  function submit() {
    setError(null);
    if (coverDues.length === 0) {
      setError("No overdue dues to put on a plan");
      return;
    }
    const result = createInstallmentPlan({
      studentId: row.studentId,
      householdId: row.householdId,
      dues: coverDues,
      parts,
      firstDueOn,
      interval,
      note,
      createdBy,
      academicYearCode: row.academicYearCode,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (sendWa) {
      const sis = loadSis();
      const mobile = householdWhatsApp(
        householdOf(sis, row.householdId),
      );
      const msg = composeWhatsAppInstallmentPlan({
        schoolName: TENANT.nameDisplay,
        studentName: row.fullName,
        classLabel: row.classLabel,
        plan: result.plan,
      });
      if (mobile && isValidMobile(mobile)) {
        window.open(whatsAppPaymentLinkUrl(mobile, msg), "_blank", "noopener");
      } else {
        void navigator.clipboard.writeText(msg);
      }
    }
    onSaved(
      `Plan ${result.plan.code} created · ${formatInr(result.plan.totalPaise)} in ${result.plan.slices.length} parts`,
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        role="dialog"
        aria-labelledby="plan-title"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="plan-title"
              className="text-lg font-semibold text-[var(--brand-deep)]"
            >
              Installment plan
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {row.fullName} · {row.classLabel} ·{" "}
              <span className="font-semibold text-[var(--danger)]">
                {formatInr(totalPaise)}
              </span>{" "}
              overdue
            </p>
          </div>
          <button
            type="button"
            className="text-sm text-[var(--muted)]"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {coverDues.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">
            No overdue lines to reschedule (student may already be on plan EMIs
            only).
          </p>
        ) : (
          <>
            <div className="mt-4 max-h-28 overflow-y-auto rounded-lg border border-[rgba(32,48,80,0.1)] text-[11px]">
              <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
                {coverDues.slice(0, 8).map((d) => (
                  <li
                    key={d.dueKey}
                    className="flex justify-between gap-2 px-3 py-1.5"
                  >
                    <span className="truncate">{d.label}</span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {formatInr(d.balancePaise)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="block text-sm sm:col-span-1">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Parts
                </span>
                <select
                  className="field !py-1.5"
                  value={parts}
                  onChange={(e) => setParts(Number(e.target.value))}
                >
                  {[2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm sm:col-span-1">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  First due
                </span>
                <input
                  type="date"
                  className="field !py-1.5"
                  value={firstDueOn}
                  onChange={(e) => setFirstDueOn(e.target.value)}
                />
              </label>
              <label className="block text-sm sm:col-span-1">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Interval
                </span>
                <select
                  className="field !py-1.5"
                  value={interval}
                  onChange={(e) =>
                    setInterval(e.target.value as InstallmentPlanInterval)
                  }
                >
                  {PLAN_INTERVALS.map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Schedule preview
              </div>
              <ul className="mt-1 space-y-1 text-sm">
                {preview.map((s, i) => (
                  <li
                    key={`${s.dueOn}-${i}`}
                    className="flex justify-between rounded-lg bg-[var(--surface)] px-3 py-1.5"
                  >
                    <span>
                      {s.label} · {s.dueOn}
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatInr(s.amountPaise)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <label className="mt-3 block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Note (optional)
              </span>
              <input
                className="field !py-1.5"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Agreed with guardian…"
              />
            </label>

            <label className="mt-3 flex items-center gap-2 text-sm text-[var(--brand-deep)]">
              <input
                type="checkbox"
                checked={sendWa}
                onChange={(e) => setSendWa(e.target.checked)}
              />
              Send schedule on WhatsApp
            </label>

            {error ? (
              <p className="mt-3 text-sm text-[#dc2626]">{error}</p>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-xs font-semibold"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold"
                onClick={submit}
              >
                Create plan
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ActivePlanPanel({
  row,
  plan,
  onClose,
  onSaved,
}: {
  row: LiveDefaulter;
  plan: InstallmentPlan;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const paidMap = paidByDueKey(loadFees());
  const paid = planPaidTotal(plan, paidMap);
  const [error, setError] = useState<string | null>(null);

  function onCancel() {
    setError(null);
    const result = cancelInstallmentPlan(plan.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(`Plan ${plan.code} cancelled — original dues restored`);
  }

  function onWhatsApp() {
    const sis = loadSis();
    const mobile = householdWhatsApp(householdOf(sis, row.householdId));
    const msg = composeWhatsAppInstallmentPlan({
      schoolName: TENANT.nameDisplay,
      studentName: row.fullName,
      classLabel: row.classLabel,
      plan,
    });
    if (mobile && isValidMobile(mobile)) {
      window.open(whatsAppPaymentLinkUrl(mobile, msg), "_blank", "noopener");
      onSaved(`Plan ${plan.code} sent on WhatsApp`);
    } else {
      void navigator.clipboard.writeText(msg).then(
        () => onSaved("Plan schedule copied — no WhatsApp on household"),
        () => setError("Could not copy"),
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--brand-deep)]">
              Plan {plan.code}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {row.fullName} · {formatInr(paid)} of {formatInr(plan.totalPaise)}{" "}
              paid
            </p>
          </div>
          <button
            type="button"
            className="text-sm text-[var(--muted)]"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <ul className="mt-4 space-y-1 text-sm">
          {plan.slices.map((s) => {
            const dueKey = `plan:${plan.id}:${s.id}`;
            const slicePaid = Math.min(
              s.amountPaise,
              paidMap.get(dueKey) ?? 0,
            );
            const done = slicePaid >= s.amountPaise;
            return (
              <li
                key={s.id}
                className="flex justify-between rounded-lg bg-[var(--surface)] px-3 py-1.5"
              >
                <span>
                  {s.label} · {s.dueOn}
                  {done ? (
                    <span className="ml-2 text-[10px] font-bold uppercase text-[#15803d]">
                      Paid
                    </span>
                  ) : null}
                </span>
                <span className="font-semibold tabular-nums">
                  {formatInr(s.amountPaise)}
                </span>
              </li>
            );
          })}
        </ul>

        {plan.note ? (
          <p className="mt-3 text-xs text-[var(--muted)]">{plan.note}</p>
        ) : null}

        {error ? (
          <p className="mt-3 text-sm text-[#dc2626]">{error}</p>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-xs font-semibold"
            onClick={onWhatsApp}
          >
            WhatsApp schedule
          </button>
          <button
            type="button"
            className="rounded-lg border border-[#dc2626]/40 px-3 py-1.5 text-xs font-semibold text-[#dc2626]"
            onClick={onCancel}
          >
            Cancel plan
          </button>
          <button
            type="button"
            className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
