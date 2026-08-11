"use client";

import { useMemo, useState } from "react";
import { listExamDateSheet, loadExams, type ExamTerm } from "@/lib/exams";
import { examEntryEndTime } from "@/lib/examTimetable";
import { loadTimetable } from "@/lib/timetable";
import type { MastersState } from "@/lib/masters";
import {
  assignmentsForEntry,
  deleteInvigilationAssignment,
  invigilationCandidates,
  loadInvigilation,
  upsertInvigilationAssignment,
} from "@/lib/examInvigilation";
import { useDemoSession } from "@/components/shell/SessionContext";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { DeskListActions } from "@/components/ui/desk-list-actions";
import { ErpAlerts } from "@/components/ui/erp-alerts";

type Props = {
  academicYearCode: string;
  masters: MastersState;
  terms: ExamTerm[];
};

export function InvigilationPanel({ academicYearCode, masters, terms }: Props) {
  const session = useDemoSession();
  const [tick, setTick] = useState(0);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
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
  const rows = useMemo(
    () => listExamDateSheet(academicYearCode, undefined, exams),
    [academicYearCode, exams],
  );

  function refresh() {
    setTick((x) => x + 1);
  }

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3500);
  }

  const termLabel = (id: string) => terms.find((t) => t.id === id)?.label || "Exam";
  const className = (id: string) => masters.classes.find((c) => c.id === id)?.name || id;
  const subjectName = (id: string) =>
    exams.subjects.find((s) => s.id === id)?.name || id;

  const selectedEntry = rows.find((r) => r.id === selectedEntryId) || null;
  const selectedAssignments = selectedEntry
    ? assignmentsForEntry(invig, selectedEntry.id)
    : [];

  const candidates = useMemo(() => {
    if (!selectedEntry) return [];
    return invigilationCandidates({
      state: invig,
      masters,
      examsState: exams,
      timetableState,
      entry: selectedEntry,
    });
  }, [selectedEntry, invig, masters, exams, timetableState]);

  const selectedCandidate = candidates.find((c) => c.teacherId === teacherInput);

  const { ask, dialog } = useConfirmDialog({
    title: "Remove this invigilation duty?",
    tone: "danger",
  });

  function onAssign() {
    if (!selectedEntry) {
      setError("Pick an exam sitting first");
      return;
    }
    if (!teacherInput) {
      setError("Pick a teacher to assign");
      return;
    }
    const already = selectedAssignments.some((a) => a.teacherId === teacherInput);
    if (already) {
      setError("This teacher is already assigned to this sitting");
      return;
    }
    upsertInvigilationAssignment(invig, {
      academicYearCode,
      examEntryId: selectedEntry.id,
      roomLabel: roomInput,
      teacherId: teacherInput,
      createdBy: session.fullName || "staff",
    });
    setTeacherInput("");
    setRoomInput("");
    flash("Duty assigned");
    refresh();
  }

  function onDelete(id: string) {
    ask(() => {
      deleteInvigilationAssignment(invig, id);
      flash("Removed");
      refresh();
    });
  }

  return (
    <div className="mt-6 space-y-4">
      <p className="rounded-lg border border-[rgba(32,48,80,0.12)] bg-[rgba(248,248,240,0.8)] px-3 py-2 text-[11px] text-[var(--muted)]">
        Assign a teacher (and room) to each exam sitting. Candidates already
        teaching a class or marked absent at that time are flagged — you can
        still assign them if there is no one else free.
      </p>
      <ErpAlerts error={error} notice={notice} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="erp-table-shell overflow-hidden rounded-2xl border border-[rgba(32,48,80,0.12)] bg-white shadow-sm">
          <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Exam sittings
          </div>
          {rows.length === 0 ? (
            <EmptyState
              title="No exam sittings yet"
              description="Add entries on the Date-sheet tab first."
              className="border-0 shadow-none"
            />
          ) : (
            <ul className="max-h-[28rem] divide-y divide-[rgba(32,48,80,0.06)] overflow-y-auto">
              {rows.map((r) => {
                const count = assignmentsForEntry(invig, r.id).length;
                const active = r.id === selectedEntryId;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEntryId(r.id);
                        setTeacherInput("");
                        setRoomInput("");
                        setError(null);
                      }}
                      className={`flex w-full flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition ${
                        active
                          ? "bg-[rgba(32,48,80,0.06)]"
                          : "hover:bg-[rgba(32,48,80,0.03)]"
                      }`}
                    >
                      <span>
                        <span className="font-semibold text-[var(--brand-deep)]">
                          {r.date}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {r.startTime}–{examEntryEndTime(r)} · {className(r.classId)} ·{" "}
                          {subjectName(r.subjectId)} · {termLabel(r.examTermId)}
                        </span>
                      </span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                          count > 0
                            ? "bg-[var(--success-soft)] text-[var(--success)]"
                            : "bg-[rgba(32,48,80,0.08)] text-muted-foreground"
                        }`}
                      >
                        {count} assigned
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="erp-surface space-y-3">
          {!selectedEntry ? (
            <EmptyState
              title="Pick a sitting"
              description="Select an exam sitting on the left to assign invigilation duty."
            />
          ) : (
            <>
              <div>
                <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                  {className(selectedEntry.classId)} · {subjectName(selectedEntry.subjectId)}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {selectedEntry.date} · {selectedEntry.startTime}–
                  {examEntryEndTime(selectedEntry)}
                </p>
              </div>

              {selectedAssignments.length > 0 ? (
                <ul className="space-y-1.5">
                  {selectedAssignments.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.1)] px-3 py-1.5 text-sm"
                    >
                      <span>
                        <span className="font-semibold text-[var(--brand-deep)]">
                          {masters.staff.find((s) => s.id === a.teacherId)?.fullName ||
                            a.teacherId}
                        </span>
                        {a.roomLabel ? (
                          <span className="text-muted-foreground"> · {a.roomLabel}</span>
                        ) : null}
                      </span>
                      <DeskListActions
                        onDelete={() => onDelete(a.id)}
                        deleteConfirm={`Remove this invigilator from ${className(selectedEntry.classId)} · ${subjectName(selectedEntry.subjectId)}?`}
                        deleteLabel="Remove"
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No one assigned yet.</p>
              )}

              <div className="space-y-2 border-t border-[rgba(32,48,80,0.08)] pt-3">
                <label className="block text-[11px] font-semibold text-[var(--muted)]">
                  Assign teacher
                  <select
                    className="mt-1 w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm"
                    value={teacherInput}
                    onChange={(e) => setTeacherInput(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {candidates.map((c) => (
                      <option key={c.teacherId} value={c.teacherId}>
                        {c.conflicts.length > 0 ? "⚠ " : ""}
                        {c.name}
                        {c.dutyLoadToday > 0 ? ` · ${c.dutyLoadToday} duty today` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedCandidate && selectedCandidate.conflicts.length > 0 ? (
                  <p className="rounded-lg bg-[var(--warning-soft)] px-2.5 py-1.5 text-[11px] text-[var(--warning)]">
                    {selectedCandidate.conflicts.map((c) => c.detail).join(" · ")}
                  </p>
                ) : null}
                <label className="block text-[11px] font-semibold text-[var(--muted)]">
                  Room
                  <input
                    className="mt-1 w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm"
                    placeholder="e.g. Room 12 / Hall A"
                    value={roomInput}
                    onChange={(e) => setRoomInput(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={onAssign}
                  className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-white"
                >
                  Assign duty
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {dialog}
    </div>
  );
}
