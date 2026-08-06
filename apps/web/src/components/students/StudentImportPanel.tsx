"use client";

import { useEffect, useMemo, useState } from "react";
import {
  STUDENT_TYPES,
  type FeeStudentType,
  type MastersState,
} from "@/lib/masters";
import {
  clearAllStudents,
  isLikelyDemoRoster,
  saveSis,
  type SisState,
} from "@/lib/sis";
import {
  applyStudentImport,
  detectSessionCodeFromText,
  downloadStudentImportTemplate,
  listImportSessions,
  listMissingFromImport,
  previewStudentImport,
  workbookToStudentImportCsv,
  type SessionGapRow,
  type StudentImportPlacement,
  type StudentImportPreview,
} from "@/lib/studentImport";
import { SessionImportGapDialog } from "@/components/students/SessionImportGapDialog";
import { useDemoSession } from "@/components/shell/SessionContext";

type Props = {
  masters: MastersState;
  sis: SisState;
  onApplied: (next: SisState, message: string) => void;
};

type GapReview = {
  sis: SisState;
  priorSession: string;
  targetSession: string;
  missing: SessionGapRow[];
};

export function StudentImportPanel({ masters, sis, onApplied }: Props) {
  const session = useDemoSession();
  const sessions = useMemo(() => listImportSessions(masters), [masters]);
  const liveAy = session.academicYearCode;
  const [open, setOpen] = useState(sis.students.length === 0);
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [targetSession, setTargetSession] = useState(liveAy);
  const [sourceSessionFilter, setSourceSessionFilter] = useState("");
  const [placement, setPlacement] =
    useState<StudentImportPlacement>("place_in_target");
  const [defaultStudentType, setDefaultStudentType] =
    useState<FeeStudentType>("NEW");
  const [upsert, setUpsert] = useState(true);
  const [autoAssignNumbers, setAutoAssignNumbers] = useState(false);
  const [mapLegacyErpAdmission, setMapLegacyErpAdmission] = useState(true);
  const [preview, setPreview] = useState<StudentImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [gapReview, setGapReview] = useState<GapReview | null>(null);

  useEffect(() => {
    setTargetSession(liveAy);
    setPreview(null);
    setGapReview(null);
  }, [liveAy]);

  const options = {
    targetSession,
    placement,
    sourceSessionFilter,
    defaultStudentType,
    upsert,
    autoAssignNumbers,
    mapLegacyErpAdmission,
  };

  function onFile(file: File | null) {
    if (!file) return;
    setFileName(file.name);
    setLocalError(null);
    setPreview(null);
    const isXlsx =
      /\.xlsx?$/i.test(file.name) ||
      file.type.includes("sheet") ||
      file.type.includes("excel");

    if (isXlsx) {
      const reader = new FileReader();
      reader.onload = () => {
        void (async () => {
          try {
            const buf = reader.result as ArrayBuffer;
            const { csv: text, detectedSession } =
              await workbookToStudentImportCsv(buf);
            setCsvText(text);
            const fromName = detectSessionCodeFromText(file.name);
            const sessionHit = detectedSession || fromName;
            const opts = { ...options };
            if (sessionHit) {
              setTargetSession(sessionHit);
              opts.targetSession = sessionHit;
              opts.placement = "place_in_target";
              setPlacement("place_in_target");
            }
            setPreview(previewStudentImport(text, masters, opts, sis));
          } catch (err) {
            setLocalError(
              err instanceof Error ? err.message : "Could not read Excel file",
            );
          }
        })();
      };
      reader.onerror = () => setLocalError("Could not read file");
      reader.readAsArrayBuffer(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
      const fromFile =
        detectSessionCodeFromText(file.name) ||
        detectSessionCodeFromText(text.slice(0, 4000));
      const opts = { ...options };
      if (fromFile) {
        setTargetSession(fromFile);
        opts.targetSession = fromFile;
        opts.placement = "place_in_target";
        setPlacement("place_in_target");
      }
      setPreview(previewStudentImport(text, masters, opts, sis));
    };
    reader.onerror = () => setLocalError("Could not read file");
    reader.readAsText(file);
  }

  function refreshPreview() {
    if (!csvText) {
      setPreview(null);
      return;
    }
    setPreview(previewStudentImport(csvText, masters, options, sis));
  }

  async function runImport() {
    if (!csvText) {
      setLocalError("Choose a CSV file first");
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      const result = applyStudentImport(csvText, sis, masters, options);
      if (result.created + result.updated === 0 && result.errors.length > 0) {
        setPreview(result);
        setLocalError("No rows imported — fix errors below");
        return;
      }
      saveSis(result.state);
      void import("@/lib/sisPersistence").then(({ flushSisSync }) => {
        flushSisSync().catch(console.error);
      });
      setPreview(result);
      onApplied(
        result.state,
        `Imported ${result.created} new, updated ${result.updated}` +
          (result.skipped ? `, skipped ${result.skipped} (session filter)` : ""),
      );
      setCsvText("");
      setFileName("");

      const gap = listMissingFromImport(
        result.state,
        result.targetSession,
        result.importedAdmissionNos,
      );
      if (gap) {
        setGapReview({
          sis: result.state,
          priorSession: gap.priorSession,
          targetSession: gap.targetSession,
          missing: gap.missing,
        });
      }
    } catch (e) {
      console.error("[sisImport] Import failed:", e);
      setLocalError(
        e instanceof Error
          ? `Import error: ${e.message}`
          : "An unexpected error occurred during import.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function wipeRoster() {
    const ok = window.confirm(
      "Clear ALL students and households from this browser?\n\nAlso clears remote Supabase roster if configured. Fee receipts are kept.",
    );
    if (!ok) return;
    setBusy(true);
    try {
      const next = clearAllStudents();
      const { wipeRemoteSisRoster } = await import("@/lib/sisPersistence");
      await wipeRemoteSisRoster();
      onApplied(next, "Roster cleared — ready for CSV import");
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
      {gapReview ? (
        <SessionImportGapDialog
          masters={masters}
          sis={gapReview.sis}
          priorSession={gapReview.priorSession}
          targetSession={gapReview.targetSession}
          missing={gapReview.missing}
          onClose={() => setGapReview(null)}
          onApplied={(next, message) => {
            saveSis(next);
            setGapReview(null);
            onApplied(next, message);
          }}
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(32,48,80,0.08)] px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-[var(--brand-deep)]">
            Live start · Import students
          </div>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            Upload session-wise CSV or Excel Student Report (e.g. 2023-24).
            Template matches the full register export.
            {isLikelyDemoRoster(sis)
              ? " Demo roster still present — clear before live data."
              : sis.students.length === 0
                ? " Roster is empty."
                : ` ${sis.students.length} student(s) on file.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Hide" : "Show"} import
          </button>
          <button
            type="button"
            disabled={busy || sis.students.length === 0}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-800 disabled:opacity-40"
            onClick={() => void wipeRoster()}
          >
            Clear all students
          </button>
        </div>
      </div>

      {open ? (
        <div className="space-y-4 px-4 py-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-accent rounded-lg px-3 py-2 text-xs font-semibold"
              onClick={() => downloadStudentImportTemplate(masters)}
            >
              Download CSV template
            </button>
            <label className="cursor-pointer rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]">
              Choose CSV / Excel…
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {fileName ? (
              <span className="self-center text-[11px] text-[var(--muted)]">
                {fileName}
              </span>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-[11px] font-medium text-[var(--muted)]">
              Place students in session
              <select
                className="field mt-1 w-full text-sm"
                value={targetSession}
                onChange={(e) => {
                  setTargetSession(e.target.value);
                }}
                onBlur={refreshPreview}
              >
                {sessions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                    {s === liveAy ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] font-medium text-[var(--muted)]">
              Session placement
              <select
                className="field mt-1 w-full text-sm"
                value={placement}
                onChange={(e) => {
                  setPlacement(e.target.value as StudentImportPlacement);
                }}
                onBlur={refreshPreview}
              >
                <option value="place_in_target">
                  Import into selected session (other years kept)
                </option>
                <option value="keep_csv_session">
                  Keep Session column from CSV
                </option>
              </select>
            </label>
            <label className="block text-[11px] font-medium text-[var(--muted)]">
              Only rows from CSV session (optional)
              <select
                className="field mt-1 w-full text-sm"
                value={sourceSessionFilter}
                onChange={(e) => setSourceSessionFilter(e.target.value)}
                onBlur={refreshPreview}
              >
                <option value="">All rows in file</option>
                {sessions.map((s) => (
                  <option key={s} value={s}>
                    Only {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] font-medium text-[var(--muted)]">
              Default type for brand-new (no prior year)
              <select
                className="field mt-1 w-full text-sm"
                value={defaultStudentType}
                onChange={(e) =>
                  setDefaultStudentType(e.target.value as FeeStudentType)
                }
              >
                {STUDENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-xs text-[var(--brand-deep)]">
              <input
                type="checkbox"
                checked={upsert}
                onChange={(e) => setUpsert(e.target.checked)}
              />
              Update if same admission already exists in this session
            </label>
            <label className="flex items-start gap-2 pb-2 text-xs text-[var(--brand-deep)] sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={autoAssignNumbers}
                onChange={(e) => {
                  setAutoAssignNumbers(e.target.checked);
                  setPreview(null);
                }}
              />
              <span>
                <span className="font-semibold">
                  Auto-assign admission no. &amp; SRN from admission date
                </span>
                <span className="mt-0.5 block text-[11px] font-normal text-[var(--muted)]">
                  Leave admission no. blank when the file has{" "}
                  <strong>Admission date</strong> — numbers use Masters →
                  Numbering (session in admission prefix; SRN serial by date,
                  earliest first).
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 pb-2 text-xs text-[var(--brand-deep)] sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={mapLegacyErpAdmission}
                onChange={(e) => {
                  setMapLegacyErpAdmission(e.target.checked);
                  setPreview(null);
                }}
              />
              <span>
                <span className="font-semibold">
                  Map file admission no. → Old ERP number (import only)
                </span>
                <span className="mt-0.5 block text-[11px] font-normal text-[var(--muted)]">
                  When the CSV has an admission number, store it as{" "}
                  <strong>Old ERP admission no.</strong> and assign a new unique{" "}
                  <strong>system admission no.</strong> from Masters → Numbering.
                  Duplicate names in the session are held for verification first.
                  Manual add-student is unchanged.
                </span>
              </span>
            </label>
          </div>

          <p className="text-[11px] leading-relaxed text-[var(--muted)]">
            Sessions stay separate forever (2023-24, 2024-25, 2025-26…). Same
            admission in a newer year is stored as{" "}
            <strong className="font-semibold text-[var(--brand-deep)]">
              Promoted / continuing
            </strong>{" "}
            automatically; the older year row is kept unchanged for history.
            Switch the header Session to view each year.
          </p>

          {localError ? (
            <p className="text-xs font-medium text-red-700">{localError}</p>
          ) : null}

          {preview ? (
            <div className="rounded-lg border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] px-3 py-2 text-xs">
              <div className="font-semibold text-[var(--brand-deep)]">
                Preview: {preview.accepted} ok · {preview.skipped} skipped ·{" "}
                {preview.errors.length} error
                {preview.errors.length === 1 ? "" : "s"}
                {preview.totalRows ? ` · ${preview.totalRows} data rows` : ""}
              </div>
              {preview.sample.length > 0 ? (
                <ul className="mt-1 list-inside list-disc text-[var(--muted)]">
                  {preview.sample.map((s) => (
                    <li key={s.admissionNo}>
                      {s.admissionNo} · {s.fullName} · {s.className} →{" "}
                      {s.session}
                      {s.studentType
                        ? ` · ${s.studentType}${s.continuing ? " (from prior year)" : ""}`
                        : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              {preview.errors.length > 0 ? (
                <ul className="mt-2 max-h-28 overflow-auto text-red-800">
                  {preview.errors.map((e, i) => (
                    <li key={`${e.row}-${i}`}>
                      Row {e.row}
                      {e.admissionNo ? ` (${e.admissionNo})` : ""}: {e.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.15)] px-3 py-2 text-xs font-semibold"
              disabled={!csvText}
              onClick={refreshPreview}
            >
              Refresh preview
            </button>
            <button
              type="button"
              className="btn-accent rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-40"
              disabled={busy || !csvText}
              onClick={() => void runImport()}
            >
              {busy ? "Importing…" : "Import students"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
