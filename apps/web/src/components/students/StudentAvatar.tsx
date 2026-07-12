"use client";

import type { FeeStudentType } from "@/lib/masters";
import {
  avatarTone,
  studentInitials,
  studentTypeShort,
  type SisStudent,
} from "@/lib/sis";

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
