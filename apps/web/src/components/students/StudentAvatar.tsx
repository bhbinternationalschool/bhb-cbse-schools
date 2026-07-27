"use client";

import type { ReactNode } from "react";
import type { FeeStudentType } from "@/lib/masters";
import {
  avatarTone,
  studentInitials,
  studentTypeShort,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import { tagsForStudent } from "@/lib/studentTags";

/** Photo if set, otherwise initials avatar. */
export function StudentAvatar({
  student,
  size = 40,
}: {
  student: Pick<SisStudent, "fullName" | "photoUrl">;
  size?: number;
}) {
  const initials = studentInitials(student.fullName);
  const bg = avatarTone(student.fullName);

  if (student.photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={student.photoUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover ring-2 ring-white"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-white"
      style={{
        width: size,
        height: size,
        background: bg,
        fontSize: size < 36 ? 10 : 12,
      }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/** N / P / M / R badge shown before the student name. */
export function StudentTypeBadge({
  type,
}: {
  type: FeeStudentType;
}) {
  const { code, label } = studentTypeShort(type);
  const tones: Record<string, string> = {
    N: "bg-[rgba(32,48,80,0.12)] text-[var(--brand-deep)]",
    P: "bg-[rgba(197,160,40,0.22)] text-[var(--brand-deep)]",
    M: "bg-[rgba(32,48,80,0.08)] text-[var(--brand-mid)]",
    R: "bg-[rgba(180,35,24,0.12)] text-[var(--danger)]",
  };
  return (
    <span
      className={`mr-1.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded px-1 text-[10px] font-bold tracking-wide ${
        tones[code] ?? tones.N
      }`}
      title={label}
    >
      {code}
    </span>
  );
}

/** Custom tags (STAFF, SPORT, …) shown before the student name. */
export function StudentTagsBadge({
  student,
  sis,
}: {
  student: Pick<SisStudent, "tagIds">;
  sis?: SisState;
}) {
  const tags = tagsForStudent(student, sis);
  if (!tags.length) return null;
  return (
    <>
      {tags.map((t) => (
        <span
          key={t.id}
          className="mr-1 inline-flex h-5 max-w-[4.5rem] items-center truncate rounded px-1 text-[9px] font-bold uppercase tracking-wide text-white"
          style={{ background: t.color }}
          title={t.name}
        >
          {t.code}
        </span>
      ))}
    </>
  );
}

/**
 * Type badge + tags + name — use everywhere a student is listed.
 */
export function StudentNameLabel({
  student,
  sis,
  className,
  children,
}: {
  student: Pick<SisStudent, "fullName" | "studentType"> &
    Partial<Pick<SisStudent, "tagIds" | "udiseInboundTransferPending" | "pen">>;
  sis?: SisState;
  className?: string;
  /** Extra content after the name (status chips, etc.) */
  children?: ReactNode;
}) {
  return (
    <span className={className}>
      <StudentTypeBadge type={student.studentType} />
      <StudentTagsBadge
        student={{ tagIds: student.tagIds ?? [] }}
        sis={sis}
      />
      {student.udiseInboundTransferPending ? (
        <span
          className="mr-1.5 inline-flex items-center rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-[rgba(138,90,16,0.18)] text-[#8a5a10]"
          title="Import from UDISE+ Drop Box or ask previous school to release on portal"
        >
          Drop Box
        </span>
      ) : null}
      {student.fullName}
      {children}
    </span>
  );
}
