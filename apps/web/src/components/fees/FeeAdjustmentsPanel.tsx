"use client";

import { useEffect, useMemo, useState } from "react";
import {
  computeStudentDues,
  formatInr,
  loadFees,
  openFeeDues,
  type FeeDueLine,
} from "@/lib/fees";
import {
  FEE_ADJUST_REASONS,
  createFeeAdjustment,
  decideFeeAdjustment,
  feeAdjustmentTypeLabel,
  formatAdjustLimitHint,
  loadFeeAdjustments,
  pendingApprovalCount,
  settleLeavingStudent,
  voidFeeAdjustment,
  type FeeAdjustment,
  type FeeAdjustmentReason,
  type FeeAdjustmentType,
} from "@/lib/feeAdjustments";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { useDemoSession } from "@/components/shell/SessionContext";
import { PaymentReportImportPanel } from "@/components/fees/PaymentReportImportPanel";
import { PreviousDuesImportPanel } from "@/components/fees/PreviousDuesImportPanel";

export function FeeAdjustmentsPanel({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const session = useDemoSession();
  const ay = session.academicYearCode;
  const [sis, setSis] = useState<SisState | null>(null);
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [query, setQuery] = useState("");
  const [studentId, setStudentId] = useState("");
  const [rows, setRows] = useState<FeeAdjustment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const [type, setType] = useState<FeeAdjustmentType>("waiver");
  const [dueKey, setDueKey] = useState("");
  const [amount, setAmount] = useState("");
  const [reasonCode, setReasonCode] =
    useState<FeeAdjustmentReason>("error_correction");
  const [reason, setReason] = useState("");
  const [stopAfter, setStopAfter] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [toGroupId, setToGroupId] = useState("");
  const [adhocHeadId, setAdhocHeadId] = useState("");

  function refresh() {
    setSis(loadSis());
    setMasters(loadMasters());
    setRows(loadFeeAdjustments());
    onChanged?.();
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ay]);

  const students = useMemo(() => {
    if (!sis) return [];
    const q = query.trim().toLowerCase();
    return sis.students
      .filter((s) => s.academicYearCode === ay)
      .filter((s) => {
        if (!q) return true;
        return (
          s.fullName.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q)
        );
      })
      .slice(0, 40);
  }, [sis, query, ay]);

  const student = sis?.students.find((s) => s.id === studentId) ?? null;

  const dues = useMemo(() => {
    if (!student || !masters) return [] as FeeDueLine[];
    return openFeeDues(
      computeStudentDues(student, masters, loadFees(), {
        includeFuture: true,
        includePaid: false,
        includeInactive: student.status === "inactive",
      }),
    );
  }, [student, masters, rows]);

  const pending = rows.filter((r) => r.status === "pending_approval");
  const groups =
    masters?.feeGroups.filter(
      (g) => g.isActive && g.academicYearCode === ay,
    ) ?? [];

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3200);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId) {
      flash("Select a student");
      return;
    }
    const selectedDue = dues.find((d) => d.dueKey === dueKey);
    const amountPaise =
      type === "stop_future" || type === "change_group"
        ? 0
        : type === "waiver" || type === "write_off"
          ? selectedDue?.balancePaise ?? Math.round((Number(amount) || 0) * 100)
          : Math.round((Number(amount) || 0) * 100);

    const result = createFeeAdjustment({
      studentId,
      type,
      dueKey: type === "waiver" || type === "write_off" ? dueKey : null,
      label:
        type === "change_group"
          ? `Change fee group → ${groups.find((g) => g.id === toGroupId)?.name ?? toGroupId}`
          : type === "stop_future"
            ? `Stop future after ${stopAfter}`
            : type === "adhoc"
              ? `Ad-hoc · ${masters?.feeHeads.find((h) => h.id === adhocHeadId)?.nameEn ?? "Charge"}`
              : selectedDue?.label || "Adjustment",
      amountPaise,
      reasonCode,
      reason,
      createdBy: session.fullName,
      stopAfterDate: type === "stop_future" ? stopAfter : null,
      toFeeGroupId: type === "change_group" ? toGroupId : null,
      fromFeeGroupId: student?.feeGroupId ?? null,
      feeHeadId: type === "adhoc" ? adhocHeadId : null,
      dueOn:
        type === "adhoc"
          ? new Date().toISOString().slice(0, 10)
          : selectedDue?.dueOn ?? null,
    });
    if (!result.ok) {
      flash(result.error);
      return;
    }
    flash(
      result.adjustment.status === "pending_approval"
        ? "Sent to Principal for approval"
        : "Adjustment posted — Fee Take updated",
    );
    setReason("");
    setAmount("");
    setDueKey("");
    refresh();
  }

  function onLeaveSettle() {
    if (!student) return;
    const ok = window.confirm(
      `Stop future dues from ${stopAfter}, write off remaining open dues, and mark ${student.fullName} inactive?`,
    );
    if (!ok) return;
    const result = settleLeavingStudent({
      studentId: student.id,
      leavingDate: stopAfter,
      createdBy: session.fullName,
      waiveRemaining: true,
      openDueLines: dues.map((d) => ({
        dueKey: d.dueKey,
        label: d.label,
        balancePaise: d.balancePaise,
      })),
    });
    if (!result.ok) {
      flash(result.error);
      return;
    }
    flash(`Leave settled · ${result.created} adjustment(s)`);
    refresh();
  }

  return (
    <div className="mt-6 space-y-4">
      <PaymentReportImportPanel onImported={refresh} />
      <PreviousDuesImportPanel onImported={refresh} />

      {notice ? (
        <p className="rounded-lg bg-[rgba(32,48,80,0.06)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <p className="text-xs text-[var(--muted)]">{formatAdjustLimitHint()}</p>

      {pending.length > 0 ? (
        <div className="rounded-xl border border-[rgba(197,160,40,0.4)] bg-[rgba(197,160,40,0.08)] p-4">
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
            Principal approval queue · {pending.length}
          </h3>
          <ul className="mt-2 divide-y divide-[rgba(32,48,80,0.08)]">
            {pending.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <div>
                  <div className="font-medium text-[var(--brand-deep)]">
                    {feeAdjustmentTypeLabel(a.type)} · {a.label}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {sis?.students.find((s) => s.id === a.studentId)?.fullName}{" "}
                    · {formatInr(a.amountPaise)} · {a.reason}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-accent rounded-lg px-2.5 py-1 text-[11px] font-semibold"
                    onClick={() => {
                      const r = decideFeeAdjustment({
                        adjustmentId: a.id,
                        approve: true,
                        decidedBy: session.fullName,
                      });
                      flash(r.ok ? "Approved" : r.error);
                      refresh();
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[rgba(32,48,80,0.2)] px-2.5 py-1 text-[11px] font-semibold"
                    onClick={() => {
                      const r = decideFeeAdjustment({
                        adjustmentId: a.id,
                        approve: false,
                        decidedBy: session.fullName,
                      });
                      flash(r.ok ? "Rejected" : r.error);
                      refresh();
                    }}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(240px,0.9fr)_minmax(0,1.4fr)]">
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
            Student
          </h3>
          <input
            className="field mt-2"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name / admission…"
          />
          <ul className="mt-2 max-h-72 overflow-auto divide-y divide-[rgba(32,48,80,0.06)]">
            {students.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setStudentId(s.id)}
                  className={`w-full px-2 py-2 text-left text-sm ${
                    studentId === s.id
                      ? "bg-[rgba(32,48,80,0.08)] font-semibold"
                      : "hover:bg-[rgba(32,48,80,0.04)]"
                  }`}
                >
                  {s.fullName}
                  <span className="block text-[11px] font-normal text-[var(--muted)]">
                    {s.admissionNo} · {s.status}
                    {s.status === "inactive" ? " · inactive dues" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          <form
            onSubmit={onSubmit}
            className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4"
          >
            <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
              New adjustment
              {student ? ` · ${student.fullName}` : ""}
            </h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-[var(--muted)]">Type</span>
                <select
                  className="field"
                  value={type}
                  onChange={(e) =>
                    setType(e.target.value as FeeAdjustmentType)
                  }
                >
                  <option value="waiver">Waive line</option>
                  <option value="write_off">Write-off</option>
                  <option value="stop_future">Stop future installments</option>
                  <option value="change_group">Change fee group</option>
                  <option value="adhoc">Ad-hoc charge</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-[var(--muted)]">Reason code</span>
                <select
                  className="field"
                  value={reasonCode}
                  onChange={(e) =>
                    setReasonCode(e.target.value as FeeAdjustmentReason)
                  }
                >
                  {FEE_ADJUST_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {(type === "waiver" || type === "write_off") && (
              <label className="mt-3 block text-sm">
                <span className="mb-1 block text-[var(--muted)]">Due line</span>
                <select
                  className="field"
                  value={dueKey}
                  onChange={(e) => setDueKey(e.target.value)}
                  required
                >
                  <option value="">Select open due…</option>
                  {dues.map((d) => (
                    <option key={d.dueKey} value={d.dueKey}>
                      {d.label} · {formatInr(d.balancePaise)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {type === "stop_future" || type === "write_off" ? (
              <label className="mt-3 block text-sm">
                <span className="mb-1 block text-[var(--muted)]">
                  Stop / leave date
                </span>
                <input
                  type="date"
                  className="field"
                  value={stopAfter}
                  onChange={(e) => setStopAfter(e.target.value)}
                />
              </label>
            ) : null}

            {type === "change_group" ? (
              <label className="mt-3 block text-sm">
                <span className="mb-1 block text-[var(--muted)]">
                  New fee group
                </span>
                <select
                  className="field"
                  value={toGroupId}
                  onChange={(e) => setToGroupId(e.target.value)}
                  required
                >
                  <option value="">Select…</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.code})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {type === "adhoc" ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block text-[var(--muted)]">Fee head</span>
                  <select
                    className="field"
                    value={adhocHeadId}
                    onChange={(e) => setAdhocHeadId(e.target.value)}
                    required
                  >
                    <option value="">Select…</option>
                    {(masters?.feeHeads ?? [])
                      .filter((h) => h.isActive)
                      .map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.nameEn}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[var(--muted)]">Amount ₹</span>
                  <input
                    className="field"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    inputMode="decimal"
                    required
                  />
                </label>
              </div>
            ) : null}

            <label className="mt-3 block text-sm">
              <span className="mb-1 block text-[var(--muted)]">Reason note</span>
              <textarea
                className="field min-h-[72px]"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
              />
            </label>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="submit"
                className="btn-accent rounded-xl px-4 py-2.5 text-sm font-semibold"
                disabled={!studentId}
              >
                Save adjustment
              </button>
              {student ? (
                <button
                  type="button"
                  className="rounded-xl border border-[rgba(220,38,38,0.35)] px-4 py-2.5 text-sm font-semibold text-[#b91c1c]"
                  onClick={onLeaveSettle}
                >
                  Leave mid-year · stop + write-off + inactive
                </button>
              ) : null}
            </div>
          </form>

          {student && dues.length > 0 ? (
            <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
              <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
                Open ledger · {formatInr(dues.reduce((s, d) => s + d.balancePaise, 0))}
              </h3>
              <ul className="mt-2 max-h-48 overflow-auto text-xs text-[var(--muted)]">
                {dues.map((d) => (
                  <li key={d.dueKey} className="border-b border-[rgba(32,48,80,0.06)] py-1.5">
                    {d.label} · {formatInr(d.balancePaise)} · due {d.dueOn}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
          Recent adjustments
        </h3>
        <ul className="mt-2 divide-y divide-[rgba(32,48,80,0.08)] text-sm">
          {rows.slice(0, 30).map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div>
                <div className="font-medium text-[var(--brand-deep)]">
                  {feeAdjustmentTypeLabel(a.type)} · {a.label}
                </div>
                <div className="text-xs text-[var(--muted)]">
                  {sis?.students.find((s) => s.id === a.studentId)?.fullName} ·{" "}
                  {a.status} · {formatInr(a.amountPaise)} · {a.createdBy}
                </div>
              </div>
              {a.status === "posted" || a.status === "pending_approval" ? (
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--danger)]"
                  onClick={() => {
                    voidFeeAdjustment(a.id, session.fullName);
                    refresh();
                  }}
                >
                  Void
                </button>
              ) : null}
            </li>
          ))}
          {rows.length === 0 ? (
            <li className="py-6 text-center text-[var(--muted)]">
              No adjustments yet
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

export function FeeAdjustmentsBadge() {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(pendingApprovalCount());
    const t = window.setInterval(() => setN(pendingApprovalCount()), 4000);
    return () => window.clearInterval(t);
  }, []);
  if (!n) return null;
  return <span className="ml-1 text-[10px] font-semibold text-[#b45309]">({n})</span>;
}
