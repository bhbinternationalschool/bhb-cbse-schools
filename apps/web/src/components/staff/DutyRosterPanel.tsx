"use client";

import { useMemo, useState } from "react";
import {
  DUTY_TYPES,
  deleteAssignment,
  deleteTemplate,
  dutyStaffLabel,
  dutyTypeLabel,
  generateWeekFromTemplates,
  listAssignmentsForWeek,
  loadDutyRoster,
  notifyDutyStaff,
  upsertAssignment,
  upsertTemplate,
  type DutyRosterState,
  type DutyType,
} from "@/lib/dutyRoster";
import { WEEKDAY_SHORT } from "@/lib/timetable";
import type { MastersState } from "@/lib/masters";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { DeskListActions } from "@/components/ui/desk-list-actions";
import { ErpAlerts } from "@/components/ui/erp-alerts";

type Props = {
  masters: MastersState;
};

function mondayOf(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00`);
  const day = d.getDay(); // 0=Sun..6=Sat
  const back = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - back);
  return d.toISOString().slice(0, 10);
}

function addDays(dateIso: string, n: number): string {
  const d = new Date(`${dateIso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function DutyRosterPanel({ masters }: Props) {
  const [tick, setTick] = useState(0);
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayIso()));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  // New-template form state.
  const [tplDutyType, setTplDutyType] = useState<DutyType>("assembly");
  const [tplLabel, setTplLabel] = useState("");
  const [tplWeekdays, setTplWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [tplStaff, setTplStaff] = useState<string[]>([]);
  const [tplSlots, setTplSlots] = useState(1);

  const state = useMemo(() => {
    void tick;
    return loadDutyRoster();
  }, [tick]);

  function refresh() {
    setTick((x) => x + 1);
  }

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3500);
  }

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekAssignments = listAssignmentsForWeek(state, weekStart);
  const activeStaff = (masters.staff ?? []).filter((s) => s.status === "active");

  const { ask, dialog } = useConfirmDialog({
    title: "Remove this duty assignment?",
    tone: "danger",
  });

  function onGenerate() {
    const { outcome } = generateWeekFromTemplates(state, weekStart);
    if (outcome.created.length === 0) {
      flash("Nothing new to generate — this week is already filled.");
    } else {
      flash(`Generated ${outcome.created.length} duty assignment(s) for this week.`);
    }
    refresh();
  }

  async function onNotifyToday() {
    const today = todayIso();
    const todays = state.assignments.filter((a) => a.date === today);
    if (todays.length === 0) {
      setError("No duty assignments for today to notify.");
      return;
    }
    const res = await notifyDutyStaff(todays, masters, today);
    if (!res.ok) {
      setError(res.error || "Notify failed");
      return;
    }
    flash(`Notified ${res.sent} staff on duty today.`);
  }

  function onRemoveAssignment(id: string) {
    ask(() => {
      deleteAssignment(state, id);
      flash("Removed");
      refresh();
    });
  }

  function onAddTemplate() {
    if (!tplWeekdays.length) {
      setError("Pick at least one weekday");
      return;
    }
    if (!tplStaff.length) {
      setError("Pick at least one staff member for the rotation pool");
      return;
    }
    upsertTemplate(state, {
      dutyType: tplDutyType,
      label: tplLabel,
      weekdays: tplWeekdays,
      staffPool: tplStaff,
      slotsPerDay: tplSlots,
      active: true,
    });
    setTplLabel("");
    setTplStaff([]);
    setTplSlots(1);
    flash("Rotation template added");
    refresh();
  }

  function onDeleteTemplate(id: string) {
    ask(() => {
      deleteTemplate(state, id);
      flash("Template removed");
      refresh();
    });
  }

  function toggleWeekday(list: number[], n: number): number[] {
    return list.includes(n) ? list.filter((x) => x !== n) : [...list, n].sort();
  }

  function toggleStaffPool(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function assignManually(date: string, dutyType: DutyType, staffId: string) {
    if (!staffId) return;
    const already = weekAssignments.some(
      (a) => a.date === date && a.dutyType === dutyType && a.staffId === staffId,
    );
    if (already) {
      setError("Already assigned to this duty on this date");
      return;
    }
    upsertAssignment(state, { date, dutyType, staffId, source: "manual" });
    flash("Assigned");
    refresh();
  }

  return (
    <div className="mt-6 space-y-4">
      <p className="rounded-lg border border-[rgba(32,48,80,0.12)] bg-[rgba(248,248,240,0.8)] px-3 py-2 text-[11px] text-[var(--muted)]">
        Rotation templates auto-fill recurring duties (assembly, gate, lunch,
        bus escort) across the week, spreading load fairly. You can also
        assign or remove any single day manually. This roster is stored on
        this device only for now — not yet synced across devices.
      </p>
      <ErpAlerts error={error} notice={notice} />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setWeekStart(addDays(weekStart, -7))}
          className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-[11px] font-semibold"
        >
          ← Prev week
        </button>
        <span className="text-sm font-semibold text-[var(--brand-deep)]">
          {weekDates[0]} – {weekDates[6]}
        </span>
        <button
          type="button"
          onClick={() => setWeekStart(addDays(weekStart, 7))}
          className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-[11px] font-semibold"
        >
          Next week →
        </button>
        <button
          type="button"
          onClick={() => setWeekStart(mondayOf(todayIso()))}
          className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-[11px] font-semibold"
        >
          This week
        </button>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onGenerate}
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-[11px] font-semibold text-white"
          >
            Generate this week
          </button>
          <button
            type="button"
            onClick={() => void onNotifyToday()}
            className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-[11px] font-semibold"
          >
            Notify today&apos;s duty staff
          </button>
          <button
            type="button"
            onClick={() => setShowTemplates((v) => !v)}
            className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-[11px] font-semibold"
          >
            {showTemplates ? "Hide" : "Manage"} rotation templates
          </button>
        </div>
      </div>

      {showTemplates ? (
        <div className="erp-surface space-y-4">
          {state.templates.length > 0 ? (
            <ul className="space-y-1.5">
              {state.templates.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.1)] px-3 py-1.5 text-sm"
                >
                  <span>
                    <span className="font-semibold text-[var(--brand-deep)]">
                      {t.label}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {dutyTypeLabel(t.dutyType)} ·{" "}
                      {t.weekdays.map((w) => WEEKDAY_SHORT[w]).join(", ")} ·{" "}
                      {t.slotsPerDay}/day · pool of {t.staffPool.length}
                    </span>
                  </span>
                  <DeskListActions
                    onDelete={() => onDeleteTemplate(t.id)}
                    deleteConfirm={`Remove the "${t.label}" rotation template? Already-generated assignments stay.`}
                    deleteLabel="Remove"
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              No rotation templates yet — add one below.
            </p>
          )}

          <div className="space-y-2 border-t border-[rgba(32,48,80,0.08)] pt-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-[11px] font-semibold text-[var(--muted)]">
                Duty type
                <select
                  className="mt-1 w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm"
                  value={tplDutyType}
                  onChange={(e) => setTplDutyType(e.target.value as DutyType)}
                >
                  {DUTY_TYPES.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[11px] font-semibold text-[var(--muted)]">
                Label
                <input
                  className="mt-1 w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm"
                  placeholder={dutyTypeLabel(tplDutyType)}
                  value={tplLabel}
                  onChange={(e) => setTplLabel(e.target.value)}
                />
              </label>
            </div>

            <div>
              <span className="block text-[11px] font-semibold text-[var(--muted)]">
                Weekdays
              </span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {WEEKDAY_SHORT.map((label, n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setTplWeekdays((cur) => toggleWeekday(cur, n))}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                      tplWeekdays.includes(n)
                        ? "bg-[var(--brand-deep)] text-white"
                        : "border border-[rgba(32,48,80,0.15)] text-[var(--muted)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Staff per day
              <input
                type="number"
                min={1}
                className="mt-1 w-24 rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm"
                value={tplSlots}
                onChange={(e) => setTplSlots(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>

            <div>
              <span className="block text-[11px] font-semibold text-[var(--muted)]">
                Rotation pool ({tplStaff.length} selected)
              </span>
              <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-[rgba(32,48,80,0.15)] p-2">
                {activeStaff.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-[rgba(32,48,80,0.04)]"
                  >
                    <input
                      type="checkbox"
                      checked={tplStaff.includes(s.id)}
                      onChange={() => setTplStaff((cur) => toggleStaffPool(cur, s.id))}
                    />
                    {s.fullName}
                  </label>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={onAddTemplate}
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-white"
            >
              Add template
            </button>
          </div>
        </div>
      ) : null}

      <div className="erp-table-shell overflow-x-auto rounded-2xl border border-[rgba(32,48,80,0.12)] bg-white shadow-sm">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[rgba(32,48,80,0.08)] text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 text-left">Duty</th>
              {weekDates.map((d) => (
                <th key={d} className="px-3 py-2 text-left">
                  {WEEKDAY_SHORT[new Date(`${d}T12:00:00`).getDay()]}
                  <div className="font-normal normal-case text-[10px]">{d}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DUTY_TYPES.map((dt) => (
              <tr key={dt.value} className="border-b border-[rgba(32,48,80,0.06)] align-top">
                <td className="px-3 py-2 font-semibold text-[var(--brand-deep)]">
                  {dt.label}
                </td>
                {weekDates.map((date) => {
                  const cellAssignments = weekAssignments.filter(
                    (a) => a.date === date && a.dutyType === dt.value,
                  );
                  return (
                    <td key={date} className="px-3 py-2">
                      <ul className="space-y-1">
                        {cellAssignments.map((a) => (
                          <li
                            key={a.id}
                            className="flex items-center justify-between gap-1 rounded-md bg-[rgba(32,48,80,0.05)] px-1.5 py-1 text-[11px]"
                          >
                            <span>{dutyStaffLabel(masters, a.staffId)}</span>
                            <button
                              type="button"
                              onClick={() => onRemoveAssignment(a.id)}
                              className="text-muted-foreground hover:text-[var(--danger)]"
                              aria-label="Remove"
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                      <select
                        className="mt-1 w-full rounded-md border border-[rgba(32,48,80,0.15)] bg-white px-1.5 py-1 text-[11px]"
                        value=""
                        onChange={(e) => assignManually(date, dt.value, e.target.value)}
                      >
                        <option value="">+ Add…</option>
                        {activeStaff.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.fullName}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialog}
    </div>
  );
}

export type { DutyRosterState };
