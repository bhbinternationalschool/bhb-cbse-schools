"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addManualPreviousDue,
  voidCarriedForwardDue,
} from "@/lib/previousDuesExcelImport";
import {
  formatInr,
  loadFees,
  previousAcademicYearCode,
  saveFees,
  searchFeeStudents,
  type StudentSearchHit,
} from "@/lib/fees";
import { loadMasters, listSessionYearOptions, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { StudentNameLabel } from "@/components/students/StudentAvatar";
import { useDemoSession } from "@/components/shell/SessionContext";

/**
 * Enter one student's previous-year pending due directly — the single-
 * student counterpart to "Import previous dues (Excel)" below, for a
 * one-off entry with no spreadsheet to prepare.
 */
export function ManualPreviousDuePanel({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const session = useDemoSession();
  const toAy = session.academicYearCode;
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StudentSearchHit[]>([]);
  const [studentId, setStudentId] = useState("");
  const [fromAy, setFromAy] = useState("");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const m = loadMasters();
    setMasters(m);
    setSis(loadSis());
    setFromAy((prev) => prev || previousAcademicYearCode(toAy, m) || "");
  }, [toAy]);

  useEffect(() => {
    if (!sis || !masters) return;
    setHits(
      query
        ? searchFeeStudents(query, sis, masters, loadFees(), {
            academicYearCode: toAy,
          }).slice(0, 20)
        : [],
    );
  }, [query, sis, masters, toAy]);

  const student = sis?.students.find((s) => s.id === studentId) ?? null;

  const ayOptions = useMemo(
    () =>
      listSessionYearOptions(masters).filter((y) => y.status !== "upcoming"),
    [masters],
  );

  const existing = useMemo(() => {
    if (!studentId) return [];
    void tick;
    return loadFees().carriedForwardDues.filter(
      (cf) => cf.studentId === studentId && !cf.voidedAt,
    );
  }, [studentId, tick]);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 3200);
  }

  function pickStudent(hit: StudentSearchHit) {
    setStudentId(hit.student.id);
    setQuery("");
    setHits([]);
  }

  function onSave() {
    if (!studentId) {
      setError("Pick a student first");
      return;
    }
    if (!fromAy.trim()) {
      setError("Pick which academic year this due is from");
      return;
    }
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setError("Enter a valid amount");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = addManualPreviousDue({
        fees: loadFees(),
        studentId,
        fromAy: fromAy.trim(),
        toAy,
        amountPaise: Math.round(rupees * 100),
        label: label.trim() || undefined,
        enteredBy: session.fullName,
      });
      saveFees(result.fees);
      setAmount("");
      setLabel("");
      setTick((t) => t + 1);
      onChanged?.();
      flash(
        result.created
          ? `Added ${formatInr(Math.round(rupees * 100))} previous due for ${student?.fullName}`
          : `Updated previous due for ${student?.fullName}`,
      );
    } finally {
      setBusy(false);
    }
  }

  function onVoid(id: string) {
    setBusy(true);
    try {
      saveFees(voidCarriedForwardDue(loadFees(), id, session.fullName));
      setTick((t) => t + 1);
      onChanged?.();
      flash("Previous due voided");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
      <h3 className="text-sm font-bold text-[var(--brand-deep)]">
        Add previous due — one student
      </h3>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Record a pending amount carried forward from a past session (e.g.
        2025-26) for a single student — posts as arrears on Fee Take for
        session {toAy}.
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

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-sm text-[var(--muted)]">
            Student
          </span>
          {student ? (
            <div className="rounded-lg bg-[rgba(32,48,80,0.05)] px-3 py-2 text-sm">
              <div className="font-semibold text-[var(--brand-deep)]">
                <StudentNameLabel student={student} />
              </div>
              <div className="text-xs text-[var(--muted)]">
                {student.admissionNo}
              </div>
              <button
                type="button"
                className="mt-1 text-[11px] font-semibold text-[var(--brand-mid)]"
                onClick={() => setStudentId("")}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                className="field"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name / admission…"
              />
              {hits.length > 0 ? (
                <ul className="mt-1 max-h-48 overflow-auto rounded-lg border border-[rgba(32,48,80,0.1)] divide-y divide-[rgba(32,48,80,0.06)]">
                  {hits.map((h) => (
                    <li key={h.student.id}>
                      <button
                        type="button"
                        className="w-full px-2 py-2 text-left text-sm hover:bg-[rgba(32,48,80,0.04)]"
                        onClick={() => pickStudent(h)}
                      >
                        {h.student.fullName}
                        <span className="block text-[11px] text-[var(--muted)]">
                          {h.student.admissionNo} · {h.classLabel}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>

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

        <label className="block text-sm">
          <span className="mb-1 block text-[var(--muted)]">Amount (₹)</span>
          <input
            className="field"
            type="number"
            min="0"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-[var(--muted)]">
            Label (optional)
          </span>
          <input
            className="field"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={fromAy ? `Previous Due · ${fromAy}` : "Previous Due"}
          />
        </label>
      </div>

      <button
        type="button"
        className="mt-3 rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-sm font-bold text-white hover:opacity-95 disabled:opacity-50"
        disabled={busy || !studentId}
        onClick={onSave}
      >
        {busy ? "Saving…" : "Add previous due"}
      </button>

      {existing.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Already on file for this student
          </h4>
          <ul className="mt-1 space-y-1">
            {existing.map((cf) => (
              <li
                key={cf.id}
                className="flex items-center justify-between rounded-lg bg-[rgba(32,48,80,0.04)] px-3 py-2 text-sm"
              >
                <span>
                  {cf.label} ({cf.fromAcademicYearCode}) —{" "}
                  {formatInr(cf.amountPaise)}
                </span>
                <button
                  type="button"
                  className="text-[11px] font-semibold text-[#dc2626]"
                  disabled={busy}
                  onClick={() => onVoid(cf.id)}
                >
                  Void
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
