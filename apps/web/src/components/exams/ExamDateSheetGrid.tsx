"use client";

/**
 * The date sheet as a date sheet — classes down, exam days across.
 *
 * It used to be one flat row per sitting: 103 rows for this school's
 * half-yearly, sorted by nothing anyone reads a date sheet by, and editing
 * one meant picking "Edit" from a row menu, which filled a form somewhere
 * above and scrolled the thing you were editing off the screen. Nobody can
 * see from that whether Class 6 has two papers on the same morning, or
 * whether Tuesday is empty.
 *
 * This is the shape every school actually publishes: a class per row, an
 * exam day per column, the paper in the cell. Every cell opens in place —
 * subject, start time, duration, note, and the date itself — and a column
 * header moves the whole day at once, which is what happens when a holiday
 * is announced mid-exam.
 *
 * Director's instruction, 18 Sep 2026.
 */

import { useMemo, useState } from "react";
import {
  deleteExamDateSheetEntry,
  listExamDateSheet,
  loadExams,
  saveExamDateSheetEntry,
  subjectsForClass,
  type ExamDateSheetEntry,
  type ExamTerm,
} from "@/lib/exams";
import { examEntryEndTime, examOverlapsBellPeriod } from "@/lib/examTimetable";
import { loadTimetable, teachingPeriods } from "@/lib/timetable";
import type { MastersState } from "@/lib/masters";

type Props = {
  academicYearCode: string;
  masters: MastersState;
  terms: ExamTerm[];
  onChanged: () => void;
};

/**
 * Which cell is open, and which paper inside it.
 *
 * `entryId` is empty when a NEW paper is being added to the cell. A class
 * sitting two papers in one morning is unusual but legal, and a grid that
 * keyed one entry per cell would show the first and silently swallow the
 * second — an exam nobody is told about.
 */
type CellKey = { classId: string; date: string; entryId: string };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** "2026-09-19" → "Sat 19 Sep". The header has one line to say a date in. */
function dayLabel(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function ExamDateSheetGrid({
  academicYearCode,
  masters,
  terms,
  onChanged,
}: Props) {
  const [tick, setTick] = useState(0);
  const [examTermId, setExamTermId] = useState(terms[0]?.id ?? "");
  const [editing, setEditing] = useState<CellKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Draft for the cell being edited. Held here rather than in the cell so
  // that opening another cell abandons the first cleanly.
  const [draftSubjectId, setDraftSubjectId] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [draftStart, setDraftStart] = useState("09:00");
  const [draftDuration, setDraftDuration] = useState("120");
  const [draftNote, setDraftNote] = useState("");
  const [newDay, setNewDay] = useState("");

  const exams = useMemo(() => {
    void tick;
    return loadExams();
  }, [tick]);

  const rows = useMemo(
    () =>
      listExamDateSheet(academicYearCode, undefined, exams).filter(
        (r) => r.examTermId === examTermId,
      ),
    [academicYearCode, exams, examTermId],
  );

  const classes = useMemo(
    () =>
      masters.classes
        .filter((row) => row.isActive !== false)
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [masters],
  );

  /** The columns: every date this term already uses, in order. */
  const dates = useMemo(
    () => [...new Set(rows.map((r) => r.date))].sort(),
    [rows],
  );

  /** classId|date → every sitting in that cell, earliest first. */
  const byCell = useMemo(() => {
    const map = new Map<string, ExamDateSheetEntry[]>();
    for (const r of rows) {
      const key = `${r.classId}|${r.date}`;
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    for (const list of map.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return map;
  }, [rows]);

  const term = terms.find((t) => t.id === examTermId);

  /**
   * The bell periods a paper covers. The flat list showed this in its own
   * column; losing it would drop a real warning — a sitting that overlaps no
   * teaching period is usually a start time somebody mistyped.
   */
  const periods = useMemo(() => {
    void tick;
    return teachingPeriods(loadTimetable().bellTemplate);
  }, [tick]);

  function refresh(message?: string) {
    setTick((v) => v + 1);
    onChanged();
    setError(null);
    if (message) {
      setNotice(message);
      window.setTimeout(() => setNotice(null), 2600);
    }
  }

  function openCell(classId: string, date: string, entryId = "") {
    const existing = entryId
      ? (byCell.get(`${classId}|${date}`) ?? []).find((e) => e.id === entryId)
      : undefined;
    setEditing({ classId, date, entryId });
    setDraftSubjectId(existing?.subjectId ?? "");
    setDraftDate(existing?.date ?? date);
    setDraftStart(existing?.startTime ?? term?.note?.match(/(\d{2}:\d{2})/)?.[1] ?? "09:00");
    setDraftDuration(String(existing?.durationMinutes ?? 120));
    setDraftNote(existing?.note ?? "");
    setError(null);
  }

  function saveCell() {
    if (!editing) return;
    const existing = editing.entryId
      ? (byCell.get(`${editing.classId}|${editing.date}`) ?? []).find((e) => e.id === editing.entryId)
      : undefined;
    const result = saveExamDateSheetEntry({
      id: existing?.id,
      academicYearCode,
      examTermId,
      classId: editing.classId,
      subjectId: draftSubjectId,
      date: draftDate,
      startTime: draftStart,
      durationMinutes: Number(draftDuration),
      note: draftNote,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(null);
    refresh(existing ? "Paper updated" : "Paper added");
  }

  function clearCell() {
    if (!editing) return;
    const existing = editing.entryId
      ? (byCell.get(`${editing.classId}|${editing.date}`) ?? []).find((e) => e.id === editing.entryId)
      : undefined;
    if (!existing) {
      setEditing(null);
      return;
    }
    if (!window.confirm("Remove this paper from the date sheet?")) return;
    const result = deleteExamDateSheetEntry(existing.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(null);
    refresh("Paper removed");
  }

  /**
   * Move a whole exam day. A holiday is announced and every paper on that
   * morning shifts together — doing it cell by cell across thirteen classes
   * is how one class gets left behind on the old date.
   */
  function moveDay(from: string, to: string) {
    if (!to || to === from) return;
    const moving = rows.filter((r) => r.date === from);
    const clash = rows.filter(
      (r) => r.date === to && moving.some((m) => m.classId === r.classId),
    );
    if (clash.length > 0) {
      setError(
        `${clash.length} class${clash.length === 1 ? "" : "es"} already sit a paper on ${dayLabel(to)} — move or clear those first.`,
      );
      return;
    }
    if (
      !window.confirm(
        `Move all ${moving.length} paper${moving.length === 1 ? "" : "s"} from ${dayLabel(from)} to ${dayLabel(to)}?`,
      )
    ) {
      return;
    }
    for (const r of moving) {
      const result = saveExamDateSheetEntry({
        id: r.id,
        academicYearCode,
        examTermId: r.examTermId,
        classId: r.classId,
        subjectId: r.subjectId,
        date: to,
        startTime: r.startTime,
        durationMinutes: r.durationMinutes,
        note: r.note,
      });
      if (!result.ok) {
        setError(result.error);
        refresh();
        return;
      }
    }
    refresh(`Moved ${moving.length} paper${moving.length === 1 ? "" : "s"} to ${dayLabel(to)}`);
  }

  /** The day after the last one scheduled — what "one more exam day" means. */
  const suggestedDay = useMemo(() => {
    if (dates.length > 0) {
      return new Date(Date.parse(`${dates[dates.length - 1]!}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10);
    }
    return term?.startsOn || todayIso();
  }, [dates, term]);

  function addDay() {
    const answer = newDay || suggestedDay;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(answer)) {
      setError("Pick a date for the new exam day.");
      return;
    }
    if (dates.includes(answer)) {
      setError(`${dayLabel(answer)} is already on the date sheet.`);
      return;
    }
    // A column exists only because a paper sits in it, so this opens the
    // first class's cell on the new day rather than inventing an empty
    // column that would vanish on the next render.
    const first = classes[0];
    if (!first) {
      setError("Add a class in Masters first.");
      return;
    }
    openCell(first.id, answer);
    setDraftDate(answer);
    setNewDay("");
  }

  const subjectsForEditing = useMemo(
    () => (editing ? subjectsForClass(editing.classId, exams) : []),
    [editing, exams],
  );

  return (
    <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Date sheet
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Session {academicYearCode}. A class per row, an exam day per
            column. Click any cell to set or change its paper; click a date to
            move that whole day.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Exam
            </span>
            <select
              className="field !py-1.5"
              value={examTermId}
              onChange={(e) => {
                setExamTermId(e.target.value);
                setEditing(null);
              }}
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              New exam day
            </span>
            <input
              type="date"
              className="field !py-1.5"
              value={newDay || suggestedDay}
              onChange={(e) => setNewDay(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold"
            onClick={addDay}
          >
            Add day
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-lg bg-[rgba(15,122,76,0.1)] px-3 py-2 text-xs text-[var(--ok)]">
          {notice}
        </p>
      ) : null}

      {dates.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          No papers scheduled for {term?.label ?? "this exam"} yet. Use{" "}
          <span className="font-semibold">Add exam day</span> to start.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 border border-[var(--border)] bg-[var(--surface-sunken)] p-2 text-left">
                  Class
                </th>
                {dates.map((d) => (
                  <th
                    key={d}
                    className="min-w-[170px] border border-[var(--border)] bg-[var(--surface-sunken)] p-2 text-left align-top"
                  >
                    <div className="font-semibold">{dayLabel(d)}</div>
                    <input
                      type="date"
                      aria-label={`Move every paper on ${dayLabel(d)}`}
                      className="field mt-1 !py-1 !text-[11px]"
                      value={d}
                      onChange={(e) => moveDay(d, e.target.value)}
                    />
                    <div className="mt-0.5 text-[10px] font-normal text-[var(--muted)]">
                      {rows.filter((r) => r.date === d).length} paper(s)
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {classes.map((cls) => (
                <tr key={cls.id}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border border-[var(--border)] bg-[var(--card)] p-2 text-left font-semibold"
                  >
                    {cls.name}
                  </th>
                  {dates.map((d) => {
                    const entries = byCell.get(`${cls.id}|${d}`) ?? [];
                    const open =
                      editing?.classId === cls.id && editing?.date === d;
                    return (
                      <td
                        key={d}
                        className="border border-[var(--border)] p-1 align-top"
                      >
                        {open ? (
                          <div className="grid gap-1 p-1">
                            <select
                              aria-label="Subject"
                              className="field !py-1 !text-xs"
                              value={draftSubjectId}
                              onChange={(e) => setDraftSubjectId(e.target.value)}
                            >
                              <option value="">Select subject…</option>
                              {subjectsForEditing.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                            <input
                              type="date"
                              aria-label="Date of this paper"
                              className="field !py-1 !text-xs"
                              value={draftDate}
                              onChange={(e) => setDraftDate(e.target.value)}
                            />
                            <div className="grid grid-cols-2 gap-1">
                              <input
                                type="time"
                                aria-label="Start time"
                                className="field !py-1 !text-xs"
                                value={draftStart}
                                onChange={(e) => setDraftStart(e.target.value)}
                              />
                              <input
                                type="number"
                                min={1}
                                max={480}
                                aria-label="Duration in minutes"
                                className="field !py-1 !text-xs"
                                value={draftDuration}
                                onChange={(e) => setDraftDuration(e.target.value)}
                              />
                            </div>
                            <input
                              aria-label="Note"
                              className="field !py-1 !text-xs"
                              placeholder="Note (optional)"
                              value={draftNote}
                              onChange={(e) => setDraftNote(e.target.value)}
                            />
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                className="btn-accent rounded-lg px-2 py-1 text-xs font-bold"
                                onClick={saveCell}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-semibold"
                                onClick={() => setEditing(null)}
                              >
                                Cancel
                              </button>
                              {editing?.entryId ? (
                                <button
                                  type="button"
                                  className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-semibold text-[var(--danger)]"
                                  onClick={clearCell}
                                >
                                  Clear
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <div className="grid gap-1">
                            {entries.map((entry) => {
                              const subject = exams.subjects.find(
                                (s) => s.id === entry.subjectId,
                              );
                              return (
                                <button
                                  key={entry.id}
                                  type="button"
                                  className="w-full rounded-lg p-1.5 text-left hover:bg-[var(--surface-sunken)]"
                                  onClick={() => openCell(cls.id, d, entry.id)}
                                  aria-label={`Change ${subject?.name ?? "paper"} for ${cls.name} on ${dayLabel(d)}`}
                                >
                                  <div className="font-semibold text-[var(--brand-deep)]">
                                    {subject?.name ?? "—"}
                                  </div>
                                  <div className="text-[11px] text-[var(--muted)]">
                                    {entry.startTime}–{examEntryEndTime(entry)}
                                  </div>
                                  {entry.note ? (
                                    <div className="text-[10px] text-[var(--muted)]">
                                      {entry.note}
                                    </div>
                                  ) : null}
                                  {periods.some((p) => examOverlapsBellPeriod(entry, p)) ? null : (
                                    <div className="text-[10px] font-semibold text-[var(--warning)]">
                                      Outside bell periods
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                            <button
                              type="button"
                              className="w-full rounded-lg p-1.5 text-left text-[var(--muted)] hover:bg-[var(--surface-sunken)]"
                              onClick={() => openCell(cls.id, d)}
                              aria-label={`Add a paper for ${cls.name} on ${dayLabel(d)}`}
                            >
                              +
                            </button>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
