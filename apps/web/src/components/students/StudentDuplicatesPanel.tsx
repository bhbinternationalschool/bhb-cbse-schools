"use client";

import { recordAudit } from "@/lib/auditClient";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  currentAcademicYearCode,
  loadMasters,
  type MastersState,
} from "@/lib/masters";
import {
  countDocsWithFiles,
  householdOf,
  loadSis,
  type SisState,
  type SisStudent,
} from "@/lib/sis";
import {
  DUPLICATE_REASON_LABEL,
  listSuspectedDuplicates,
  mergeStudents,
  removeDuplicateStudents,
  type DuplicateGroup,
} from "@/lib/studentDuplicates";
import { StudentAvatar } from "@/components/students/StudentAvatar";
import { useDemoSession } from "@/components/shell/SessionContext";

export function StudentDuplicatesPanel({
  tick = 0,
  onChanged,
}: {
  tick?: number;
  onChanged?: (sis: SisState, message?: string) => void;
}) {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [allSessions, setAllSessions] = useState(false);
  const [keepByGroup, setKeepByGroup] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    setMasters(loadMasters());
    setSis(loadSis());
  }

  useEffect(() => {
    refresh();
  }, [tick]);

  const ay =
    session.academicYearCode ||
    (masters ? currentAcademicYearCode(masters) : "");

  const groups = useMemo(() => {
    if (!sis) return [] as DuplicateGroup[];
    return listSuspectedDuplicates(sis, {
      academicYearCode: allSessions ? "all" : ay,
    });
  }, [sis, allSessions, ay]);

  function classSectionOf(s: SisStudent): string {
    if (!masters) return "—";
    const cls = masters.classes.find((c) => c.id === s.classId)?.name ?? "—";
    const sec = masters.sections.find((x) => x.id === s.sectionId)?.name;
    return sec ? `${cls}-${sec}` : cls;
  }

  function defaultKeep(g: DuplicateGroup): string {
    const ranked = [...g.students].sort((a, b) => {
      const act = (a.status === "active" ? 1 : 0) - (b.status === "active" ? 1 : 0);
      if (act) return -act;
      const docs = countDocsWithFiles(b.docs) - countDocsWithFiles(a.docs);
      if (docs) return docs;
      return (b.fullName?.length || 0) - (a.fullName?.length || 0);
    });
    return ranked[0]?.id ?? g.students[0]?.id ?? "";
  }

  function keptId(g: DuplicateGroup): string {
    return keepByGroup[g.key] || defaultKeep(g);
  }

  function flash(msg: string, next: SisState) {
    setSis(next);
    setNotice(msg);
    setError(null);
    onChanged?.(next, msg);
    window.setTimeout(() => setNotice(null), 3000);
  }

  function onMerge(g: DuplicateGroup) {
    if (!sis) return;
    const keep = keptId(g);
    const dropIds = g.students.map((s) => s.id).filter((id) => id !== keep);
    const res = mergeStudents(sis, keep, dropIds);
    if (!res.ok) {
      setError(res.reason);
      return;
    }
    const keeper = g.students.find((s) => s.id === keep);
    recordAudit({
      module: "students",
      action: "merge",
      entityType: "student",
      entityId: keep,
      summary: `Merged ${res.merged} duplicate record(s) into ${keeper?.fullName ?? "student"} (${keeper?.admissionNo ?? keep}) — matched on ${g.reasons.join(", ")}`,
      before: {
        droppedIds: dropIds,
        dropped: g.students
          .filter((s) => s.id !== keep)
          .map((s) => ({
            id: s.id,
            fullName: s.fullName,
            admissionNo: s.admissionNo,
          })),
        matchReasons: g.reasons,
        score: g.score,
      },
      after: { keptId: keep, keptAdmissionNo: keeper?.admissionNo },
    });
    flash(
      `Merged ${res.merged} record${res.merged === 1 ? "" : "s"} into ${
        keeper?.fullName ?? "student"
      }.`,
      res.state,
    );
  }

  function onRemove(g: DuplicateGroup, s: SisStudent) {
    if (!sis) return;
    if (
      !window.confirm(
        `Remove duplicate “${s.fullName}” (${s.admissionNo})? This deletes the record and cannot be undone.`,
      )
    )
      return;
    const next = removeDuplicateStudents(sis, [s.id]);
    recordAudit({
      module: "students",
      action: "delete",
      entityType: "student",
      entityId: s.id,
      summary: `Removed duplicate ${s.fullName} (${s.admissionNo}) — matched on ${g.reasons.join(", ")}`,
      before: {
        fullName: s.fullName,
        admissionNo: s.admissionNo,
        academicYearCode: s.academicYearCode,
        matchReasons: g.reasons,
      },
    });
    flash(`Removed duplicate ${s.fullName}.`, next);
  }

  if (!sis || !masters) {
    return (
      <div className="mt-4 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white px-4 py-8 text-center text-sm text-[var(--muted)]">
        Loading…
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--brand-deep)]">
            Suspected duplicates
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Matched within a session by admission no, PEN, APAAR, Aadhaar, or
            name + DOB / father. Pick the record to keep, then merge or remove
            the rest.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-[var(--brand-deep)]">
          <input
            type="checkbox"
            checked={allSessions}
            onChange={(e) => setAllSessions(e.target.checked)}
          />
          Scan all sessions
        </label>
      </div>

      {notice ? (
        <div className="rounded-lg bg-[rgba(15,118,110,0.12)] px-3 py-2 text-sm font-medium text-[#0f766e]">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-lg bg-[rgba(192,57,43,0.1)] px-3 py-2 text-sm font-medium text-[#c0392b]">
          {error}
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[rgba(32,48,80,0.2)] bg-[rgba(15,118,110,0.04)] px-4 py-10 text-center text-sm text-[var(--muted)]">
          No suspected duplicates found
          {allSessions ? " across all sessions" : ` in ${ay || "this session"}`}.
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-[var(--muted)]">
            {groups.length} suspected duplicate group
            {groups.length === 1 ? "" : "s"} ·{" "}
            {groups.reduce((n, g) => n + g.students.length, 0)} records
          </p>
          {groups.map((g) => {
            const keep = keptId(g);
            return (
              <div
                key={g.key}
                className="rounded-xl border border-[rgba(192,57,43,0.25)] bg-white"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(32,48,80,0.08)] px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                        g.score >= 90
                          ? "bg-[rgba(192,57,43,0.14)] text-[#c0392b]"
                          : "bg-[rgba(196,149,58,0.16)] text-[var(--brand-gold)]"
                      }`}
                    >
                      {g.score}% match
                    </span>
                    {g.reasons.map((r) => (
                      <span
                        key={r}
                        className="rounded-md bg-[rgba(32,48,80,0.06)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]"
                      >
                        {DUPLICATE_REASON_LABEL[r]}
                      </span>
                    ))}
                    <span className="text-[11px] text-[var(--muted)]">
                      · {g.session}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onMerge(g)}
                    className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Merge others into selected
                  </button>
                </div>

                <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
                  {g.students.map((s) => {
                    const hh = householdOf(sis, s.householdId);
                    const isKeep = s.id === keep;
                    return (
                      <li
                        key={s.id}
                        className={`flex flex-wrap items-center gap-3 px-4 py-3 ${
                          isKeep ? "bg-[rgba(15,118,110,0.06)]" : ""
                        }`}
                      >
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`keep-${g.key}`}
                            checked={isKeep}
                            onChange={() =>
                              setKeepByGroup((prev) => ({
                                ...prev,
                                [g.key]: s.id,
                              }))
                            }
                            aria-label={`Keep ${s.fullName}`}
                          />
                          <StudentAvatar student={s} size={38} />
                        </label>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[var(--brand-deep)]">
                              {s.fullName}
                            </span>
                            {isKeep ? (
                              <span className="rounded bg-[rgba(15,118,110,0.14)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#0f766e]">
                                Keep
                              </span>
                            ) : null}
                            {s.status !== "active" ? (
                              <span className="text-[11px] text-[var(--muted)]">
                                inactive
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--muted)]">
                            {s.admissionNo} · {classSectionOf(s)}
                            {s.rollNo ? ` · Roll ${s.rollNo}` : ""}
                          </div>
                          <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                            {s.dob ? `DOB ${s.dob}` : "DOB —"}
                            {s.fatherName ? ` · F: ${s.fatherName}` : ""}
                            {s.pen ? ` · PEN ${s.pen}` : ""}
                            {` · ${countDocsWithFiles(s.docs)}/7 docs`}
                            {hh?.mobile ? ` · ${hh.mobile}` : ""}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <Link
                            href={`/students/${s.id}/edit`}
                            className="text-xs font-medium text-[var(--brand-mid)]"
                          >
                            Open
                          </Link>
                          <button
                            type="button"
                            onClick={() => onRemove(g, s)}
                            className="text-xs font-medium text-[#c0392b]"
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
