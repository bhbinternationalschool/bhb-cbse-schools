"use client";

import { useMemo } from "react";
import type { MastersState } from "@/lib/masters";
import {
  newFoundationId,
  type StaffClassTeacherLink,
  type StaffSubjectTeachingLink,
} from "@/lib/foundationMasters";
import { offeringForClass } from "@/lib/studentCurriculum";
import { useDemoSession } from "@/components/shell/SessionContext";

/**
 * Assign a class teacher and subject teachers from the class/section side.
 *
 * The data (StaffClassTeacherLink, StaffSubjectTeachingLink) and the write
 * path already existed — StaffDutiesPanel lets office assign a teacher's
 * classes/subjects from that teacher's own profile, one teacher at a time.
 * This is the other direction: pick a section, see and set who teaches it,
 * without opening each teacher individually. Same underlying arrays, same
 * commit(MastersState) -> saveMasters path StaffProfileForm already uses —
 * no new save mechanism.
 *
 * A section has at most one class teacher and, per subject, at most one
 * subject teacher — so every set-call here first strips any existing link
 * for that (class, section, subject, year) off every staff record, then
 * adds the new one to the chosen staff member. Both steps happen inside one
 * staff.map() pass, so it lands as a single commit — never two saves with a
 * moment in between where a section has no teacher AND no old assignment to
 * fall back to.
 */
export function SectionTeachersPanel({
  state,
  commit,
  classId,
  sectionId,
  className,
  sectionName,
}: {
  state: MastersState;
  commit: (next: MastersState, msg?: string) => void;
  classId: string;
  sectionId: string;
  className: string;
  sectionName: string;
}) {
  const session = useDemoSession();
  const ay = session.academicYearCode;

  const eligibleStaff = useMemo(
    () =>
      state.staff
        .filter((s) => s.status === "active" && s.stream === "teaching")
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [state.staff],
  );

  const currentClassTeacher = useMemo(() => {
    for (const s of state.staff) {
      const hit = s.classTeacherLinks.some(
        (l) =>
          l.classId === classId &&
          l.sectionId === sectionId &&
          l.academicYearCode === ay,
      );
      if (hit) return s;
    }
    return null;
  }, [state.staff, classId, sectionId, ay]);

  function setClassTeacher(staffId: string) {
    const next: MastersState = {
      ...state,
      staff: state.staff.map((s) => {
        const stripped = s.classTeacherLinks.filter(
          (l) =>
            !(
              l.classId === classId &&
              l.sectionId === sectionId &&
              l.academicYearCode === ay
            ),
        );
        if (s.id !== staffId) {
          return stripped.length === s.classTeacherLinks.length
            ? s
            : { ...s, classTeacherLinks: stripped };
        }
        const row: StaffClassTeacherLink = {
          id: newFoundationId("ctl"),
          classId,
          sectionId,
          academicYearCode: ay,
          isPrimary: true,
        };
        return { ...s, classTeacherLinks: [...stripped, row] };
      }),
    };
    commit(
      next,
      staffId
        ? `Class teacher set for ${className}-${sectionName}`
        : `Class teacher cleared for ${className}-${sectionName}`,
    );
  }

  const offerings = useMemo(
    () => offeringForClass(state, classId),
    [state, classId],
  );

  function subjectTeacherFor(subjectId: string) {
    for (const s of state.staff) {
      const hit = s.subjectTeachingLinks.some(
        (l) =>
          l.classId === classId &&
          l.subjectId === subjectId &&
          l.academicYearCode === ay &&
          (l.sectionId === sectionId || l.sectionId === null),
      );
      if (hit) return s;
    }
    return null;
  }

  function setSubjectTeacher(subjectId: string, staffId: string) {
    const matches = (l: StaffSubjectTeachingLink) =>
      l.classId === classId &&
      l.subjectId === subjectId &&
      l.academicYearCode === ay &&
      (l.sectionId === sectionId || l.sectionId === null);

    const next: MastersState = {
      ...state,
      staff: state.staff.map((s) => {
        const stripped = s.subjectTeachingLinks.filter((l) => !matches(l));
        if (s.id !== staffId) {
          return stripped.length === s.subjectTeachingLinks.length
            ? s
            : { ...s, subjectTeachingLinks: stripped };
        }
        const row: StaffSubjectTeachingLink = {
          id: newFoundationId("stl"),
          classId,
          sectionId,
          subjectId,
          academicYearCode: ay,
          periodsPerWeek: 0,
        };
        return { ...s, subjectTeachingLinks: [...stripped, row] };
      }),
    };
    const subjectName =
      state.subjects.find((sub) => sub.id === subjectId)?.nameEn ?? "Subject";
    commit(
      next,
      staffId
        ? `${subjectName} teacher set for ${className}-${sectionName}`
        : `${subjectName} teacher cleared for ${className}-${sectionName}`,
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Class teacher
        </p>
        <select
          className="field !py-1.5"
          value={currentClassTeacher?.id ?? ""}
          onChange={(e) => setClassTeacher(e.target.value)}
        >
          <option value="">— Unassigned —</option>
          {eligibleStaff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.fullName}
            </option>
          ))}
        </select>
        {eligibleStaff.length === 0 ? (
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            No active teaching staff yet — add one under Staff.
          </p>
        ) : null}
      </div>

      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Subject teachers
        </p>
        {offerings.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">
            No subjects offered to this class yet — set them up under
            Subjects.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {offerings.map((o) => {
              const current = subjectTeacherFor(o.subject.id);
              return (
                <li
                  key={o.subject.id}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="text-xs font-medium text-[var(--brand-deep)]">
                    {o.subject.code} — {o.subject.nameEn}
                  </span>
                  <select
                    className="field !py-1 text-xs"
                    value={current?.id ?? ""}
                    onChange={(e) =>
                      setSubjectTeacher(o.subject.id, e.target.value)
                    }
                  >
                    <option value="">— Unassigned —</option>
                    {eligibleStaff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName}
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
