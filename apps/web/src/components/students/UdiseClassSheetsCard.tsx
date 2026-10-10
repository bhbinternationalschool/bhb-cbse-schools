"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { MastersState } from "@/lib/masters";
import { normalizeBloodGroup, studentsInSession, type SisState, type SisStudent } from "@/lib/sis";

type Gap = { label: string; missing: (s: SisStudent) => boolean };

/** The UDISE+ details the class sheet collects (lib/classDetailsSheet). */
const GAPS: Gap[] = [
  { label: "Height", missing: (s) => !(s.heightCm || "").trim() },
  { label: "Weight", missing: (s) => !(s.weightKg || "").trim() },
  { label: "Blood group", missing: (s) => !normalizeBloodGroup(s.bloodGroup || "") },
  { label: "Mother tongue", missing: (s) => !(s.motherTongue || "").trim() },
  { label: "Religion", missing: (s) => !(s.religion || "").trim() },
  { label: "Category", missing: (s) => !(s.category || "").trim() },
  { label: "Father's education", missing: (s) => !(s.fatherQualification || "").trim() },
  { label: "Mother's education", missing: (s) => !(s.motherQualification || "").trim() },
];

/**
 * Students → UDISE+ → step 3: what the class sheets still have to collect,
 * class by class, and the way in. The sheet itself is My class → Class sheet
 * (UDISE+): class teachers fill their own class from the phone; the office
 * picks any class. The UDISE robot fills the portal from these.
 */
export function UdiseClassSheetsCard({ sis, masters, academicYearCode }: { sis: SisState; masters: MastersState; academicYearCode: string }) {
  const { kids, byClass } = useMemo(() => {
    const kids = studentsInSession(sis, academicYearCode).filter((s) => s.status === "active");
    const rows = new Map<string, { label: string; order: number; total: number; done: number }>();
    for (const s of kids) {
      const cls = masters.classes.find((c) => c.id === s.classId);
      const sec = masters.sections.find((x) => x.id === s.sectionId);
      const key = `${s.classId}:${s.sectionId}`;
      const r = rows.get(key) ?? {
        label: [cls?.name, sec?.name].filter(Boolean).join(" ") || "Class not set",
        order: masters.classes.findIndex((c) => c.id === s.classId),
        total: 0,
        done: 0,
      };
      r.total += 1;
      if (!GAPS.some((g) => g.missing(s))) r.done += 1;
      rows.set(key, r);
    }
    return { kids, byClass: [...rows.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)) };
  }, [sis, masters, academicYearCode]);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" aria-label="UDISE class sheets">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Class sheets — details only the class can collect</h3>
        <Link href="/my-class" className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold">
          Fill class sheets →
        </Link>
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">
        UDISE+ asks every child&apos;s measured height and weight, blood group, mother tongue, religion, category and both
        parents&apos; education. Class teachers fill their own class from the phone (Home → My class records → Class sheet
        (UDISE+)); the office can open any class here. Height and weight are measured — never estimated.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {GAPS.map((g) => {
          const n = kids.filter(g.missing).length;
          return (
            <div key={g.label} className="rounded-lg border border-[var(--border)] px-3 py-2">
              <p className={`text-lg font-bold ${n ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>{n}</p>
              <p className="text-[11px] text-[var(--muted)]">{g.label} missing</p>
            </div>
          );
        })}
      </div>
      {byClass.length ? (
        <ul className="mt-3 grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {byClass.map((c) => (
            <li key={c.label} className="flex items-center justify-between rounded-lg bg-[var(--surface-sunken)] px-3 py-1.5">
              <span className="font-semibold text-[var(--brand-deep)]">{c.label}</span>
              <span className={c.done === c.total ? "text-[var(--success)]" : "text-[var(--muted)]"}>
                {c.done} of {c.total} complete
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
