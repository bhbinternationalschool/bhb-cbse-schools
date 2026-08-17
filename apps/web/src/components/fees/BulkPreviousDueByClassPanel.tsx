"use client";

import { useEffect, useMemo, useState } from "react";
import { rosterForSection } from "@/lib/attendance";
import {
  applyBulkPreviousDues,
} from "@/lib/previousDuesExcelImport";
import { loadFees, previousAcademicYearCode, saveFees } from "@/lib/fees";
import { loadMasters, listSessionYearOptions, type MastersState } from "@/lib/masters";
import { loadSis, type SisState, type SisStudent } from "@/lib/sis";
import { StudentNameLabel } from "@/components/students/StudentAvatar";
import { useDemoSession } from "@/components/shell/SessionContext";

type Row = { studentId: string; amount: string };

/**
 * Enter a whole class/section's previous-year dues at once — the grid
 * counterpart to the single-student form above, for when there's a full
 * section's worth of carried-forward amounts to record rather than one.
 */
export function BulkPreviousDueByClassPanel({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const session = useDemoSession();
  const toAy = session.academicYearCode;
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [fromAy, setFromAy] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [fillAmount, setFillAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const m = loadMasters();
    setMasters(m);
    setSis(loadSis());
    setFromAy((prev) => prev || previousAcademicYearCode(toAy, m) || "");
  }, [toAy]);

  const classOptions = useMemo(() => {
    if (!masters) return [];
    const active = masters.classes.filter((c) => c.isActive !== false);
    return active.length > 0 ? active : masters.classes;
  }, [masters]);

  const sectionOptions = useMemo(() => {
    if (!masters || !classId) return [];
    const forClass = masters.sections.filter((s) => s.classId === classId);
    const active = forClass.filter((s) => s.isActive !== false);
    return active.length > 0 ? active : forClass;
  }, [masters, classId]);

  useEffect(() => {
    if (sectionId && !sectionOptions.some((s) => s.id === sectionId)) {
      setSectionId("");
    }
  }, [sectionId, sectionOptions]);

  const ayOptions = useMemo(
    () =>
      listSessionYearOptions(masters).filter((y) => y.status !== "upcoming"),
    [masters],
  );

  const roster: SisStudent[] = useMemo(() => {
    if (!sis || !sectionId) return [];
    return rosterForSection(sis.students, sectionId, {
      classId: classId || undefined,
      academicYearCode: toAy,
    });
  }, [sis, sectionId, classId, toAy]);

  // Pre-fill each row from any existing non-voided carried-forward due for
  // this student + fromAy → toAy, so staff see what's already on file.
  useEffect(() => {
    if (!roster.length || !fromAy) {
      setRows([]);
      return;
    }
    const fees = loadFees();
    setRows(
      roster.map((st) => {
        const existing = fees.carriedForwardDues.find(
          (cf) =>
            !cf.voidedAt &&
            cf.studentId === st.id &&
            cf.fromAcademicYearCode === fromAy &&
            cf.toAcademicYearCode === toAy,
        );
        return {
          studentId: st.id,
          amount: existing ? String(existing.amountPaise / 100) : "",
        };
      }),
    );
  }, [roster, fromAy, toAy]);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3200);
  }

  function setAmount(studentId: string, amount: string) {
    setRows((prev) =>
      prev.map((r) => (r.studentId === studentId ? { ...r, amount } : r)),
    );
  }

  function fillBlanks() {
    const rupees = Number(fillAmount);
    if (!Number.isFinite(rupees) || rupees <= 0) return;
    setRows((prev) =>
      prev.map((r) => (r.amount.trim() ? r : { ...r, amount: fillAmount })),
    );
  }

  function onSaveAll() {
    if (!fromAy.trim()) {
      setError("Pick which academic year these dues are from");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = applyBulkPreviousDues({
        fees: loadFees(),
        rows: rows.map((r) => ({
          studentId: r.studentId,
          amountPaise: Math.round((Number(r.amount) || 0) * 100),
        })),
        fromAy: fromAy.trim(),
        toAy,
        enteredBy: session.fullName,
      });
      saveFees(result.fees);
      onChanged?.();
      flash(
        `Saved · ${result.created} added · ${result.updated} updated · ${result.skipped} skipped (blank)`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
      <h3 className="text-sm font-bold text-[var(--brand-deep)]">
        Add previous dues — whole class
      </h3>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Pick a class and section, enter an amount per student, save them all
        at once. Blank rows are skipped, not saved as zero.
      </p>

      {error ? (
        <p className="mt-2 rounded-lg bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-2 rounded-lg bg-[rgba(22,163,74,0.08)] px-3 py-2 text-sm text-[#15803d]">
          {notice}
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--muted)]">Class</span>
          <select
            className="field"
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              setSectionId("");
            }}
          >
            <option value="">Select class…</option>
            {classOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-[var(--muted)]">Section</span>
          <select
            className="field"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            disabled={!classId}
          >
            <option value="">
              {classId ? "Select section…" : "Pick class first"}
            </option>
            {sectionOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-[var(--muted)]">
            From academic year
          </span>
          <select
            className="field"
            value={fromAy}
            onChange={(e) => setFromAy(e.target.value)}
          >
            <option value="">Select year…</option>
            {ayOptions.map((y) => (
              <option key={y.code} value={y.code}>
                {y.label} {y.status === "current" ? "· Current" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              className="field !w-32"
              type="number"
              min="0"
              step="1"
              value={fillAmount}
              onChange={(e) => setFillAmount(e.target.value)}
              placeholder="₹ amount"
            />
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
              onClick={fillBlanks}
            >
              Fill all blank rows
            </button>
            <span className="text-xs text-[var(--muted)]">
              {roster.length} student{roster.length === 1 ? "" : "s"} in this
              section
            </span>
          </div>

          <ul className="mt-2 max-h-[28rem] divide-y divide-[rgba(32,48,80,0.08)] overflow-y-auto rounded-lg border border-[rgba(32,48,80,0.1)]">
            {roster.map((st) => {
              const row = rows.find((r) => r.studentId === st.id);
              return (
                <li
                  key={st.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--brand-deep)]">
                      <StudentNameLabel student={st} />
                    </div>
                    <div className="text-[11px] text-[var(--muted)]">
                      {st.admissionNo}
                      {st.rollNo ? ` · Roll ${st.rollNo}` : ""}
                    </div>
                  </div>
                  <input
                    className="field !w-28 shrink-0"
                    type="number"
                    min="0"
                    step="1"
                    value={row?.amount ?? ""}
                    onChange={(e) => setAmount(st.id, e.target.value)}
                    placeholder="₹"
                  />
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            className="mt-3 rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-sm font-bold text-white hover:opacity-95 disabled:opacity-50"
            disabled={busy}
            onClick={onSaveAll}
          >
            {busy
              ? "Saving…"
              : `Save all (${rows.filter((r) => r.amount.trim()).length} filled)`}
          </button>
        </>
      ) : sectionId ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          No active students in this section.
        </p>
      ) : null}
    </div>
  );
}
