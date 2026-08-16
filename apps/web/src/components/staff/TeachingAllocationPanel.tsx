"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Trash2, UserRound } from "lucide-react";
import type { MastersState } from "@/lib/masters";
import {
  activeTeachers,
  assignClassTeacher,
  assignSubjectTeaching,
  classPeriodDemand,
  findPrimaryClassTeacher,
  findSubjectTeacherConflicts,
  listAllocationGaps,
  listClassSubjectOptions,
  removeClassTeacher,
  removeSubjectTeaching,
  sectionsOfClass,
  teacherWeeklyLoad,
} from "@/lib/teachingAllocation";
import { field, btn } from "@/components/ui/erp-ui";

const ALL_SECTIONS = "__all__";

/**
 * Allocate teaching, teacher first.
 *
 * Pick the teacher once, then give them a class-teacher section and as
 * many subjects as they teach — the class's own subjects appear beside
 * the class picker so the whole choice is visible at once, and "Add"
 * keeps the teacher selected so the next subject is two clicks away.
 *
 * Conflicts are surfaced before saving rather than resolved silently: if
 * someone already holds a slot, the desk says who, because two teachers
 * on one slot makes the timetable unsolvable and per-teacher coverage
 * meaningless.
 */
export function TeachingAllocationPanel({
  masters,
  ay,
  onCommit,
}: {
  masters: MastersState;
  ay: string;
  onCommit: (next: MastersState, msg?: string) => void;
}) {
  const [staffId, setStaffId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Class-teacher form
  const [ctClassId, setCtClassId] = useState("");
  const [ctSectionId, setCtSectionId] = useState("");

  // Subject-teacher form
  const [subClassId, setSubClassId] = useState("");
  const [subSectionId, setSubSectionId] = useState(ALL_SECTIONS);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const teachers = useMemo(() => activeTeachers(masters), [masters]);
  const teacher = useMemo(
    () => teachers.find((t) => t.id === staffId) ?? null,
    [teachers, staffId],
  );

  const classes = useMemo(
    () =>
      (masters.classes ?? [])
        .filter((c) => c.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [masters.classes],
  );

  const gaps = useMemo(() => listAllocationGaps(masters, ay), [masters, ay]);
  const compulsoryGaps = useMemo(
    () => gaps.filter((g) => !g.isOptional).length,
    [gaps],
  );

  /**
   * Weekly load for the class being allocated. Uses `effective`, not the
   * naive sum of every link — electives are alternatives that share a
   * slot, so adding them all up wrongly makes a class look overloaded.
   */
  const demand = useMemo(
    () => (subClassId ? classPeriodDemand(masters, subClassId) : null),
    [masters, subClassId],
  );
  const subjectOptions = useMemo(
    () => listClassSubjectOptions(masters, subClassId),
    [masters, subClassId],
  );
  const subSections = useMemo(
    () => sectionsOfClass(masters, subClassId),
    [masters, subClassId],
  );
  const ctSections = useMemo(
    () => sectionsOfClass(masters, ctClassId),
    [masters, ctClassId],
  );

  const nameOf = {
    class: (id: string) =>
      (masters.classes ?? []).find((c) => c.id === id)?.name ?? "—",
    section: (id: string | null) =>
      id === null
        ? "All sections"
        : ((masters.sections ?? []).find((s) => s.id === id)?.name ?? "—"),
    subject: (id: string) =>
      (masters.subjects ?? []).find((s) => s.id === id)?.nameEn ?? "—",
  };

  const resolvedSectionId =
    subSectionId === ALL_SECTIONS ? null : subSectionId;

  /** Who already holds each ticked subject, so we can warn before saving. */
  const conflicts = useMemo(() => {
    if (!subClassId || picked.size === 0) return [];
    const out: { subjectId: string; names: string[] }[] = [];
    for (const subjectId of picked) {
      const hits = findSubjectTeacherConflicts(masters, {
        academicYearCode: ay,
        classId: subClassId,
        sectionId: resolvedSectionId,
        subjectId,
        exceptStaffId: staffId,
      });
      if (hits.length > 0) {
        out.push({
          subjectId,
          names: [...new Set(hits.map((h) => h.teacherName))],
        });
      }
    }
    return out;
  }, [masters, ay, subClassId, resolvedSectionId, picked, staffId]);

  const ctIncumbent = useMemo(() => {
    if (!ctClassId || !ctSectionId) return null;
    return findPrimaryClassTeacher(masters, {
      academicYearCode: ay,
      classId: ctClassId,
      sectionId: ctSectionId,
    });
  }, [masters, ay, ctClassId, ctSectionId]);

  const load = teacher ? teacherWeeklyLoad(masters, teacher.id, ay) : 0;

  function togglePick(subjectId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) next.delete(subjectId);
      else next.add(subjectId);
      return next;
    });
  }

  function addSubjects() {
    if (!teacher) return setError("Pick a teacher first");
    setError(null);
    const result = assignSubjectTeaching(masters, {
      staffId: teacher.id,
      academicYearCode: ay,
      classId: subClassId,
      sectionId: resolvedSectionId,
      subjectIds: [...picked],
    });
    if (!result.ok) return setError(result.error);
    onCommit(
      result.masters,
      `${result.added} subject${result.added === 1 ? "" : "s"} assigned to ${teacher.fullName}`,
    );
    // Keep the teacher and class selected so the next subject is quick.
    setPicked(new Set());
  }

  function addClassTeacher() {
    if (!teacher) return setError("Pick a teacher first");
    setError(null);
    const result = assignClassTeacher(masters, {
      staffId: teacher.id,
      academicYearCode: ay,
      classId: ctClassId,
      sectionId: ctSectionId,
    });
    if (!result.ok) return setError(result.error);
    onCommit(
      result.masters,
      result.replaced
        ? `${teacher.fullName} is now class teacher — ${result.replaced} was moved off`
        : `${teacher.fullName} set as class teacher`,
    );
    setCtClassId("");
    setCtSectionId("");
  }

  const myClassLinks = (teacher?.classTeacherLinks ?? []).filter(
    (l) => !l.academicYearCode || l.academicYearCode === ay,
  );
  const mySubjectLinks = (teacher?.subjectTeachingLinks ?? []).filter(
    (l) => !l.academicYearCode || l.academicYearCode === ay,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-3">
        <span className="text-sm">
          <strong>{gaps.length}</strong> class-section-subject slot
          {gaps.length === 1 ? "" : "s"} still unassigned
        </span>
        {gaps.length > 0 ? (
          <span className="text-xs text-[var(--muted)]">
            {compulsoryGaps} core · {gaps.length - compulsoryGaps} elective
          </span>
        ) : (
          <span className="text-xs text-[var(--success)]">
            Every slot has a teacher — the timetable can be generated.
          </span>
        )}
      </div>

      {/* 1 — teacher */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
          Step 1 · Teacher
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <UserRound className="h-4 w-4 text-[var(--muted)]" />
          <select
            value={staffId}
            onChange={(e) => {
              setStaffId(e.target.value);
              setError(null);
              setPicked(new Set());
            }}
            className={`${field} max-w-xs`}
          >
            <option value="">Select a teacher…</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fullName} ({t.empCode})
              </option>
            ))}
          </select>
          {teacher ? (
            <span className="text-xs text-[var(--muted)]">
              Current load: <strong>{load}</strong> periods/week ·{" "}
              {mySubjectLinks.length} subject assignment
              {mySubjectLinks.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      {teacher ? (
        <>
          {/* 2 — class teacher */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
              Step 2 · Class teacher of
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <select
                value={ctClassId}
                onChange={(e) => {
                  setCtClassId(e.target.value);
                  setCtSectionId("");
                }}
                className={field}
              >
                <option value="">Class…</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                value={ctSectionId}
                onChange={(e) => setCtSectionId(e.target.value)}
                disabled={!ctClassId}
                className={`${field} disabled:opacity-50`}
              >
                <option value="">Section…</option>
                {ctSections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addClassTeacher}
                disabled={!ctClassId || !ctSectionId}
                className={`${btn} disabled:opacity-50`}
              >
                Set class teacher
              </button>
            </div>
            {ctIncumbent && ctIncumbent.staffId !== teacher.id ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--warning)]">
                <AlertTriangle className="h-3.5 w-3.5" />
                {ctIncumbent.teacherName} is currently class teacher of this
                section — saving will move them off.
              </p>
            ) : null}

            {myClassLinks.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {myClassLinks.map((l) => (
                  <li
                    key={l.id}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-1 text-xs"
                  >
                    {nameOf.class(l.classId)}-{nameOf.section(l.sectionId)}
                    {l.isPrimary ? (
                      <span className="font-semibold text-[var(--success)]">
                        primary
                      </span>
                    ) : (
                      <span className="text-[var(--muted)]">secondary</span>
                    )}
                    <button
                      type="button"
                      aria-label="Remove class teacher role"
                      onClick={() =>
                        onCommit(
                          removeClassTeacher(masters, teacher.id, l.id),
                          "Class teacher role removed",
                        )
                      }
                      className="text-[var(--danger)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {/* 3 — subjects, class picker beside the class's own subjects */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
              Step 3 · Subjects taught
            </p>
            <div className="grid gap-4 md:grid-cols-[minmax(0,15rem)_1fr]">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[var(--muted)]">
                  Class
                  <select
                    value={subClassId}
                    onChange={(e) => {
                      setSubClassId(e.target.value);
                      setSubSectionId(ALL_SECTIONS);
                      setPicked(new Set());
                    }}
                    className={`${field} mt-1 w-full`}
                  >
                    <option value="">Select…</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-[var(--muted)]">
                  Section
                  <select
                    value={subSectionId}
                    onChange={(e) => setSubSectionId(e.target.value)}
                    disabled={!subClassId}
                    className={`${field} mt-1 w-full disabled:opacity-50`}
                  >
                    <option value={ALL_SECTIONS}>All sections</option>
                    {subSections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
                {!subClassId ? (
                  <p className="text-xs text-[var(--muted)]">
                    Pick a class to see the subjects it takes.
                  </p>
                ) : subjectOptions.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">
                    No subjects are linked to this class in Masters yet.
                  </p>
                ) : (
                  <>
                    {demand ? (
                      <p className="mb-2 text-[11px] text-[var(--muted)]">
                        {demand.compulsory} core periods/week
                        {demand.optionalTotal > 0
                          ? ` · ${demand.optionalTotal} across electives (a student takes about ${demand.largestOptional})`
                          : ""}
                      </p>
                    ) : null}
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {subjectOptions.map((o) => {
                        const clash = conflicts.find(
                          (c) => c.subjectId === o.subjectId,
                        );
                        return (
                          <label
                            key={o.subjectId}
                            className="flex items-start gap-2 rounded px-1 py-0.5 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={picked.has(o.subjectId)}
                              onChange={() => togglePick(o.subjectId)}
                              className="mt-0.5"
                            />
                            <span className="min-w-0">
                              {o.name}
                              <span className="ml-1 text-[11px] text-[var(--muted)]">
                                {o.periodsPerWeek}/wk
                              </span>
                              {o.isOptional ? (
                                <span className="ml-1 rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted)]">
                                  elective
                                </span>
                              ) : null}
                              {clash ? (
                                <span className="block text-[11px] text-[var(--warning)]">
                                  already {clash.names.join(", ")}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={addSubjects}
                        disabled={picked.size === 0}
                        className={`${btn} inline-flex items-center gap-1.5 disabled:opacity-50`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add {picked.size || ""} subject
                        {picked.size === 1 ? "" : "s"}
                      </button>
                      <span className="text-[11px] text-[var(--muted)]">
                        The teacher and class stay selected, so you can add
                        another class straight after.
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {mySubjectLinks.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {mySubjectLinks.map((l) => (
                  <li
                    key={l.id}
                    className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-1 text-xs"
                  >
                    <strong>{nameOf.subject(l.subjectId)}</strong>
                    {nameOf.class(l.classId)}-{nameOf.section(l.sectionId)}
                    <span className="text-[var(--muted)]">
                      {l.periodsPerWeek}/wk
                    </span>
                    <button
                      type="button"
                      aria-label="Remove subject assignment"
                      onClick={() =>
                        onCommit(
                          removeSubjectTeaching(masters, teacher.id, l.id),
                          "Assignment removed",
                        )
                      }
                      className="text-[var(--danger)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-[var(--muted)]">
                No subjects assigned to {teacher.fullName} yet.
              </p>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          Choose a teacher to start allocating.
        </p>
      )}

      {gaps.length > 0 ? (
        <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--brand-deep)]">
            Show the {gaps.length} unassigned slots
          </summary>
          <ul className="mt-2 grid gap-1 text-xs text-[var(--muted)] sm:grid-cols-2 lg:grid-cols-3">
            {gaps.map((g) => (
              <li key={`${g.sectionId}-${g.subjectId}`}>
                {g.className}-{g.sectionName} · {g.subjectName}{" "}
                <span className="opacity-70">({g.periodsPerWeek}/wk)</span>
                {g.isOptional ? (
                  <span className="opacity-70"> · elective</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
