"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState, type SisStudent } from "@/lib/sis";
import {
  SIBLING_REASON_LABELS,
  linkAsSiblings,
  listExistingSiblingGroups,
  listPossibleSiblingPairs,
  listRealSiblingGroups,
  type PossibleSiblingPair,
} from "@/lib/siblingMatching";
import { StudentNameLabel } from "@/components/students/StudentAvatar";

function classLabel(
  s: SisStudent,
  masters: MastersState,
): string {
  const cls = masters.classes.find((c) => c.id === s.classId)?.name ?? "—";
  const sec = masters.sections.find((x) => x.id === s.sectionId)?.name ?? "";
  return sec ? `${cls}-${sec}` : cls;
}

export function StudentSiblingsPanel({
  tick = 0,
  onChanged,
}: {
  tick?: number;
  onChanged?: (sis: SisState) => void;
}) {
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);

  function refresh() {
    setMasters(loadMasters());
    setSis(loadSis());
  }

  useEffect(() => {
    refresh();
  }, [tick]);

  const groups = useMemo(
    () => (sis ? listExistingSiblingGroups(sis) : []),
    [sis],
  );

  const possibles = useMemo(
    () => (sis ? listPossibleSiblingPairs(sis) : []),
    [sis],
  );

  const realGroups = useMemo(
    () => (sis ? listRealSiblingGroups(sis) : []),
    [sis],
  );

  const q = query.trim().toLowerCase();

  const filteredRealGroups = useMemo(() => {
    if (!q) return realGroups;
    return realGroups.filter((g) => {
      const blob = [
        g.fatherName,
        g.motherName,
        ...g.students.map((s) => `${s.fullName} ${s.admissionNo}`),
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [realGroups, q]);

  const filteredGroups = useMemo(() => {
    if (!q) return groups;
    return groups.filter((g) => {
      const hh = g.household;
      const blob = [
        hh?.guardianName,
        hh?.mobile,
        hh?.code,
        ...g.students.map((s) => `${s.fullName} ${s.admissionNo}`),
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [groups, q]);

  const filteredPossibles = useMemo(() => {
    if (!q) return possibles;
    return possibles.filter((p) => {
      const blob =
        `${p.a.fullName} ${p.a.admissionNo} ${p.b.fullName} ${p.b.admissionNo}`.toLowerCase();
      return blob.includes(q);
    });
  }, [possibles, q]);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3200);
  }

  function onLink(pair: PossibleSiblingPair, keepId: string, moveId: string) {
    const key = pair.id;
    setLinking(key);
    const res = linkAsSiblings(moveId, keepId);
    setLinking(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSis(res.state);
    onChanged?.(res.state);
    const keep = res.state.students.find((s) => s.id === keepId);
    const moved = res.state.students.find((s) => s.id === moveId);
    flash(
      `Linked ${moved?.fullName ?? "student"} → household of ${keep?.fullName ?? "sibling"}`,
    );
  }

  if (!sis || !masters) {
    return (
      <p className="mt-4 text-sm text-[var(--muted)]">Loading siblings…</p>
    );
  }

  return (
    <div className="mt-4 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--brand-deep)]">
            Siblings
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Existing links share one household. Possible siblings match on
            parent mobile, Aadhaar, or father + mother name — confirm before
            linking.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
          <span>
            <strong className="text-[var(--brand-deep)]">
              {groups.length}
            </strong>{" "}
            household{groups.length === 1 ? "" : "s"}
          </span>
          <span>
            <strong className="text-[var(--brand-deep)]">
              {realGroups.length}
            </strong>{" "}
            real {realGroups.length === 1 ? "family" : "families"}
          </span>
          <span>
            <strong className="text-[var(--brand-deep)]">
              {possibles.length}
            </strong>{" "}
            possible match{possibles.length === 1 ? "" : "es"}
          </span>
          <input
            className="field !max-w-[14rem] !py-1.5"
            placeholder="Search name / mobile…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {notice ? (
        <p className="rounded-lg bg-[rgba(67,160,71,0.12)] px-3 py-2 text-sm text-[#2e7d32]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <SiblingColumn
          title="Existing household"
          hint="Students already sharing one household."
          count={filteredGroups.length}
          empty={!filteredGroups.length}
          emptyText="No linked household groups yet."
        >
          {filteredGroups.map((g) => (
            <ExpandRow
              key={g.householdId}
              title={g.household?.guardianName || "Household"}
              subtitle={[g.household?.code, g.household?.mobile]
                .filter(Boolean)
                .join(" · ")}
              count={g.students.length}
              countLabel="students"
              tone="navy"
            >
              <StudentMiniList
                students={g.students}
                sis={sis}
                masters={masters}
              />
            </ExpandRow>
          ))}
        </SiblingColumn>

        <SiblingColumn
          title="Real siblings"
          hint="Same father & mother — even across households."
          count={filteredRealGroups.length}
          empty={!filteredRealGroups.length}
          emptyText="No families sharing the same father & mother name yet."
        >
          {filteredRealGroups.map((g) => (
            <ExpandRow
              key={g.key}
              title={`${g.fatherName} & ${g.motherName}`}
              subtitle="same parents"
              count={g.students.length}
              countLabel="children"
              tone="teal"
            >
              <StudentMiniList
                students={g.students}
                sis={sis}
                masters={masters}
                showSession
              />
            </ExpandRow>
          ))}
        </SiblingColumn>

        <SiblingColumn
          title="Possible siblings"
          hint="Not yet linked. Expand to confirm and link."
          count={filteredPossibles.length}
          empty={!filteredPossibles.length}
          emptyText="No possible matches from parent mobile / name signals."
        >
          {filteredPossibles.map((p) => (
            <ExpandRow
              key={p.id}
              title={p.a.fatherName || p.b.fatherName || "Possible match"}
              subtitle={p.reasons
                .map((r) => SIBLING_REASON_LABELS[r])
                .join(" · ")}
              count={2}
              countLabel={`score ${p.score}`}
              tone="amber"
            >
              <div className="grid gap-2">
                {[p.a, p.b].map((s) => (
                  <div
                    key={s.id}
                    className="rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
                  >
                    <div className="font-medium text-[var(--brand-deep)]">
                      <StudentNameLabel student={s} sis={sis} />
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                      {s.admissionNo} · {classLabel(s, masters)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                      {s.fatherName ? `F: ${s.fatherName}` : "F: —"}
                      {s.fatherMobile ? ` · ${s.fatherMobile}` : ""}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                      {s.motherName ? `M: ${s.motherName}` : "M: —"}
                      {s.motherMobile ? ` · ${s.motherMobile}` : ""}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={linking === p.id}
                  className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  onClick={() => onLink(p, p.a.id, p.b.id)}
                >
                  Link → keep {p.a.fullName.split(" ")[0]}’s household
                </button>
                <button
                  type="button"
                  disabled={linking === p.id}
                  className="rounded-lg border border-[rgba(32,48,80,0.2)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-50"
                  onClick={() => onLink(p, p.b.id, p.a.id)}
                >
                  Link → keep {p.b.fullName.split(" ")[0]}’s household
                </button>
              </div>
            </ExpandRow>
          ))}
        </SiblingColumn>
      </div>
    </div>
  );
}

const COLUMN_TONE = {
  navy: "border-[rgba(32,48,80,0.14)]",
  teal: "border-[rgba(15,118,110,0.28)] bg-[rgba(15,118,110,0.04)]",
  amber: "border-[rgba(196,149,58,0.35)] bg-[rgba(196,149,58,0.05)]",
} as const;

const COUNT_TONE = {
  navy: "bg-[rgba(32,48,80,0.1)] text-[var(--brand-deep)]",
  teal: "bg-[rgba(15,118,110,0.16)] text-[#0f766e]",
  amber: "bg-[rgba(196,149,58,0.2)] text-[var(--brand-gold)]",
} as const;

function SiblingColumn({
  title,
  hint,
  count,
  empty,
  emptyText,
  children,
}: {
  title: string;
  hint: string;
  count: number;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.02)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
          {title}
        </h3>
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-[var(--brand-deep)] shadow-sm">
          {count}
        </span>
      </div>
      <p className="mb-3 text-[11px] text-[var(--muted)]">{hint}</p>
      {empty ? (
        <p className="rounded-lg border border-dashed border-[rgba(32,48,80,0.15)] bg-white px-3 py-6 text-center text-xs text-[var(--muted)]">
          {emptyText}
        </p>
      ) : (
        <ul className="space-y-2">{children}</ul>
      )}
    </section>
  );
}

function ExpandRow({
  title,
  subtitle,
  count,
  countLabel,
  tone,
  children,
}: {
  title: string;
  subtitle?: string;
  count: number;
  countLabel?: string;
  tone: keyof typeof COLUMN_TONE;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`rounded-xl border bg-white ${COLUMN_TONE[tone]}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span
          className={`shrink-0 text-[10px] text-[var(--muted)] transition-transform ${
            open ? "rotate-90" : ""
          }`}
          aria-hidden
        >
          ▶
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[var(--brand-deep)]">
            {title}
          </span>
          {subtitle ? (
            <span className="block truncate text-[11px] text-[var(--muted)]">
              {subtitle}
            </span>
          ) : null}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${COUNT_TONE[tone]}`}
        >
          {count}
          {countLabel ? ` ${countLabel}` : ""}
        </span>
      </button>
      {open ? (
        <div className="border-t border-[rgba(32,48,80,0.08)] px-3 py-2.5">
          {children}
        </div>
      ) : null}
    </li>
  );
}

function StudentMiniList({
  students,
  sis,
  masters,
  showSession,
}: {
  students: SisStudent[];
  sis: SisState;
  masters: MastersState;
  showSession?: boolean;
}) {
  return (
    <ul className="divide-y divide-[rgba(32,48,80,0.06)] rounded-lg border border-[rgba(32,48,80,0.08)]">
      {students.map((s) => (
        <li
          key={s.id}
          className="flex items-center justify-between gap-2 px-3 py-2"
        >
          <div className="min-w-0">
            <div className="font-medium text-[var(--brand-deep)]">
              <StudentNameLabel student={s} sis={sis} />
              {s.status !== "active" ? (
                <span className="ml-2 text-[10px] text-[var(--muted)]">
                  inactive
                </span>
              ) : null}
            </div>
            <div className="text-[11px] text-[var(--muted)]">
              {s.admissionNo} · {classLabel(s, masters)}
              {showSession && s.academicYearCode
                ? ` · ${s.academicYearCode}`
                : ""}
            </div>
          </div>
          <Link
            href={`/students/${s.id}/edit`}
            className="shrink-0 text-xs font-medium text-[var(--brand-mid)]"
          >
            Edit
          </Link>
        </li>
      ))}
    </ul>
  );
}
