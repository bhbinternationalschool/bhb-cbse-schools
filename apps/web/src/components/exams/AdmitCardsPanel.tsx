"use client";

import { useEffect, useMemo, useState } from "react";
import { listExamDateSheet, loadExams, type ExamTerm } from "@/lib/exams";
import { rosterForSection } from "@/lib/attendance";
import { loadSis } from "@/lib/sis";
import { checkHold, type HoldCheck } from "@/lib/holds";
import type { MastersState } from "@/lib/masters";
import {
  buildAdmitCardDoc,
  downloadAdmitCardsPdf,
} from "@/lib/admitCardPdf";
import {
  HoldStatusBanner,
  PrincipalHoldOverrideDialog,
} from "@/components/fees/PrincipalHoldOverrideDialog";
import { field } from "@/components/ui/erp-ui";
import { useDemoSession } from "@/components/shell/SessionContext";

type Props = {
  academicYearCode: string;
  masters: MastersState;
  terms: ExamTerm[];
};

export function AdmitCardsPanel({ academicYearCode, masters, terms }: Props) {
  const session = useDemoSession();
  const [examTermId, setExamTermId] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tick, setTick] = useState(0);
  const [overrideTarget, setOverrideTarget] = useState<{
    id: string;
    name: string;
    check: Extract<HoldCheck, { allowed: false }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!examTermId && terms[0]) setExamTermId(terms[0].id);
    if (examTermId && !terms.some((t) => t.id === examTermId) && terms[0]) {
      setExamTermId(terms[0].id);
    }
  }, [terms, examTermId]);

  useEffect(() => {
    void (async () => {
      const { ensureSisHydrated } = await import("@/lib/sisPersistence");
      await ensureSisHydrated();
      setTick((x) => x + 1);
    })();
  }, []);

  const sis = useMemo(() => {
    void tick;
    return loadSis();
  }, [tick]);
  const exams = useMemo(() => {
    void tick;
    return loadExams();
  }, [tick]);

  const classOptions = useMemo(
    () => masters.classes.filter((c) => c.isActive),
    [masters],
  );
  const sectionOptions = useMemo(
    () =>
      masters.sections.filter(
        (s) => s.isActive && (!classId || s.classId === classId),
      ),
    [masters, classId],
  );

  const roster = useMemo(() => {
    if (!sectionId) return [];
    return rosterForSection(sis.students, sectionId, {
      classId: classId || undefined,
      academicYearCode,
    });
  }, [sis, sectionId, classId, academicYearCode]);

  const dateSheet = useMemo(
    () => listExamDateSheet(academicYearCode, examTermId || undefined, exams),
    [academicYearCode, examTermId, exams],
  );

  const rows = useMemo(
    () =>
      roster.map((student) => ({
        student,
        hold: checkHold(student.id, "HOLD_ADMIT_CARD"),
      })),
    [roster, tick], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const allowedRows = rows.filter((r) => r.hold.allowed);
  const blockedRows = rows.filter(
    (r): r is { student: (typeof rows)[number]["student"]; hold: Extract<HoldCheck, { allowed: false }> } =>
      !r.hold.allowed,
  );

  useEffect(() => {
    setSelectedIds(allowedRows.map((r) => r.student.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId, classId, examTermId]);

  function toggle(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function refresh() {
    setTick((x) => x + 1);
  }

  async function onGenerate() {
    const term = terms.find((t) => t.id === examTermId);
    if (!term) {
      setError("Pick an exam term.");
      return;
    }
    const picked = allowedRows
      .filter((r) => selectedIds.includes(r.student.id))
      .map((r) => r.student);
    if (!picked.length) {
      setError("Select at least one student.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const docs = picked.map((s) =>
        buildAdmitCardDoc(s, term, {
          masters,
          dateSheet,
          examSubjects: exams.subjects,
        }),
      );
      await downloadAdmitCardsPdf(docs, { masters });
      setNotice(`${docs.length} admit card(s) generated.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 space-y-4">
      <p className="text-[12px] text-[var(--muted)]">
        Pick an exam term and class/section — students with an admit-card
        hold (overdue fees, stage S3+) are listed separately and need a
        Principal PIN override before their card can print.
      </p>

      {notice ? (
        <p className="rounded-lg bg-[var(--success-soft)] px-3 py-2 text-xs text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Exam term</span>
          <select
            className={`${field} !py-1.5`}
            value={examTermId}
            onChange={(e) => setExamTermId(e.target.value)}
          >
            {terms.length === 0 ? <option value="">No terms</option> : null}
            {terms.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Class</span>
          <select
            className={`${field} !py-1.5`}
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              setSectionId("");
            }}
          >
            <option value="">Select…</option>
            {classOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Section</span>
          <select
            className={`${field} !py-1.5`}
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            disabled={!classId}
          >
            <option value="">Select…</option>
            {sectionOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
      </div>

      {!sectionId ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          Select a class and section.
        </p>
      ) : (
        <>
          {blockedRows.length ? (
            <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-3">
              <h3 className="text-[12px] font-bold text-[var(--danger)]">
                Held — needs override ({blockedRows.length})
              </h3>
              <ul className="mt-2 space-y-2">
                {blockedRows.map((r) => (
                  <li key={r.student.id} className="space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm">{r.student.fullName}</span>
                      <button
                        type="button"
                        className="rounded-lg border border-[var(--danger)]/40 px-2.5 py-1 text-[11px] font-semibold text-[var(--danger)]"
                        onClick={() =>
                          setOverrideTarget({
                            id: r.student.id,
                            name: r.student.fullName,
                            check: r.hold,
                          })
                        }
                      >
                        Grant override
                      </button>
                    </div>
                    <HoldStatusBanner check={r.hold} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
              onClick={() => setSelectedIds(allowedRows.map((r) => r.student.id))}
            >
              Select all
            </button>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
              onClick={() => setSelectedIds([])}
            >
              Clear
            </button>
            <span className="text-[11px] text-[var(--muted)]">
              {selectedIds.length} of {allowedRows.length} selected
            </span>
          </div>

          <div className="max-h-96 overflow-y-auto rounded-xl border border-[var(--border)]">
            {allowedRows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">
                No students clear to print in this selection.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {allowedRows.map((r) => (
                  <li key={r.student.id} className="flex items-center gap-3 px-4 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(r.student.id)}
                      onChange={() => toggle(r.student.id)}
                    />
                    <span className="flex-1 truncate text-sm">{r.student.fullName}</span>
                    <span className="text-xs text-[var(--muted)]">{r.student.admissionNo}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            className="btn-accent rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
            disabled={busy || !selectedIds.length || !examTermId}
            onClick={onGenerate}
          >
            {busy ? "Generating…" : `Print ${selectedIds.length} admit card(s)`}
          </button>
        </>
      )}

      {overrideTarget ? (
        <PrincipalHoldOverrideDialog
          studentId={overrideTarget.id}
          studentName={overrideTarget.name}
          holdCode="HOLD_ADMIT_CARD"
          mode="unhold"
          block={overrideTarget.check}
          overriddenBy={session.fullName}
          onClose={() => setOverrideTarget(null)}
          onGranted={() => {
            setOverrideTarget(null);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
