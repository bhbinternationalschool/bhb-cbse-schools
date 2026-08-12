"use client";

import { useEffect, useMemo, useState } from "react";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, saveSis, type SisState, type SisStudent } from "@/lib/sis";
import { fetchSisDeskFromApi } from "@/lib/sisNormalizedClient";
import { useDemoSession } from "@/components/shell/SessionContext";
import { StudentNameLabel } from "@/components/students/StudentAvatar";

/**
 * Promote a class/section to the next academic year.
 *
 * Phase 4 of the identity/enrollment split built the underlying capability
 * (sis_promote_enrollment) but deliberately left the UI for a separate
 * decision — this is that decision, built as a dual-write: promoting
 * updates the live sis_students row (visible everywhere immediately,
 * through the same guarded save path every other student edit uses) and
 * separately records the move in sis_student_identities/sis_enrollments,
 * so the audit trail stays current for Phase 5's eventual cutover.
 *
 * See docs/SIS_IDENTITY_ENROLLMENT_SPLIT_PLAN.md and
 * lib/sisPromotion.server.ts for the write-path detail.
 *
 * This writes to the database directly, server-side, bypassing the
 * client's normal commit()/saveSis() flow — so the local cache goes stale
 * the moment a promotion succeeds. Refreshed explicitly afterward via
 * fetchSisDeskFromApi() + saveSis(), not left to a background sync to
 * eventually catch up.
 */
export function StudentPromotionPanel({
  tick = 0,
  onChanged,
}: {
  tick?: number;
  onChanged?: (sis: SisState) => void;
}) {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);

  const [fromClassId, setFromClassId] = useState("");
  const [fromSectionId, setFromSectionId] = useState("");
  const [toAcademicYearCode, setToAcademicYearCode] = useState("");
  const [toClassId, setToClassId] = useState("");
  const [toSectionId, setToSectionId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<
    { studentId: string; name: string; stage: string; error: string }[]
  >([]);

  function refresh() {
    setMasters(loadMasters());
    setSis(loadSis());
  }

  useEffect(() => {
    refresh();
  }, [tick]);

  useEffect(() => {
    if (!masters) return;
    const upcoming = masters.academicYears.find((y) => y.status === "upcoming");
    if (upcoming && !toAcademicYearCode) setToAcademicYearCode(upcoming.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masters]);

  const fromSections = useMemo(() => {
    if (!masters || !fromClassId) return [];
    return masters.sections
      .filter((s) => s.classId === fromClassId && s.isActive)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [masters, fromClassId]);

  const toSections = useMemo(() => {
    if (!masters || !toClassId) return [];
    return masters.sections
      .filter((s) => s.classId === toClassId && s.isActive)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [masters, toClassId]);

  const eligible = useMemo(() => {
    if (!sis || !fromClassId || !fromSectionId) return [] as SisStudent[];
    return sis.students
      .filter(
        (s) =>
          s.status === "active" &&
          s.classId === fromClassId &&
          s.sectionId === fromSectionId &&
          (!session.academicYearCode ||
            s.academicYearCode === session.academicYearCode),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [sis, fromClassId, fromSectionId, session.academicYearCode]);

  useEffect(() => {
    setSelected(new Set(eligible.map((s) => s.id)));
  }, [eligible]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const readyToPromote =
    !!fromClassId &&
    !!fromSectionId &&
    !!toAcademicYearCode &&
    !!toClassId &&
    !!toSectionId &&
    selected.size > 0 &&
    !(fromClassId === toClassId && fromSectionId === toSectionId) &&
    !busy;

  async function promote() {
    if (!readyToPromote) return;
    const fromLabel = classSectionLabel(fromClassId, fromSectionId, masters);
    const toLabel = classSectionLabel(toClassId, toSectionId, masters);
    const ok = window.confirm(
      `Promote ${selected.size} student(s) from ${fromLabel} to ${toLabel} (${toAcademicYearCode})?\n\n` +
        "Each student's live record updates immediately, roll number resets, and this year's enrollment is closed out in the history. This cannot be undone from this screen.",
    );
    if (!ok) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    setFailures([]);
    try {
      const res = await fetch("/api/school-data/sis-promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentIds: Array.from(selected),
          toAcademicYearCode,
          toClassId,
          toSectionId,
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        succeeded?: number;
        failed?: number;
        error?: string;
        results?: {
          ok: boolean;
          studentId: string;
          stage?: string;
          error?: string;
        }[];
      };

      if (!res.ok && !body.results) {
        setError(body.error || `Promotion failed (${res.status})`);
        return;
      }

      const nameById = new Map(eligible.map((s) => [s.id, s.fullName]));
      const bad = (body.results ?? []).filter((r) => !r.ok);
      setFailures(
        bad.map((r) => ({
          studentId: r.studentId,
          name: nameById.get(r.studentId) ?? r.studentId,
          stage: r.stage ?? "",
          error: r.error ?? "Unknown error",
        })),
      );

      const succeeded = body.succeeded ?? 0;
      if (succeeded > 0) {
        setNotice(
          `${succeeded} promoted to ${toLabel} (${toAcademicYearCode})` +
            (bad.length > 0 ? ` — ${bad.length} failed, see below` : ""),
        );
        // Server-side writes bypassed the normal commit()/saveSis() flow —
        // local cache is stale now. Pull the fresh state and persist it,
        // rather than wait for a background sync to notice.
        const remote = await fetchSisDeskFromApi();
        if (remote) {
          const current = loadSis();
          const next: SisState = {
            ...current,
            households: remote.bundle.households,
            students: remote.bundle.students,
          };
          saveSis(next);
          setSis(next);
          onChanged?.(next);
        }
      } else if (bad.length > 0) {
        setError(`All ${bad.length} promotion(s) failed — see details below`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Promotion request failed");
    } finally {
      setBusy(false);
    }
  }

  if (!masters || !sis) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[rgba(196,149,58,0.3)] bg-[rgba(196,149,58,0.06)] p-3">
        <p className="text-sm font-bold text-[var(--brand-deep)]">
          Promote to next year
        </p>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          Different from the class change above — this moves a class/section
          into a new academic year. Roll numbers reset in the new class;
          re-assign them afterward from the Overview tab.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            From ({session.academicYearCode || "current session"})
          </p>
          <div className="flex gap-2">
            <select
              className="field !py-1.5"
              value={fromClassId}
              onChange={(e) => {
                setFromClassId(e.target.value);
                setFromSectionId("");
              }}
            >
              <option value="">Class…</option>
              {masters.classes
                .filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <select
              className="field !py-1.5"
              value={fromSectionId}
              onChange={(e) => setFromSectionId(e.target.value)}
              disabled={!fromClassId}
            >
              <option value="">Section…</option>
              {fromSections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            To
          </p>
          <div className="flex flex-wrap gap-2">
            <select
              className="field !py-1.5"
              value={toAcademicYearCode}
              onChange={(e) => setToAcademicYearCode(e.target.value)}
            >
              <option value="">Year…</option>
              {masters.academicYears.map((y) => (
                <option key={y.id} value={y.code}>
                  {y.code}
                </option>
              ))}
            </select>
            <select
              className="field !py-1.5"
              value={toClassId}
              onChange={(e) => {
                setToClassId(e.target.value);
                setToSectionId("");
              }}
            >
              <option value="">Class…</option>
              {masters.classes
                .filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <select
              className="field !py-1.5"
              value={toSectionId}
              onChange={(e) => setToSectionId(e.target.value)}
              disabled={!toClassId}
            >
              <option value="">Section…</option>
              {toSections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {fromClassId && fromSectionId ? (
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)]">
          <div className="flex items-center justify-between border-b border-[rgba(32,48,80,0.08)] bg-[rgba(32,48,80,0.03)] px-3 py-2">
            <p className="text-xs font-bold text-[var(--brand-deep)]">
              {eligible.length} active student(s) · {selected.size} selected
            </p>
            <div className="flex gap-3 text-[11px] font-semibold text-[var(--brand-mid)]">
              <button
                type="button"
                onClick={() => setSelected(new Set(eligible.map((s) => s.id)))}
              >
                Select all
              </button>
              <button type="button" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          </div>
          <ul className="max-h-64 divide-y divide-[rgba(32,48,80,0.06)] overflow-y-auto">
            {eligible.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 px-3 py-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                />
                <StudentNameLabel student={s} />
                <span className="text-[11px] text-[var(--muted)]">
                  {s.admissionNo}
                </span>
              </li>
            ))}
            {eligible.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-[var(--muted)]">
                No active students in this class/section for the current
                session
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        className="btn-accent rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
        onClick={promote}
        disabled={!readyToPromote}
      >
        {busy ? "Promoting…" : `Promote ${selected.size || ""} student(s)`}
      </button>

      {notice ? (
        <p className="rounded-lg bg-[rgba(15,118,110,0.1)] px-3 py-2 text-sm text-[#0f766e]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-[rgba(180,60,60,0.1)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {failures.length > 0 ? (
        <div className="rounded-lg bg-[rgba(180,60,60,0.06)] px-3 py-2 text-xs text-[var(--danger)]">
          <p className="font-semibold">Failed:</p>
          <ul className="mt-1 list-disc pl-4">
            {failures.map((f) => (
              <li key={f.studentId}>
                {f.name} — {f.error}
                {f.stage === "live-record"
                  ? " (recorded, but not yet visible — retry this student, do not promote again)"
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function classSectionLabel(
  classId: string,
  sectionId: string,
  masters: MastersState | null,
): string {
  if (!masters) return "—";
  const cls = masters.classes.find((c) => c.id === classId)?.name ?? "—";
  const sec = masters.sections.find((s) => s.id === sectionId)?.name ?? "";
  return sec ? `${cls}-${sec}` : cls;
}
