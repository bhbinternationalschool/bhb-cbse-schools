"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Bus } from "lucide-react";
import { loadTransport } from "@/lib/transport";
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
/* ─── Transport rider marker ───────────────────────────────── */

/**
 * Which students currently ride a bus — cached for 30s because this label
 * renders in rosters hundreds of rows long and loadTransport() is a full
 * localStorage parse. Client-only by construction: the server render shows
 * no icon and the first client pass adds it after mount, which is why the
 * component gates on useSyncExternalStore below instead of reading here
 * during hydration.
 */
const riderCache: { at: number; ids: Set<string> } = { at: 0, ids: new Set() };

function activeTransportRiders(): Set<string> {
  if (typeof window === "undefined") return riderCache.ids;
  // An empty snapshot is usually "built before transport hydrated", not
  // "no riders" — retry quickly until something arrives, then settle to 30s.
  const ttl = riderCache.ids.size > 0 ? 30_000 : 3_000;
  if (Date.now() - riderCache.at > ttl) {
    try {
      const t = loadTransport();
      const today = new Date().toISOString().slice(0, 10);
      riderCache.ids = new Set(
        t.assignments
          .filter((a) => !a.effectiveTo || a.effectiveTo >= today)
          .map((a) => a.studentId),
      );
    } catch {
      // Keep whatever we had; an icon is never worth breaking a roster.
    }
    riderCache.at = Date.now();
  }
  return riderCache.ids;
}

const subscribeNoop = () => () => {};

export function StudentNameLabel({
  student,
  sis,
  className,
  children,
}: {
  student: Pick<SisStudent, "fullName" | "studentType"> &
    Partial<
      Pick<SisStudent, "id" | "tagIds" | "udiseInboundTransferPending" | "pen">
    >;
  sis?: SisState;
  className?: string;
  /** Extra content after the name (status chips, etc.) */
  children?: ReactNode;
}) {
  // false on the server and on the hydration pass, true after mount — so the
  // transport marker can come from localStorage without a hydration mismatch.
  const isClient = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const ridesTransport =
    isClient && student.id ? activeTransportRiders().has(student.id) : false;
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
      {ridesTransport ? (
        <span
          title="Transport assigned"
          className="mr-1 inline-flex align-middle text-[#b8860b]"
        >
          <Bus className="size-3" aria-label="Transport assigned" />
        </span>
      ) : null}
      {student.fullName}
      {children}
    </span>
  );
}
