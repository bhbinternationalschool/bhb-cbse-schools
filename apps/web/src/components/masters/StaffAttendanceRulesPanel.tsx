"use client";

import { useEffect, useMemo, useState } from "react";
import { RemoveControl } from "@/components/masters/RemoveControl";
import {
  MastersEmptyRow,
  MastersTableCard,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import { loadMasters } from "@/lib/masters";
import {
  RULE_STEP_DEFS,
  activeStaffSorted,
  assignRuleToStaff,
  checkAttendanceRuleRemoval,
  clearStaffRuleAssignments,
  describeRule,
  loadAttendanceRules,
  migrateLegacyTimingIntoMasters,
  newAttendanceRuleDraft,
  removeAttendanceRule,
  upsertAttendanceRule,
  type AttendanceRule,
  type RuleStep,
  type RuleStepKind,
  type StaffAttendanceRulesState,
} from "@/lib/staffAttendanceRules";
import { useModuleStateHydration } from "@/lib/useModuleStateHydration";

export function StaffAttendanceRulesPanel() {
  const [state, setState] = useState<StaffAttendanceRulesState | null>(null);
  // Re-read when the server copy of this module lands (login/refresh hydration).
  useModuleStateHydration("staff_attendance_rules", () => {
    setState(loadAttendanceRules());
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<AttendanceRule | null>(null);
  const [editing, setEditing] = useState(false);

  const [selectedStaff, setSelectedStaff] = useState<Set<string>>(new Set());
  const [assignRuleId, setAssignRuleId] = useState("");

  const roster = useMemo(() => activeStaffSorted(loadMasters().staff ?? []), [state]);

  function reload() {
    migrateLegacyTimingIntoMasters();
    setState(loadAttendanceRules());
  }

  useEffect(() => {
    reload();
  }, []);

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
    }, 2800);
  }

  function startCreate() {
    setDraft(newAttendanceRuleDraft());
    setEditing(false);
  }

  function startEdit(rule: AttendanceRule) {
    setDraft({
      ...rule,
      steps: rule.steps.map((s) => ({ ...s })),
    });
    setEditing(true);
  }

  function patchDraft(p: Partial<AttendanceRule>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  function patchStep(kind: RuleStepKind, p: Partial<RuleStep>) {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        steps: d.steps.map((s) => (s.kind === kind ? { ...s, ...p } : s)),
      };
    });
  }

  function onSaveRule() {
    if (!draft) return;
    const result = upsertAttendanceRule(draft);
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    setState(result.state);
    setDraft(null);
    flash(editing ? `Updated ${result.rule.code}` : `Created ${result.rule.code}`);
  }

  function onDeleteRule(ruleId: string) {
    const result = removeAttendanceRule(ruleId);
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    setState(result.state);
    if (draft?.id === ruleId) setDraft(null);
    flash("Rule removed");
  }

  function toggleStaff(id: string) {
    setSelectedStaff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllStaff(on: boolean) {
    if (!on) {
      setSelectedStaff(new Set());
      return;
    }
    setSelectedStaff(new Set(roster.map((s) => s.id)));
  }

  function onAssign() {
    const result = assignRuleToStaff([...selectedStaff], assignRuleId);
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    setState(result.state);
    flash(`Assigned rule to ${selectedStaff.size} staff`);
    setSelectedStaff(new Set());
  }

  function onClearSelected() {
    if (selectedStaff.size === 0) {
      flash("Select staff to clear", true);
      return;
    }
    const next = clearStaffRuleAssignments([...selectedStaff]);
    setState(next);
    flash(`Cleared rules for ${selectedStaff.size} staff`);
    setSelectedStaff(new Set());
  }

  function ruleName(ruleId: string) {
    return state?.rules.find((r) => r.id === ruleId)?.name ?? "—";
  }

  if (!state) {
    return (
      <p className="text-sm text-[var(--muted)]">Loading attendance rules…</p>
    );
  }

  const activeRules = state.rules.filter((r) => r.isActive);

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg bg-[#fee2e2] px-3 py-2 text-sm font-medium text-[#b91c1c]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3 text-sm text-[var(--muted)]">
        School day hours are set in{" "}
        <strong className="text-[var(--brand-deep)]">Masters → School</strong>
        . Late threshold (minutes) comes from{" "}
        <strong className="text-[var(--brand-deep)]">
          Leave setup → Rule 3
        </strong>
        . Rules below add half-day / Sunday behaviour on top.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <MastersTableCard title="Attendance rules" maxHeight="max-h-[min(60vh,520px)]">
          <div className="border-b border-[var(--border)] px-3 py-2">
            <button
              type="button"
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
              onClick={startCreate}
            >
              + New rule
            </button>
          </div>
          <ul className="divide-y divide-[var(--border)]">
            {state.rules.map((r) => (
              <li
                key={r.id}
                className="flex items-start justify-between gap-2 px-4 py-2.5 text-sm"
              >
                <div>
                  <div className="font-semibold text-[var(--brand-deep)]">
                    {r.code}{" "}
                    <span className="font-normal text-[var(--muted)]">
                      · {r.name}
                    </span>
                    {!r.isActive ? (
                      <span className="ml-2 text-[10px] font-black uppercase text-[var(--muted)]">
                        inactive
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">
                    {describeRule(r)}
                  </div>
                  {r.description ? (
                    <div className="text-[11px] text-[var(--muted)]">
                      {r.description}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    className="text-xs font-medium text-[var(--brand-mid)]"
                    onClick={() => startEdit(r)}
                  >
                    Edit
                  </button>
                  <RemoveControl
                    compact
                    check={checkAttendanceRuleRemoval(state, r.id)}
                    onRemove={() => onDeleteRule(r.id)}
                  />
                </div>
              </li>
            ))}
            {state.rules.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                No attendance rules defined yet
              </li>
            ) : null}
          </ul>
        </MastersTableCard>

        <MastersWorkCard
          title={
            draft
              ? editing
                ? `Edit rule · ${draft.code || "…"}`
                : "Create rule"
              : "Rule editor"
          }
          hint="Compose steps: buffer → half day by time / hours → Sunday exceptional. Enable only what you need."
        >
          {!draft ? (
            <p className="text-sm text-[var(--muted)]">
              Select <strong>Edit</strong> on a rule, or create a new one.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <input
                  className="field !py-1.5 w-28"
                  placeholder="Code"
                  value={draft.code}
                  onChange={(e) =>
                    patchDraft({ code: e.target.value.toUpperCase() })
                  }
                  maxLength={16}
                />
                <input
                  className="field !py-1.5 min-w-[10rem] flex-1"
                  placeholder="Name"
                  value={draft.name}
                  onChange={(e) => patchDraft({ name: e.target.value })}
                />
              </div>
              <input
                className="field !py-1.5 w-full"
                placeholder="Description (optional)"
                value={draft.description}
                onChange={(e) => patchDraft({ description: e.target.value })}
              />
              <div className="flex flex-wrap gap-3 text-xs font-semibold text-[var(--brand-deep)]">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(e) =>
                      patchDraft({ isActive: e.target.checked })
                    }
                  />
                  Active
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={draft.followSchoolTiming}
                    onChange={(e) =>
                      patchDraft({ followSchoolTiming: e.target.checked })
                    }
                  />
                  Follow school timing
                </label>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                  Rule steps
                </p>
                {RULE_STEP_DEFS.map((def) => {
                  const s =
                    draft.steps.find((x) => x.kind === def.kind) ??
                    ({
                      kind: def.kind,
                      enabled: false,
                    } as RuleStep);
                  return (
                    <div
                      key={def.kind}
                      className="rounded-lg border border-[var(--border)] p-2.5"
                    >
                      <label className="flex items-start gap-2 text-sm font-semibold text-[var(--brand-deep)]">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={!!s.enabled}
                          onChange={(e) =>
                            patchStep(def.kind, { enabled: e.target.checked })
                          }
                        />
                        <span>
                          {def.label}
                          <span className="mt-0.5 block text-[10px] font-normal text-[var(--muted)]">
                            {def.hint}
                          </span>
                        </span>
                      </label>
                      {s.enabled &&
                      (def.kind === "buffer_late" ||
                        def.kind === "buffer_early") ? (
                        <p className="mt-2 pl-6 text-[11px] text-[var(--muted)]">
                          Minutes come from Leave setup → Rule 3 (duration
                          considered late).
                        </p>
                      ) : null}
                      {s.enabled && def.kind === "half_day_by_time" ? (
                        <div className="mt-2 flex flex-wrap gap-2 pl-6">
                          <label className="text-xs">
                            Half day if in after
                            <input
                              type="time"
                              className="field !py-1 mt-1"
                              value={s.halfDayInAfter}
                              onChange={(e) =>
                                patchStep(def.kind, {
                                  halfDayInAfter: e.target.value,
                                })
                              }
                            />
                          </label>
                          <label className="text-xs">
                            or out before
                            <input
                              type="time"
                              className="field !py-1 mt-1"
                              value={s.halfDayOutBefore}
                              onChange={(e) =>
                                patchStep(def.kind, {
                                  halfDayOutBefore: e.target.value,
                                })
                              }
                            />
                          </label>
                        </div>
                      ) : null}
                      {s.enabled && def.kind === "half_day_by_hours" ? (
                        <div className="mt-2 flex flex-wrap gap-2 pl-6">
                          <label className="text-xs">
                            Full day min hours
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              className="field !py-1 mt-1 w-24"
                              value={s.minFullDayHours}
                              onChange={(e) =>
                                patchStep(def.kind, {
                                  minFullDayHours: Number(e.target.value) || 0,
                                })
                              }
                            />
                          </label>
                          <label className="text-xs">
                            Absent below hours (0=off)
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              className="field !py-1 mt-1 w-24"
                              value={s.absentBelowHours}
                              onChange={(e) =>
                                patchStep(def.kind, {
                                  absentBelowHours: Number(e.target.value) || 0,
                                })
                              }
                            />
                          </label>
                        </div>
                      ) : null}
                      {s.enabled && def.kind === "sunday_exceptional" ? (
                        <p className="mt-2 pl-6 text-[10px] text-[var(--muted)]">
                          Uses Sunday start/end from school timing when this step
                          is on (or global Sunday exceptional is on).
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
                  onClick={onSaveRule}
                >
                  {editing ? "Save rule" : "Create rule"}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </MastersWorkCard>
      </div>

      <MastersWorkCard
        title="Assign rules to staff"
        hint="Select staff → choose a rule → Assign. Clear removes the assignment."
      >
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="mb-1 block text-[var(--muted)]">Rule</span>
            <select
              className="field !py-1.5 min-w-[12rem]"
              value={assignRuleId}
              onChange={(e) => setAssignRuleId(e.target.value)}
            >
              <option value="">Select rule…</option>
              {activeRules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
            onClick={onAssign}
          >
            Assign to selected ({selectedStaff.size})
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
            onClick={onClearSelected}
          >
            Clear selected
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
            onClick={() => toggleAllStaff(selectedStaff.size !== roster.length)}
          >
            {selectedStaff.size === roster.length ? "Unselect all" : "Select all"}
          </button>
        </div>

        <ErpTableShell className="max-h-[min(48vh,380px)] overflow-auto">
          <ErpTable minWidth="min-w-full">
            <ErpTableHead sticky>
              <tr>
                <th className="px-3 py-2 w-10" />
                <th className="px-3 py-2">Staff</th>
                <th className="px-3 py-2">Assigned rule</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody hoverable>
              {roster.map((s) => {
                const asg = state.assignments.find((a) => a.staffId === s.id);
                return (
                  <tr key={s.id}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedStaff.has(s.id)}
                        onChange={() => toggleStaff(s.id)}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-[var(--brand-deep)]">
                      {s.empCode} · {s.fullName}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--muted)]">
                      {asg ? ruleName(asg.ruleId) : "—"}
                    </td>
                  </tr>
                );
              })}
              {roster.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-3 py-8 text-center text-sm text-[var(--muted)]"
                  >
                    No active staff — add employees in Staff module first
                  </td>
                </tr>
              ) : null}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      </MastersWorkCard>
    </div>
  );
}
