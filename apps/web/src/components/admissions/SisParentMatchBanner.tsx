"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  SIS_PARENT_MATCH_LABELS,
  suggestSisFamiliesByParent,
  type SisParentMatch,
} from "@/lib/admissions";
import { loadMasters } from "@/lib/masters";

export function SisParentMatchBanner({
  guardianName,
  motherName,
  mobile,
  className,
}: {
  guardianName?: string;
  motherName?: string;
  mobile?: string;
  className?: string;
}) {
  const matches = useMemo(
    () =>
      suggestSisFamiliesByParent({
        guardianName,
        motherName,
        mobile,
        limit: 4,
      }),
    [guardianName, motherName, mobile],
  );

  if (matches.length === 0) return null;

  return (
    <div
      className={
        className ||
        "rounded-xl border border-[rgba(15,118,110,0.35)] bg-[rgba(15,118,110,0.08)] px-3 py-2.5 text-[12px] text-[var(--brand-deep)]"
      }
    >
      <p className="font-semibold text-[#0f766e]">
        SIS suggestion — parent already in Students
      </p>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">
        Matched by parent name / mobile. Consider linking as sibling on send to
        student record (same parent household).
      </p>
      <ul className="mt-2 space-y-2">
        {matches.map((m) => (
          <SisMatchRow key={m.householdId} match={m} />
        ))}
      </ul>
    </div>
  );
}

function SisMatchRow({ match }: { match: SisParentMatch }) {
  const masters = useMemo(() => loadMasters(), []);
  const classNameOf = (id: string) =>
    masters.classes.find((c) => c.id === id)?.name || "—";

  return (
    <li className="rounded-lg border border-[rgba(32,48,80,0.1)] bg-white px-2.5 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">
          {match.guardianName || "Parent"} · {match.mobile || "—"}
        </span>
        <span className="font-mono text-[10px] text-[var(--muted)]">
          {match.householdCode}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {match.reasons.map((r) => (
          <span
            key={r}
            className="rounded-full bg-[rgba(15,118,110,0.12)] px-1.5 py-0.5 text-[9px] font-semibold text-[#0f766e]"
          >
            {SIS_PARENT_MATCH_LABELS[r]}
          </span>
        ))}
      </div>
      <ul className="mt-1.5 space-y-0.5 text-[11px] text-[var(--muted)]">
        {match.students.map((s) => (
          <li key={s.id}>
            <Link
              href={`/students/${s.id}/edit`}
              className="font-medium text-[var(--brand-deep)] underline-offset-2 hover:underline"
            >
              {s.fullName}
            </Link>
            {" · "}
            {s.admissionNo}
            {s.srn ? ` · ${s.srn}` : ""}
            {" · "}
            {classNameOf(s.classId)}
          </li>
        ))}
      </ul>
    </li>
  );
}
