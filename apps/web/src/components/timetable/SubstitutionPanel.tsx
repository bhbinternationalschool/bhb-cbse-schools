"use client";

import { useEffect, useMemo, useState } from "react";
import {
  WEEKDAY_SHORT,
  classSectionLabel,
  loadTimetable,
  subjectLabel,
  teacherLabel,
  teachingPeriods,
  type TimetableState,
  type TimetableSubstitution,
} from "@/lib/timetable";
import {
  absentTeachersForDate,
  autoArrangeSubstitutes,
  clearSubstitutionsForDate,
  listSubstitutionsForDate,
  substituteCandidates,
  type AbsentTeacher,
} from "@/lib/timetableSubstitution";
import { isoDateWeekday } from "@/lib/examTimetable";
import type { MastersState } from "@/lib/masters";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";

export function SubstitutionPanel(props: {
  masters: MastersState;
  academicYearCode: string;
  canEdit: boolean;
  ayBounds: { startsOn: string; endsOn: string };
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
  onChanged: () => void;
}) {
  const { masters, academicYearCode: ay, canEdit } = props;
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [state, setState] = useState<TimetableState | null>(null);
  const [manualAbsent, setManualAbsent] = useState<string[]>([]);
  const [manualPick, setManualPick] = useState("");
  const [rows, setRows] = useState<TimetableSubstitution[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setState(loadTimetable());
  }, []);

  useEffect(() => {
    if (!props.ayBounds.startsOn && !props.ayBounds.endsOn) return;
    setDate((prev) => {
      if (props.ayBounds.startsOn && prev < props.ayBounds.startsOn) {
        return props.ayBounds.startsOn;
      }
      if (props.ayBounds.endsOn && prev > props.ayBounds.endsOn) {
        return props.ayBounds.endsOn;
      }
      return prev;
    });
  }, [ay, props.ayBounds.startsOn, props.ayBounds.endsOn]);

  const weekday = isoDateWeekday(date);

  const detectedAbsent = useMemo<AbsentTeacher[]>(() => {
    if (!date || weekday == null) return [];
    return absentTeachersForDate(masters, ay, date);
  }, [masters, ay, date, weekday]);

  const allAbsent = useMemo<AbsentTeacher[]>(() => {
    const seen = new Set(detectedAbsent.map((a) => a.staffId));
    return [
      ...detectedAbsent,
      ...manualAbsent
        .filter((id) => !seen.has(id))
        .map((id) => ({
          staffId: id,
          source: "manual" as const,
          reason: "Marked absent here",
        })),
    ];
  }, [detectedAbsent, manualAbsent]);

  const absentIds = useMemo(
    () => new Set(allAbsent.map((a) => a.staffId)),
    [allAbsent],
  );

  const saved = useMemo(() => {
    if (!state) return [];
    return listSubstitutionsForDate(ay, date, state);
  }, [state, ay, date]);

  // Load the saved arrangement into the editor whenever date/session changes.
  useEffect(() => {
    setRows(saved);
    setDirty(false);
    setManualAbsent([]);
  }, [ay, date, state]); // eslint-disable-line react-hooks/exhaustive-deps

  const teaching = useMemo(
    () => (state ? teachingPeriods(state.bellTemplate) : []),
    [state],
  );

  const activeStaff = useMemo(
    () => (masters.staff ?? []).filter((s) => s.status === "active"),
    [masters],
  );

  function refreshState() {
    setState(loadTimetable());
    props.onChanged();
  }

  function onAutoArrange() {
    if (!allAbsent.length) {
      props.onError(
        "No absent teachers found for this date — mark staff attendance / approve leave, or add one manually below.",
      );
      return;
    }
    const result = autoArrangeSubstitutes({
      masters,
      academicYearCode: ay,
      date,
      absentTeacherIds: allAbsent.map((a) => a.staffId),
    });
    if (!result.substitutions.length) {
      props.onNotice(
        result.examSkipped.length
          ? "All affected periods are exam-blocked on this date — nothing to arrange."
          : "Absent teacher(s) have no periods on this weekday — nothing to arrange.",
      );
      setRows([]);
      setDirty(false);
      return;
    }
    setRows(result.substitutions);
    setDirty(true);
    const bits = [`${result.substitutions.length} period(s) arranged`];
    if (result.uncovered.length) {
      bits.push(`${result.uncovered.length} left free (no teacher available)`);
    }
    if (result.examSkipped.length) {
      bits.push(`${result.examSkipped.length} skipped (exam sitting)`);
    }
    props.onNotice(`${bits.join(" · ")} — review and press Save arrangement.`);
  }

  function candidatesForRow(row: TimetableSubstitution) {
    if (!state) return [];
    const taken = new Set(
      rows
        .filter(
          (r) =>
            r.id !== row.id &&
            r.periodNo === row.periodNo &&
            r.substituteTeacherId,
        )
        .map((r) => r.substituteTeacherId),
    );
    const subLoad = new Map<string, number>();
    for (const r of rows) {
      if (r.id === row.id || !r.substituteTeacherId) continue;
      subLoad.set(
        r.substituteTeacherId,
        (subLoad.get(r.substituteTeacherId) || 0) + 1,
      );
    }
    return substituteCandidates({
      masters,
      state,
      academicYearCode: ay,
      period: row,
      absentTeacherIds: absentIds,
      takenTeacherIds: taken,
      subLoadByTeacher: subLoad,
    });
  }

  function setRowSubstitute(id: string, substituteTeacherId: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              substituteTeacherId,
              source: "manual",
              note: substituteTeacherId
                ? "Edited by school"
                : "Period left free (school choice)",
            }
          : r,
      ),
    );
    setDirty(true);
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setDirty(true);
  }

  async function onSave() {
    const { saveSubstitutionsForDate } = await import(
      "@/lib/timetableSubstitution"
    );
    const r = saveSubstitutionsForDate(ay, date, rows);
    if (!r.ok) {
      props.onError(r.error);
      return;
    }
    setDirty(false);
    refreshState();
    props.onNotice(
      `Arrangement saved for ${date} — ${rows.length} period(s). Teachers see it in By teacher.`,
    );
  }

  function onClearSaved() {
    if (!window.confirm(`Remove the saved arrangement for ${date}?`)) return;
    clearSubstitutionsForDate(ay, date);
    setRows([]);
    setDirty(false);
    refreshState();
    props.onNotice(`Arrangement cleared for ${date}`);
  }

  const periodTime = (periodNo: number) => {
    const p = teaching.find((x) => x.no === periodNo);
    return p ? `${p.startTime}–${p.endTime}` : "";
  };

  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Substitute arrangement · {ay}
            </h2>
            <p className="mt-1 max-w-2xl text-[12px] text-[var(--muted)]">
              Absent teachers are picked up automatically from Staff attendance
              (A / LE / HD) and approved staff leave for the chosen date.
              Auto-arrange finds a free teacher for each affected period —
              subject teachers of that class rank first, then any free teacher
              with the lightest load. Every row can be edited before saving.
            </p>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Date
            </span>
            <input
              type="date"
              className="field !w-auto !py-1.5"
              min={props.ayBounds.startsOn || undefined}
              max={props.ayBounds.endsOn || undefined}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-4 rounded-lg bg-[var(--surface-sunken)] p-3">
          <h3 className="text-[12px] font-bold text-[var(--brand-deep)]">
            Absent on {date}
            {weekday != null ? ` (${WEEKDAY_SHORT[weekday]})` : ""}
          </h3>
          {allAbsent.length === 0 ? (
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              No teacher absent per staff attendance / approved leave.
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {allAbsent.map((a) => (
                <li
                  key={a.staffId}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--danger-soft)] px-2.5 py-1 text-[11px] font-semibold text-[#991b1b]"
                >
                  {teacherLabel(masters, a.staffId)}
                  <span className="font-normal text-[10px]">· {a.reason}</span>
                  {a.source === "manual" && canEdit ? (
                    <button
                      type="button"
                      aria-label="Remove"
                      className="font-bold"
                      onClick={() =>
                        setManualAbsent((prev) =>
                          prev.filter((id) => id !== a.staffId),
                        )
                      }
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canEdit ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                className="field !inline-block !w-auto !py-1 text-sm"
                value={manualPick}
                onChange={(e) => setManualPick(e.target.value)}
              >
                <option value="">Add absent teacher manually…</option>
                {activeStaff
                  .filter((s) => !absentIds.has(s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1 text-sm font-semibold"
                disabled={!manualPick}
                onClick={() => {
                  if (!manualPick) return;
                  setManualAbsent((prev) => [...prev, manualPick]);
                  setManualPick("");
                }}
              >
                Add
              </button>
            </div>
          ) : null}
        </div>

        {canEdit ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-accent rounded-lg px-3 py-2 text-sm font-bold"
              onClick={onAutoArrange}
            >
              Auto-arrange substitutes
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold disabled:opacity-50"
              disabled={!dirty}
              onClick={onSave}
            >
              Save arrangement
            </button>
            {saved.length ? (
              <button
                type="button"
                className="rounded-lg border border-[var(--danger)]/40 px-3 py-2 text-sm font-semibold text-[var(--danger)]"
                onClick={onClearSaved}
              >
                Clear saved
              </button>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-[var(--muted)]">
            View only — need timetable edit to arrange substitutes.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Arrangement for {date}
          </h3>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
              dirty
                ? "bg-[rgba(217,119,6,0.15)] text-[var(--warning)]"
                : saved.length
                  ? "bg-[rgba(15,122,76,0.12)] text-[var(--ok)]"
                  : "bg-[var(--surface-sunken)] text-[var(--muted)]"
            }`}
          >
            {dirty ? "Unsaved changes" : saved.length ? "Saved" : "Nothing saved"}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            No arrangement rows yet. Pick a date with absentees and press
            Auto-arrange substitutes.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <ErpTable minWidth="min-w-[720px]" className="border-collapse">
              <ErpTableHead>
                <tr>
                  <th className="border border-[var(--border)] p-2">
                    Period
                  </th>
                  <th className="border border-[var(--border)] p-2">
                    Class
                  </th>
                  <th className="border border-[var(--border)] p-2">
                    Subject
                  </th>
                  <th className="border border-[var(--border)] p-2">
                    Absent teacher
                  </th>
                  <th className="border border-[var(--border)] p-2">
                    Substitute
                  </th>
                  <th className="border border-[var(--border)] p-2">
                    Note
                  </th>
                  {canEdit ? (
                    <th className="border border-[var(--border)] p-2" />
                  ) : null}
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {rows.map((row) => {
                  const candidates = canEdit ? candidatesForRow(row) : [];
                  const knownIds = new Set(candidates.map((c) => c.staff.id));
                  return (
                    <tr key={row.id}>
                      <td className="border border-[var(--border)] p-2 font-semibold">
                        P{row.periodNo}
                        <div className="text-[10px] font-normal text-[var(--muted)]">
                          {periodTime(row.periodNo)}
                        </div>
                      </td>
                      <td className="border border-[var(--border)] p-2">
                        {classSectionLabel(masters, row.classId, row.sectionId)}
                      </td>
                      <td className="border border-[var(--border)] p-2">
                        {subjectLabel(masters, row.subjectId)}
                      </td>
                      <td className="border border-[var(--border)] p-2 text-[#991b1b]">
                        {teacherLabel(masters, row.absentTeacherId)}
                      </td>
                      <td className="border border-[var(--border)] p-2">
                        {canEdit ? (
                          <select
                            className="field !w-full !py-1 text-xs"
                            value={row.substituteTeacherId}
                            onChange={(e) =>
                              setRowSubstitute(row.id, e.target.value)
                            }
                          >
                            <option value="">— Leave period free —</option>
                            {candidates.map((c) => (
                              <option key={c.staff.id} value={c.staff.id}>
                                {c.staff.fullName}
                                {c.classMatch
                                  ? " · subject+class"
                                  : c.subjectMatch
                                    ? " · subject"
                                    : ""}
                                {` · ${c.dayLoad} pd today`}
                              </option>
                            ))}
                            {row.substituteTeacherId &&
                            !knownIds.has(row.substituteTeacherId) ? (
                              <option value={row.substituteTeacherId}>
                                {teacherLabel(masters, row.substituteTeacherId)}
                              </option>
                            ) : null}
                          </select>
                        ) : row.substituteTeacherId ? (
                          teacherLabel(masters, row.substituteTeacherId)
                        ) : (
                          <span className="text-[var(--muted)]">Free</span>
                        )}
                      </td>
                      <td className="border border-[var(--border)] p-2 text-[var(--muted)]">
                        {row.note}
                        {row.source === "manual" ? (
                          <span className="ml-1 rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[9px] font-semibold">
                            manual
                          </span>
                        ) : null}
                      </td>
                      {canEdit ? (
                        <td className="border border-[var(--border)] p-2 text-center">
                          <button
                            type="button"
                            aria-label="Remove row"
                            className="rounded px-1.5 text-sm font-bold text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                            onClick={() => removeRow(row.id)}
                          >
                            ×
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </ErpTableBody>
            </ErpTable>
          </div>
        )}
      </div>
    </div>
  );
}
