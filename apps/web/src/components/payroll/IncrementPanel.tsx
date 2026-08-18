"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
import { formatInr } from "@/lib/payroll";
import {
  applyIncrementBatch,
  approveIncrementBatch,
  buildIncrementDraft,
  createIndividualIncrement,
  defaultEffectiveFrom,
  deleteIncrementBatch,
  describeIncrementPolicy,
  incrementBatchStatusLabel,
  loadIncrementState,
  normalizeIncrementPolicy,
  previewStaffIncrement,
  saveIncrementState,
  submitIncrementBatch,
  updateIncrementLine,
  upsertIncrementBatch,
  type IncrementBatch,
  type IncrementMode,
  type IncrementPolicy,
} from "@/lib/salaryIncrement";
import { useDemoSession } from "@/components/shell/SessionContext";
import type { MastersState } from "@/lib/masters";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";
import { useModuleStateHydration } from "@/lib/useModuleStateHydration";

type Mode = "policy" | "ops" | "full";

export function IncrementPanel({ mode = "full" }: { mode?: Mode }) {
  const session = useDemoSession();
  const ay = session.academicYearCode || currentAcademicYearCode();
  const [policy, setPolicy] = useState<IncrementPolicy>(
    normalizeIncrementPolicy(null),
  );
  const [batches, setBatches] = useState<IncrementBatch[]>([]);
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "included" | "skipped">(
    "included",
  );

  const [indStaffId, setIndStaffId] = useState("");
  const [indMode, setIndMode] = useState<IncrementMode>("percent");
  const [indValue, setIndValue] = useState(5);
  const [indEffective, setIndEffective] = useState("");
  const [indNote, setIndNote] = useState("");

  const [hydrateTick, setHydrateTick] = useState(0);
  // Re-read when the server copy of this module lands (login/refresh hydration).
  useModuleStateHydration("salary_increment", () => setHydrateTick((t) => t + 1));

  useEffect(() => {
    const s = loadIncrementState();
    setPolicy(normalizeIncrementPolicy(s.policy));
    setBatches(s.batches);
    setMasters(loadMasters());
    if (!effectiveFrom) {
      setEffectiveFrom(defaultEffectiveFrom(s.policy));
    }
    if (!indEffective) {
      setIndEffective(defaultEffectiveFrom(s.policy));
    }
    if (!selectedId && s.batches[0]) setSelectedId(s.batches[0].id);
  }, [tick, hydrateTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(
    () => batches.find((b) => b.id === selectedId) ?? null,
    [batches, selectedId],
  );

  const who = session.fullName || session.roleCode || "admin";

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
    }, 3200);
  }

  function refresh() {
    setTick((t) => t + 1);
  }

  function savePolicy() {
    const state = loadIncrementState();
    const next = normalizeIncrementPolicy(policy);
    saveIncrementState({ ...state, policy: next });
    setPolicy(next);
    flash("Increment policy saved");
    refresh();
  }

  function createBatch() {
    const m = masters || loadMasters();
    const state = loadIncrementState();
    const batch = buildIncrementDraft({
      masters: m,
      policy: state.policy,
      academicYearCode: ay,
      effectiveFrom:
        effectiveFrom || defaultEffectiveFrom(state.policy),
      createdBy: String(who),
    });
    upsertIncrementBatch(batch);
    setSelectedId(batch.id);
    const n = batch.lines.filter((l) => l.status === "included").length;
    flash(`Draft created · ${n} staff included`);
    refresh();
  }

  const staffOptions = useMemo(
    () =>
      (masters?.staff ?? [])
        .filter((s) => s.status === "active")
        .sort((a, b) => a.empCode.localeCompare(b.empCode)),
    [masters],
  );

  const indPreview = useMemo(() => {
    if (!masters || !indStaffId) return null;
    return previewStaffIncrement({
      masters,
      staffId: indStaffId,
      mode: indMode,
      value: indValue,
    });
  }, [masters, indStaffId, indMode, indValue]);

  function onPickIndividual(staffId: string) {
    setIndStaffId(staffId);
    if (!masters || !staffId) return;
    const p = previewStaffIncrement({ masters, staffId });
    if (p && !p.error) {
      setIndMode(p.mode);
      setIndValue(p.value);
    }
  }

  function doIndividual(action: "draft" | "submit" | "apply") {
    if (!indStaffId) return flash("Select a staff member", true);
    const m = masters || loadMasters();
    const r = createIndividualIncrement({
      masters: m,
      staffId: indStaffId,
      academicYearCode: ay,
      effectiveFrom: indEffective || effectiveFrom || defaultEffectiveFrom(policy),
      createdBy: String(who),
      mode: indMode,
      value: indValue,
      note: indNote,
      action,
    });
    if (!r.ok) return flash(r.error, true);
    setSelectedId(r.batch.id);
    if (r.applied) {
      flash(
        `Applied for ${r.batch.lines[0]?.empCode}: ${formatInr(r.batch.lines[0]?.oldBasic || 0)} → ${formatInr(r.batch.lines[0]?.newBasic || 0)}`,
      );
    } else if (r.batch.status === "pending_approval") {
      flash("Individual increment submitted for approval");
    } else {
      flash("Individual draft saved — review & submit from the list");
    }
    setIndNote("");
    refresh();
  }

  function onLineMode(staffId: string, mode: IncrementMode) {
    if (!selected || selected.status !== "draft") return;
    updateIncrementLine(selected.id, staffId, { mode });
    refresh();
  }

  function onLineValue(staffId: string, value: number) {
    if (!selected || selected.status !== "draft") return;
    updateIncrementLine(selected.id, staffId, { value });
    refresh();
  }

  function toggleInclude(staffId: string) {
    if (!selected || selected.status !== "draft") return;
    const line = selected.lines.find((l) => l.staffId === staffId);
    if (!line || line.status === "skipped") return;
    updateIncrementLine(selected.id, staffId, {
      status: line.status === "included" ? "excluded" : "included",
    });
    refresh();
  }

  function doSubmit() {
    if (!selected) return;
    const r = submitIncrementBatch(selected.id, String(who));
    if (!r.ok) return flash(r.error, true);
    flash(
      r.batch.status === "approved"
        ? "Submitted & auto-approved"
        : "Submitted for approval",
    );
    refresh();
  }

  function doApprove() {
    if (!selected) return;
    const r = approveIncrementBatch(selected.id, String(who));
    if (!r.ok) return flash(r.error, true);
    flash("Increment batch approved");
    refresh();
  }

  function doApply() {
    if (!selected) return;
    if (
      !window.confirm(
        "Apply new basic to staff assignments? % heads (DA/HRA/PF) will follow from the new basic.",
      )
    ) {
      return;
    }
    const r = applyIncrementBatch(selected.id, String(who));
    if (!r.ok) return flash(r.error, true);
    flash(`Applied to ${r.applied} staff · basic override updated`);
    refresh();
  }

  function doDelete() {
    if (!selected) return;
    if (!window.confirm("Delete this draft batch?")) return;
    if (!deleteIncrementBatch(selected.id)) {
      return flash("Cannot delete this batch", true);
    }
    setSelectedId("");
    flash("Batch deleted");
    refresh();
  }

  const showPolicy = mode === "policy" || mode === "full";
  const showOps = mode === "ops" || mode === "full";

  const visibleLines = useMemo(() => {
    if (!selected) return [];
    if (filter === "all") return selected.lines;
    if (filter === "included")
      return selected.lines.filter(
        (l) => l.status === "included" || l.status === "excluded",
      );
    return selected.lines.filter((l) => l.status === "skipped");
  }, [selected, filter]);

  const tally = useMemo(() => {
    if (!selected) return null;
    const inc = selected.lines.filter((l) => l.status === "included");
    const delta = inc.reduce((s, l) => s + (l.newBasic - l.oldBasic), 0);
    return { count: inc.length, delta };
  }, [selected]);

  return (
    <div className="space-y-4">
      {notice ? (
        <p className="text-sm font-medium text-[var(--brand-deep)]">{notice}</p>
      ) : null}
      {error ? (
        <p className="text-sm font-medium text-[#b42318]">{error}</p>
      ) : null}

      {showPolicy ? (
        <div className="space-y-3 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-bold text-[var(--brand-deep)]">
                Increment policy
              </h2>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {describeIncrementPolicy(policy)}
              </p>
            </div>
            {mode === "policy" ? (
              <Link
                href="/payroll"
                className="text-xs font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
              >
                Run batches in Payroll →
              </Link>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm font-medium text-[var(--brand-deep)]">
            <input
              type="checkbox"
              checked={policy.enabled}
              onChange={(e) =>
                setPolicy((p) => ({ ...p, enabled: e.target.checked }))
              }
            />
            Policy enabled
          </label>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs font-semibold text-[var(--muted)]">
              Cycle
              <select
                className="field mt-1 !py-2"
                value={policy.cycle}
                onChange={(e) =>
                  setPolicy((p) => ({
                    ...p,
                    cycle: e.target.value as IncrementPolicy["cycle"],
                  }))
                }
              >
                <option value="april">Every April (1 Apr)</option>
                <option value="hold_month">Fixed calendar month</option>
                <option value="anniversary">Joining anniversary month</option>
              </select>
            </label>
            {policy.cycle === "hold_month" ? (
              <label className="text-xs font-semibold text-[var(--muted)]">
                Month (1–12)
                <input
                  type="number"
                  min={1}
                  max={12}
                  className="field mt-1 !py-2"
                  value={policy.cycleMonth}
                  onChange={(e) =>
                    setPolicy((p) => ({
                      ...p,
                      cycleMonth: Number(e.target.value) || 4,
                    }))
                  }
                />
              </label>
            ) : null}
            <label className="text-xs font-semibold text-[var(--muted)]">
              Default mode
              <select
                className="field mt-1 !py-2"
                value={policy.defaultMode}
                onChange={(e) =>
                  setPolicy((p) => ({
                    ...p,
                    defaultMode: e.target.value as IncrementMode,
                  }))
                }
              >
                <option value="percent">Percent of basic</option>
                <option value="fixed">Fixed ₹ on basic</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-[var(--muted)]">
              Min service (months)
              <input
                type="number"
                min={0}
                max={60}
                className="field mt-1 !py-2"
                value={policy.minServiceMonths}
                onChange={(e) =>
                  setPolicy((p) => ({
                    ...p,
                    minServiceMonths: Number(e.target.value) || 0,
                  }))
                }
              />
            </label>
            <label className="text-xs font-semibold text-[var(--muted)]">
              Teaching %
              <input
                type="number"
                min={0}
                max={50}
                step={0.5}
                className="field mt-1 !py-2"
                value={policy.teachingPercent}
                onChange={(e) =>
                  setPolicy((p) => ({
                    ...p,
                    teachingPercent: Number(e.target.value) || 0,
                  }))
                }
              />
            </label>
            <label className="text-xs font-semibold text-[var(--muted)]">
              Non-teaching %
              <input
                type="number"
                min={0}
                max={50}
                step={0.5}
                className="field mt-1 !py-2"
                value={policy.nonTeachingPercent}
                onChange={(e) =>
                  setPolicy((p) => ({
                    ...p,
                    nonTeachingPercent: Number(e.target.value) || 0,
                  }))
                }
              />
            </label>
            <label className="text-xs font-semibold text-[var(--muted)]">
              Teaching fixed ₹
              <input
                type="number"
                min={0}
                className="field mt-1 !py-2"
                value={policy.teachingFixed}
                onChange={(e) =>
                  setPolicy((p) => ({
                    ...p,
                    teachingFixed: Number(e.target.value) || 0,
                  }))
                }
              />
            </label>
            <label className="text-xs font-semibold text-[var(--muted)]">
              Non-teaching fixed ₹
              <input
                type="number"
                min={0}
                className="field mt-1 !py-2"
                value={policy.nonTeachingFixed}
                onChange={(e) =>
                  setPolicy((p) => ({
                    ...p,
                    nonTeachingFixed: Number(e.target.value) || 0,
                  }))
                }
              />
            </label>
            <label className="flex items-center gap-2 self-end text-sm font-medium text-[var(--brand-deep)]">
              <input
                type="checkbox"
                checked={policy.requireApproval}
                onChange={(e) =>
                  setPolicy((p) => ({
                    ...p,
                    requireApproval: e.target.checked,
                  }))
                }
              />
              Require Principal / Admin approval
            </label>
          </div>

          <label className="block text-xs font-semibold text-[var(--muted)]">
            Note
            <input
              className="field mt-1 !py-2"
              value={policy.note}
              onChange={(e) =>
                setPolicy((p) => ({ ...p, note: e.target.value }))
              }
            />
          </label>

          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white"
            onClick={savePolicy}
          >
            Save policy
          </button>
        </div>
      ) : null}

      {showOps ? (
        <>
          <div className="space-y-3 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <div>
              <h2 className="font-display text-lg font-bold text-[var(--brand-deep)]">
                Individual staff
              </h2>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                Ad-hoc increment for one person — skips anniversary / min-service
                filters. Uses approval setting from policy.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs font-semibold text-[var(--muted)] sm:col-span-2">
                Staff
                <select
                  className="field mt-1 !py-2"
                  value={indStaffId}
                  onChange={(e) => onPickIndividual(e.target.value)}
                >
                  <option value="">Select staff…</option>
                  {staffOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.empCode} — {s.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-[var(--muted)]">
                Mode
                <select
                  className="field mt-1 !py-2"
                  value={indMode}
                  onChange={(e) =>
                    setIndMode(e.target.value as IncrementMode)
                  }
                >
                  <option value="percent">Percent of basic</option>
                  <option value="fixed">Fixed ₹ on basic</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-[var(--muted)]">
                {indMode === "percent" ? "Percent" : "Amount ₹"}
                <input
                  type="number"
                  min={0}
                  step={indMode === "percent" ? 0.5 : 100}
                  className="field mt-1 !py-2"
                  value={indValue}
                  onChange={(e) => setIndValue(Number(e.target.value) || 0)}
                />
              </label>
              <label className="text-xs font-semibold text-[var(--muted)]">
                Effective from
                <input
                  type="date"
                  className="field mt-1 !py-2"
                  value={indEffective}
                  onChange={(e) => setIndEffective(e.target.value)}
                />
              </label>
              <label className="text-xs font-semibold text-[var(--muted)] sm:col-span-2 lg:col-span-3">
                Note (optional)
                <input
                  className="field mt-1 !py-2"
                  value={indNote}
                  onChange={(e) => setIndNote(e.target.value)}
                  placeholder="Reason / reference"
                />
              </label>
            </div>
            {indPreview ? (
              <p className="text-sm text-[var(--brand-deep)]">
                {indPreview.error ? (
                  <span className="text-[#b42318]">{indPreview.error}</span>
                ) : (
                  <>
                    Current basic {formatInr(indPreview.oldBasic)} →{" "}
                    <span className="font-bold">
                      {formatInr(indPreview.newBasic)}
                    </span>
                    {indPreview.structureName
                      ? ` · ${indPreview.structureName}`
                      : null}
                  </>
                )}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
                onClick={() => doIndividual("draft")}
                disabled={!indStaffId}
              >
                Save draft
              </button>
              <button
                type="button"
                className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
                onClick={() => doIndividual("submit")}
                disabled={!indStaffId}
              >
                {policy.requireApproval ? "Submit for approval" : "Submit"}
              </button>
              <button
                type="button"
                className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white"
                onClick={() => {
                  if (
                    !window.confirm(
                      policy.requireApproval
                        ? "Policy requires approval — this will submit for approval (not apply yet). Continue?"
                        : "Apply new basic to this staff now?",
                    )
                  ) {
                    return;
                  }
                  doIndividual("apply");
                }}
                disabled={!indStaffId}
              >
                {policy.requireApproval
                  ? "Submit & queue apply"
                  : "Apply now"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
            <p className="w-full text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              Bulk / cycle batch
            </p>
            <label className="text-xs font-semibold text-[var(--muted)]">
              Effective from
              <input
                type="date"
                className="field mt-1 !py-2"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white"
              onClick={createBatch}
              disabled={!policy.enabled}
            >
              Build draft batch
            </button>
            {mode === "ops" ? (
              <Link
                href="/masters"
                className="self-center text-xs font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
              >
                Edit policy in Masters →
              </Link>
            ) : null}
            {!policy.enabled ? (
              <p className="w-full text-xs text-[#b42318]">
                Enable and save the policy before building a batch.
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
            <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                Batches
              </p>
              <ul className="space-y-1">
                {batches.length === 0 ? (
                  <li className="text-xs text-[var(--muted)]">No batches yet</li>
                ) : (
                  batches.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        className={`w-full rounded-lg px-2 py-2 text-left text-xs ${
                          b.id === selectedId
                            ? "bg-[rgba(32,48,80,0.08)] font-semibold text-[var(--brand-deep)]"
                            : "text-[var(--muted)] hover:bg-[rgba(32,48,80,0.04)]"
                        }`}
                        onClick={() => setSelectedId(b.id)}
                      >
                        <span className="block truncate">{b.label}</span>
                        <span className="text-[10px] opacity-80">
                          {b.kind === "individual" ? "1 staff · " : ""}
                          {incrementBatchStatusLabel(b.status)} ·{" "}
                          {b.effectiveFrom}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="space-y-3 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
              {!selected ? (
                <p className="text-sm text-[var(--muted)]">
                  Select or build a batch to review staff increments.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-display text-base font-bold text-[var(--brand-deep)]">
                        {selected.label}
                      </h3>
                      <p className="text-xs text-[var(--muted)]">
                        {incrementBatchStatusLabel(selected.status)} · from{" "}
                        {selected.effectiveFrom}
                        {tally
                          ? ` · ${tally.count} included · +${formatInr(tally.delta)} basic`
                          : null}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selected.status === "draft" ? (
                        <>
                          <button
                            type="button"
                            className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
                            onClick={doSubmit}
                          >
                            Submit
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
                            onClick={doDelete}
                          >
                            Delete
                          </button>
                        </>
                      ) : null}
                      {selected.status === "pending_approval" ? (
                        <button
                          type="button"
                          className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
                          onClick={doApprove}
                        >
                          Approve
                        </button>
                      ) : null}
                      {selected.status === "approved" ? (
                        <button
                          type="button"
                          className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
                          onClick={doApply}
                        >
                          Apply to staff
                        </button>
                      ) : null}
                      {selected.status === "applied" ? (
                        <span className="rounded-lg bg-[rgba(15,118,110,0.12)] px-3 py-1.5 text-xs font-semibold text-teal-800">
                          Applied {selected.appliedAt?.slice(0, 10)}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ["included", "Eligible"],
                        ["skipped", "Skipped"],
                        ["all", "All"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          filter === id
                            ? "bg-[var(--brand-deep)] text-white"
                            : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]"
                        }`}
                        onClick={() => setFilter(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="overflow-x-auto">
                    <ErpTable className="text-xs">
                      <ErpTableHead>
                        <tr>
                          <th className="py-2 pr-2 font-semibold">Staff</th>
                          <th className="py-2 pr-2 font-semibold">Stream</th>
                          <th className="py-2 pr-2 font-semibold">Old basic</th>
                          <th className="py-2 pr-2 font-semibold">Mode</th>
                          <th className="py-2 pr-2 font-semibold">Value</th>
                          <th className="py-2 pr-2 font-semibold">New basic</th>
                          <th className="py-2 font-semibold">Status</th>
                        </tr>
                      </ErpTableHead>
                      <ErpTableBody>
                        {visibleLines.map((l) => (
                          <tr key={l.staffId}>
                            <td className="py-2 pr-2">
                              <span className="font-semibold text-[var(--brand-deep)]">
                                {l.empCode}
                              </span>
                              <span className="block text-[var(--muted)]">
                                {l.fullName}
                              </span>
                            </td>
                            <td className="py-2 pr-2 capitalize">
                              {l.stream.replace("_", "-")}
                            </td>
                            <td className="py-2 pr-2">{formatInr(l.oldBasic)}</td>
                            <td className="py-2 pr-2">
                              {selected.status === "draft" &&
                              l.status !== "skipped" ? (
                                <select
                                  className="field !py-1 !text-xs"
                                  value={l.mode}
                                  onChange={(e) =>
                                    onLineMode(
                                      l.staffId,
                                      e.target.value as IncrementMode,
                                    )
                                  }
                                >
                                  <option value="percent">%</option>
                                  <option value="fixed">₹</option>
                                </select>
                              ) : (
                                l.mode
                              )}
                            </td>
                            <td className="py-2 pr-2">
                              {selected.status === "draft" &&
                              l.status !== "skipped" ? (
                                <input
                                  type="number"
                                  className="field w-20 !py-1 !text-xs"
                                  value={l.value}
                                  onChange={(e) =>
                                    onLineValue(
                                      l.staffId,
                                      Number(e.target.value) || 0,
                                    )
                                  }
                                />
                              ) : (
                                l.value
                              )}
                            </td>
                            <td className="py-2 pr-2 font-semibold">
                              {formatInr(l.newBasic)}
                            </td>
                            <td className="py-2">
                              {l.status === "skipped" ? (
                                <span className="text-[var(--muted)]">
                                  {l.skipReason}
                                </span>
                              ) : selected.status === "draft" ? (
                                <button
                                  type="button"
                                  className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
                                  onClick={() => toggleInclude(l.staffId)}
                                >
                                  {l.status === "included"
                                    ? "Included · exclude"
                                    : "Excluded · include"}
                                </button>
                              ) : (
                                l.status
                              )}
                            </td>
                          </tr>
                        ))}
                      </ErpTableBody>
                    </ErpTable>
                    {visibleLines.length === 0 ? (
                      <p className="py-4 text-sm text-[var(--muted)]">
                        No rows in this filter.
                      </p>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
