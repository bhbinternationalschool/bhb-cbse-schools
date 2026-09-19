"use client";

/**
 * Invigilation duty as a duty chart — classes down, exam days across.
 *
 * It used to be a flat list of every sitting on the left and a form on the
 * right: pick a row, fill the form, repeat. For this school's half-yearly
 * that is 103 rows, and it cannot answer either question the office actually
 * asks — is anybody watching Tuesday, and is one teacher on duty all day.
 * Both are visible at a glance in a chart and in neither in a list.
 *
 * So it takes the shape of the date sheet it is derived from (see
 * ExamDateSheetGrid), and every cell is worked in place: assign, see who is
 * on, take someone off, without the thing being edited scrolling away.
 *
 * What the chart refuses to do is hide a sitting. Two papers in one morning
 * both appear, and a cell with nobody on it is marked rather than left blank,
 * because an empty-looking cell reads as "nothing scheduled" when it means
 * "nobody watching".
 *
 * Director's instruction, 19 Sep 2026.
 */

import { useMemo, useState } from "react";
import { listExamDateSheet, loadExams, type ExamTerm } from "@/lib/exams";
import { examEntryEndTime } from "@/lib/examTimetable";
import { loadTimetable } from "@/lib/timetable";
import type { MastersState } from "@/lib/masters";
import {
  buildInvigilationGrid,
  deleteInvigilationAssignment,
  invigilationCandidates,
  loadInvigilation,
  upsertInvigilationAssignment,
} from "@/lib/examInvigilation";
import { useDemoSession } from "@/components/shell/SessionContext";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErpAlerts } from "@/components/ui/erp-alerts";
import { useModuleStateHydration } from "@/lib/useModuleStateHydration";

type Props = {
  academicYearCode: string;
  masters: MastersState;
  terms: ExamTerm[];
};

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

export function InvigilationPanel({ academicYearCode, masters, terms }: Props) {
  const session = useDemoSession();
  const [tick, setTick] = useState(0);
  // Re-read when the server copy of this module lands (login/refresh hydration).
  useModuleStateHydration("exam_invigilation", () => setTick((t) => t + 1));
  /**
   * The term the user picked, empty until they pick one. The term actually
   * shown falls back to the first one with papers in it: opening on "Unit
   * Test 1" when every paper is under "Half-yearly" shows an empty chart and
   * reads as a broken screen.
   */
  const [chosenTermId, setChosenTermId] = useState("");
  /** Which sitting has its assign box open. One at a time, in its own cell. */
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [roomInput, setRoomInput] = useState("");
  const [teacherInput, setTeacherInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const exams = useMemo(() => {
    void tick;
    return loadExams();
  }, [tick]);
  const invig = useMemo(() => {
    void tick;
    return loadInvigilation();
  }, [tick]);
  const timetableState = useMemo(() => {
    void tick;
    return loadTimetable();
  }, [tick]);

  const firstTermWithPapers = useMemo(() => {
    const has = new Set(
      exams.dateSheet
        .filter((e) => e.academicYearCode === academicYearCode)
        .map((e) => e.examTermId),
    );
    return terms.find((t) => has.has(t.id))?.id ?? terms[0]?.id ?? "";
  }, [exams, terms, academicYearCode]);
  const examTermId = chosenTermId || firstTermWithPapers;

  const entries = useMemo(
    () => listExamDateSheet(academicYearCode, examTermId || undefined, exams),
    [academicYearCode, examTermId, exams],
  );

  const grid = useMemo(
    () =>
      buildInvigilationGrid({
        state: invig,
        entries,
        classOrder: masters.classes.map((c) => c.id),
      }),
    [invig, entries, masters.classes],
  );

  function refresh() {
    setTick((x) => x + 1);
  }

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3500);
  }

  const className = (id: string) => masters.classes.find((c) => c.id === id)?.name || id;
  const subjectName = (id: string) => exams.subjects.find((s) => s.id === id)?.name || id;
  const teacherName = (id: string) =>
    masters.staff.find((s) => s.id === id)?.fullName || id;

  const openEntry = entries.find((e) => e.id === openEntryId) || null;

  const candidates = useMemo(() => {
    if (!openEntry) return [];
    return invigilationCandidates({
      state: invig,
      masters,
      examsState: exams,
      timetableState,
      entry: openEntry,
    });
  }, [openEntry, invig, masters, exams, timetableState]);

  const selectedCandidate = candidates.find((c) => c.teacherId === teacherInput);

  /**
   * What the confirmation is about. The hook reads its message at render, so
   * the duty being removed is held here rather than passed to `ask` — a
   * dialog that says "remove this duty?" without saying whose is how the
   * wrong teacher gets taken off a paper.
   */
  const [confirmWhat, setConfirmWhat] = useState("");
  const { ask, dialog } = useConfirmDialog({
    title: "Remove this invigilation duty?",
    description: confirmWhat,
    tone: "danger",
  });

  function openCell(entryId: string) {
    setOpenEntryId(entryId);
    setTeacherInput("");
    setRoomInput("");
    setError(null);
  }

  function onAssign() {
    if (!openEntry) return;
    if (!teacherInput) {
      setError("Pick a teacher to assign");
      return;
    }
    const already = grid.cells
      .get(`${openEntry.classId}|${openEntry.date}`)
      ?.find((c) => c.entry.id === openEntry.id)
      ?.assignments.some((a) => a.teacherId === teacherInput);
    if (already) {
      setError("This teacher is already on this sitting");
      return;
    }
    upsertInvigilationAssignment(invig, {
      academicYearCode,
      examEntryId: openEntry.id,
      roomLabel: roomInput,
      teacherId: teacherInput,
      createdBy: session.fullName || "staff",
    });
    setTeacherInput("");
    setRoomInput("");
    flash(`${teacherName(teacherInput)} is on ${className(openEntry.classId)} · ${subjectName(openEntry.subjectId)}`);
    refresh();
  }

  function onDelete(id: string, who: string, where: string) {
    setConfirmWhat(`${who} will be taken off ${where}.`);
    ask(() => {
      deleteInvigilationAssignment(invig, id);
      flash(`${who} taken off ${where}`);
      refresh();
    });
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl rounded-lg border border-[var(--border)] bg-[rgba(248,248,240,0.8)] px-3 py-2 text-[11px] text-[var(--muted)]">
          A class per row, an exam day per column. Click a sitting to put a
          teacher on it. Candidates already teaching a class or marked absent at
          that time are flagged — you can still assign them if nobody else is
          free.
        </p>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Exam</span>
          <select
            className="field !py-1.5"
            value={examTermId}
            onChange={(e) => {
              setChosenTermId(e.target.value);
              setOpenEntryId(null);
            }}
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErpAlerts error={error} notice={notice} />

      {grid.orphans.length > 0 ? (
        <p className="rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-[11px] text-[var(--warning)]">
          {grid.orphans.length} duty
          {grid.orphans.length === 1 ? "" : " assignments"} point at papers that
          are no longer on this date sheet — the paper was deleted or moved to
          another exam. They are not shown in the chart below, and the teachers
          on them have not been told anything changed.
        </p>
      ) : null}

      {grid.dates.length === 0 ? (
        <EmptyState
          title="No exam sittings yet"
          description="Add papers on the Date-sheet tab first; duty is assigned against them."
        />
      ) : (
        <>
          <p className="text-[11px] text-[var(--muted)]">
            {grid.sittings} sitting{grid.sittings === 1 ? "" : "s"} ·{" "}
            {grid.unwatched === 0 ? (
              <span className="font-semibold text-[var(--ok)]">all covered</span>
            ) : (
              <span className="font-semibold text-[var(--warning)]">
                {grid.unwatched} with nobody watching
              </span>
            )}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border border-[var(--border)] bg-[var(--surface-sunken)] p-2 text-left">
                    Class
                  </th>
                  {grid.dates.map((d) => {
                    const unwatched = grid.unwatchedByDate.get(d) ?? 0;
                    const papers = entries.filter((e) => e.date === d).length;
                    return (
                      <th
                        key={d}
                        className="min-w-[210px] border border-[var(--border)] bg-[var(--surface-sunken)] p-2 text-left align-top"
                      >
                        <div className="font-semibold">{dayLabel(d)}</div>
                        <div className="mt-0.5 text-[10px] font-normal text-[var(--muted)]">
                          {papers} paper{papers === 1 ? "" : "s"}
                          {unwatched > 0 ? (
                            <span className="text-[var(--warning)]">
                              {" "}
                              · {unwatched} unwatched
                            </span>
                          ) : null}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {grid.classIds.map((classId) => (
                  <tr key={classId}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border border-[var(--border)] bg-[var(--card)] p-2 text-left font-semibold"
                    >
                      {className(classId)}
                    </th>
                    {grid.dates.map((d) => {
                      const cell = grid.cells.get(`${classId}|${d}`) ?? [];
                      return (
                        <td
                          key={d}
                          className="border border-[var(--border)] p-1.5 align-top"
                        >
                          {cell.length === 0 ? (
                            <span className="text-[11px] text-[var(--muted)]">—</span>
                          ) : (
                            <div className="space-y-2">
                              {cell.map(({ entry, assignments }) => {
                                const isOpen = openEntryId === entry.id;
                                const where = `${className(classId)} · ${subjectName(entry.subjectId)}`;
                                return (
                                  <div key={entry.id} className="space-y-1">
                                    <div className="text-[11px] font-semibold text-[var(--brand-deep)]">
                                      {subjectName(entry.subjectId)}
                                      <span className="ml-1 font-normal text-[var(--muted)]">
                                        {entry.startTime}–{examEntryEndTime(entry)}
                                      </span>
                                    </div>

                                    {assignments.length === 0 ? (
                                      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--warning)]">
                                        nobody watching
                                      </div>
                                    ) : (
                                      <ul className="space-y-0.5">
                                        {assignments.map((a) => (
                                          <li
                                            key={a.id}
                                            className="flex items-center justify-between gap-1 rounded-md bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[11px]"
                                          >
                                            <span className="truncate">
                                              {teacherName(a.teacherId)}
                                              {a.roomLabel ? (
                                                <span className="text-[var(--muted)]">
                                                  {" "}
                                                  · {a.roomLabel}
                                                </span>
                                              ) : null}
                                            </span>
                                            <button
                                              type="button"
                                              aria-label={`Take ${teacherName(a.teacherId)} off ${where}`}
                                              className="shrink-0 px-1 text-[var(--muted)] hover:text-[var(--danger)]"
                                              onClick={() =>
                                                onDelete(a.id, teacherName(a.teacherId), where)
                                              }
                                            >
                                              ×
                                            </button>
                                          </li>
                                        ))}
                                      </ul>
                                    )}

                                    {isOpen ? (
                                      <div className="space-y-1 rounded-md border border-[var(--border)] p-1.5">
                                        {candidates.length === 0 ? (
                                          <p className="rounded bg-[var(--warning-soft)] px-1.5 py-1 text-[10px] text-[var(--warning)]">
                                            No teaching staff on this screen, so
                                            there is nobody to put on duty. Open
                                            Masters → Staff once and come back.
                                          </p>
                                        ) : null}
                                        <select
                                          className="field !py-1 !text-[11px]"
                                          value={teacherInput}
                                          onChange={(e) => setTeacherInput(e.target.value)}
                                          disabled={candidates.length === 0}
                                        >
                                          <option value="">Select teacher…</option>
                                          {candidates.map((c) => (
                                            <option key={c.teacherId} value={c.teacherId}>
                                              {c.conflicts.length > 0 ? "⚠ " : ""}
                                              {c.name}
                                              {c.dutyLoadToday > 0
                                                ? ` · ${c.dutyLoadToday} duty today`
                                                : ""}
                                            </option>
                                          ))}
                                        </select>
                                        {selectedCandidate &&
                                        selectedCandidate.conflicts.length > 0 ? (
                                          <p className="rounded bg-[var(--warning-soft)] px-1.5 py-1 text-[10px] text-[var(--warning)]">
                                            {selectedCandidate.conflicts
                                              .map((c) => c.detail)
                                              .join(" · ")}
                                          </p>
                                        ) : null}
                                        <input
                                          className="field !py-1 !text-[11px]"
                                          placeholder="Room (optional)"
                                          value={roomInput}
                                          onChange={(e) => setRoomInput(e.target.value)}
                                        />
                                        <div className="flex gap-1">
                                          <button
                                            type="button"
                                            onClick={onAssign}
                                            className="rounded-md bg-[var(--primary)] px-2 py-1 text-[10px] font-semibold text-[var(--primary-foreground)]"
                                          >
                                            Assign
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setOpenEntryId(null)}
                                            className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-semibold"
                                          >
                                            Done
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => openCell(entry.id)}
                                        className="w-full rounded-md border border-dashed border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
                                      >
                                        + Invigilator
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
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
        </>
      )}
      {dialog}
    </div>
  );
}
