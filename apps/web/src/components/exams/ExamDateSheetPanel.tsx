"use client";

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
import {
  examEntryEndTime,
  examOverlapsBellPeriod,
} from "@/lib/examTimetable";
import { loadTimetable, teachingPeriods } from "@/lib/timetable";
import type { MastersState } from "@/lib/masters";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";
import { RowActionMenu } from "@/components/ui/erp-grid";

type Props = {
  academicYearCode: string;
  masters: MastersState;
  terms: ExamTerm[];
  onChanged: () => void;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function ExamDateSheetPanel({
  academicYearCode,
  masters,
  terms,
  onChanged,
}: Props) {
  const [tick, setTick] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [examTermId, setExamTermId] = useState(terms[0]?.id ?? "");
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [date, setDate] = useState(terms[0]?.startsOn || todayIso());
  const [startTime, setStartTime] = useState("09:00");
  const [duration, setDuration] = useState("120");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const exams = useMemo(() => {
    void tick;
    return loadExams();
  }, [tick]);
  const rows = useMemo(
    () => listExamDateSheet(academicYearCode, undefined, exams),
    [academicYearCode, exams],
  );
  const subjects = useMemo(
    () => (classId ? subjectsForClass(classId, exams) : []),
    [classId, exams],
  );
  const classes = useMemo(
    () =>
      masters.classes
        .filter((row) => row.isActive !== false)
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [masters],
  );

  function refresh(message?: string) {
    setTick((value) => value + 1);
    onChanged();
    setError(null);
    if (message) {
      setNotice(message);
      window.setTimeout(() => setNotice(null), 2800);
    }
  }

  function resetDraft() {
    setEditingId(null);
    setClassId("");
    setSubjectId("");
    setDate(
      terms.find((row) => row.id === examTermId)?.startsOn || todayIso(),
    );
    setStartTime("09:00");
    setDuration("120");
    setNote("");
  }

  function startEdit(row: ExamDateSheetEntry) {
    setEditingId(row.id);
    setExamTermId(row.examTermId);
    setClassId(row.classId);
    setSubjectId(row.subjectId);
    setDate(row.date);
    setStartTime(row.startTime);
    setDuration(String(row.durationMinutes));
    setNote(row.note);
    setError(null);
  }

  function save() {
    const result = saveExamDateSheetEntry({
      id: editingId ?? undefined,
      academicYearCode,
      examTermId,
      classId,
      subjectId,
      date,
      startTime,
      durationMinutes: Number(duration),
      note,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const term = terms.find((row) => row.id === examTermId);
    resetDraft();
    refresh(`${editingId ? "Updated" : "Added"} ${term?.code ?? "exam"} sitting`);
  }

  function remove(row: ExamDateSheetEntry) {
    if (!window.confirm("Remove this exam sitting from the date-sheet?")) return;
    const result = deleteExamDateSheetEntry(row.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (editingId === row.id) resetDraft();
    refresh("Exam sitting removed");
  }

  const ayBounds = useMemo(() => {
    const year = masters.academicYears.find((y) => y.code === academicYearCode);
    return {
      startsOn: year?.startsOn?.slice(0, 10) || "",
      endsOn: year?.endsOn?.slice(0, 10) || "",
    };
  }, [masters, academicYearCode]);
  const selectedTerm = terms.find((row) => row.id === examTermId);
  const dateMin =
    selectedTerm?.startsOn || ayBounds.startsOn || undefined;
  const dateMax = selectedTerm?.endsOn || ayBounds.endsOn || undefined;

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(300px,0.8fr)_minmax(520px,1.4fr)]">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          {editingId ? "Edit exam sitting" : "Add exam sitting"}
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Session {academicYearCode}. Applies to every section of the selected
          class. Duration is mapped to overlapping timetable bell periods.
        </p>

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

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Exam
            </span>
            <select
              className="field !py-1.5"
              value={examTermId}
              onChange={(event) => {
                const value = event.target.value;
                const term = terms.find((row) => row.id === value);
                setExamTermId(value);
                if (term?.startsOn) setDate(term.startsOn);
              }}
            >
              <option value="">Select…</option>
              {terms.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.code} · {term.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Class
            </span>
            <select
              className="field !py-1.5"
              value={classId}
              onChange={(event) => {
                setClassId(event.target.value);
                setSubjectId("");
              }}
            >
              <option value="">Select…</option>
              {classes.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Subject
            </span>
            <select
              className="field !py-1.5"
              value={subjectId}
              disabled={!classId}
              onChange={(event) => setSubjectId(event.target.value)}
            >
              <option value="">Select…</option>
              {subjects.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} · {row.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Date
            </span>
            <input
              type="date"
              className="field !py-1.5"
              min={dateMin}
              max={dateMax}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Start time
            </span>
            <input
              type="time"
              className="field !py-1.5"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </label>

          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Duration (minutes)
            </span>
            <input
              type="number"
              min={1}
              max={480}
              className="field !py-1.5"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </label>

          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Note (optional)
            </span>
            <input
              className="field !py-1.5"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Reporting time, room, instructions…"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-accent rounded-lg px-3 py-2 text-sm font-bold"
            onClick={save}
          >
            {editingId ? "Save changes" : "Add to date-sheet"}
          </button>
          {editingId ? (
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold"
              onClick={resetDraft}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Exam date-sheet
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Session {academicYearCode} only. These dated sittings override regular
          lessons only on their actual date; the reusable weekly timetable
          remains intact.
        </p>

        {rows.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--muted)]">
            No exam sittings scheduled for {academicYearCode}.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <ErpTable minWidth="min-w-[760px]" className="border-collapse">
              <ErpTableHead>
                <tr>
                  {[
                    "Date",
                    "Exam",
                    "Class",
                    "Subject",
                    "Time",
                    "Blocked periods",
                    "Actions",
                  ].map((label) => (
                    <th
                      key={label}
                      className="border border-[var(--border)] bg-[var(--surface-sunken)] p-2 text-left"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {rows.map((row) => {
                  const term = exams.terms.find(
                    (item) => item.id === row.examTermId,
                  );
                  const subject = exams.subjects.find(
                    (item) => item.id === row.subjectId,
                  );
                  const classRow = masters.classes.find(
                    (item) => item.id === row.classId,
                  );
                  const blocked = teachingPeriods(loadTimetable().bellTemplate)
                    .filter((period) => examOverlapsBellPeriod(row, period))
                    .map((period) => period.label);
                  return (
                    <tr key={row.id}>
                      <td className="border border-[var(--border)] p-2 font-semibold">
                        {row.date}
                      </td>
                      <td className="border border-[var(--border)] p-2">
                        {term?.code ?? "—"}
                      </td>
                      <td className="border border-[var(--border)] p-2">
                        {classRow?.name ?? "—"}
                      </td>
                      <td className="border border-[var(--border)] p-2">
                        {subject?.name ?? "—"}
                      </td>
                      <td className="border border-[var(--border)] p-2">
                        {row.startTime}–{examEntryEndTime(row)}
                        <div className="text-[10px] text-[var(--muted)]">
                          {row.durationMinutes} min
                        </div>
                      </td>
                      <td className="border border-[var(--border)] p-2">
                        {blocked.join(", ") || (
                          <span className="font-semibold text-[var(--warning)]">
                            Outside bell periods
                          </span>
                        )}
                      </td>
                      <td className="border border-[var(--border)] p-2">
                        <RowActionMenu
                          row={row}
                          label="Date-sheet row actions"
                          actions={[
                            { id: "edit", label: "Edit this sitting", onSelect: (r) => startEdit(r) },
                            {
                              id: "remove",
                              label: "Remove from date sheet",
                              tone: "danger",
                              separatorAbove: true,
                              onSelect: (r) => remove(r),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </ErpTableBody>
            </ErpTable>
          </div>
        )}
      </section>
    </div>
  );
}

