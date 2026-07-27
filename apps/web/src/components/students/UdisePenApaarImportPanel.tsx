"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  STUDENT_TYPES,
  type FeeStudentType,
  type MastersState,
} from "@/lib/masters";
import { saveSis, type SisState, type SisStudent } from "@/lib/sis";
import { upgradeStudentClass } from "@/lib/classUpgrade";
import {
  DEFAULT_UDISE_MATCH_OPTIONS,
  applyUdiseRowToStudent,
  applyUdiseStudentDetailsSync,
  classBelowId,
  findUdiseMatchCandidates,
  importUnmatchedUdiseRows,
  isLowestActiveClass,
  lowerClassIds,
  markStudentVerifiedFromUdise,
  matrixFromUdiseStudentsFile,
  nextSessionCode,
  setStudentPromotionLock,
  setUdiseStudentStatus,
  migrateUdiseRowToSis,
  previewUdiseStudentDetailsSync,
  promoteUdiseRowToSession,
  reconcileUdisePortalUpload,
  type UdiseMatchOptions,
  type UdiseMatchPreview,
  type UdiseRowTone,
  type UdiseStudentRow,
} from "@/lib/udiseStudentDetails";

type Props = {
  masters: MastersState;
  sis: SisState;
  academicYearCode?: string;
  onApplied: (next: SisState, message: string) => void;
};

const TONE_ROW: Record<UdiseRowTone, string> = {
  fill: "bg-[rgba(14,90,140,0.08)]",
  ok: "bg-[rgba(15,122,76,0.08)]",
  verify: "bg-[rgba(180,120,24,0.1)]",
  suspect: "bg-[rgba(180,35,24,0.08)]",
  ambiguous: "bg-[rgba(100,60,140,0.08)]",
  inactive: "bg-[rgba(90,90,90,0.1)]",
  mbu_age: "bg-[rgba(180,35,24,0.16)]",
};

const TONE_BADGE: Record<UdiseRowTone, string> = {
  fill: "bg-[rgba(14,90,140,0.2)] text-[#0a4a73]",
  ok: "bg-[rgba(15,122,76,0.2)] text-[#0f7a4c]",
  verify: "bg-[rgba(180,120,24,0.25)] text-[#8a5a10]",
  suspect: "bg-[rgba(180,35,24,0.2)] text-[#8b1a12]",
  ambiguous: "bg-[rgba(100,60,140,0.2)] text-[#5a2a7a]",
  inactive: "bg-[rgba(60,60,60,0.25)] text-[#333]",
  mbu_age: "bg-[#b42318] text-white",
};

const TONE_LABEL: Record<UdiseRowTone, string> = {
  fill: "Fill SIS",
  ok: "In sync",
  verify: "Verify on UDISE+",
  suspect: "Not in SIS / suspect",
  ambiguous: "Ambiguous",
  inactive: "Inactive in SIS",
  mbu_age: "Age below class (MBU)",
};

type FilterTone =
  | "all"
  | "fill"
  | "verify"
  | "suspect"
  | "ok"
  | "changes"
  | "mbu_age"
  | "class_mismatch"
  | "dob_mismatch"
  | "ambiguous"
  | "other_session"
  | "inactive";

function ayNorm(code: string): string {
  const t = (code || "").trim().replace(/\s+/g, "").replace(/–/g, "-");
  const full = t.match(/^(20\d{2})-(20\d{2})$/);
  if (full) return `${full[1]}-${full[2]!.slice(2)}`;
  return t;
}

function MbuAgeActions({
  student,
  masters,
  academicYearCode,
  onReassign,
  onLock,
}: {
  student: SisStudent;
  masters: MastersState;
  academicYearCode?: string;
  onReassign: (studentId: string, name: string, toClassId: string) => void;
  onLock: (
    studentId: string,
    name: string,
    locked: boolean,
    reason?: string,
  ) => void;
}) {
  const lowerIds = lowerClassIds(masters, student.classId);
  const lowest = isLowestActiveClass(masters, student.classId);
  const suggestedBelow = classBelowId(masters, student.classId);
  const [target, setTarget] = useState(suggestedBelow || "");
  const nextSess = nextSessionCode(academicYearCode || student.academicYearCode);
  const className =
    masters.classes.find((c) => c.id === student.classId)?.name || "—";

  return (
    <div className="mt-1 rounded-md border border-[rgba(180,35,24,0.3)] bg-[rgba(180,35,24,0.05)] p-1.5">
      <p className="text-[10px] font-semibold text-[#b42318]">
        Age below class ({className}) — govt MBU
      </p>
      {student.promotionLocked ? (
        <p className="mt-1 text-[10px] font-medium text-[#8a5a10]">
          🔒 Promotion locked: {student.promotionLockReason}
        </p>
      ) : null}
      {!lowest ? (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="rounded border border-[rgba(32,48,80,0.2)] px-1 py-0.5 text-[10px]"
          >
            <option value="">Correct class…</option>
            {lowerIds.map((id) => (
              <option key={id} value={id}>
                {masters.classes.find((c) => c.id === id)?.name || id}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!target}
            className="rounded bg-[#b42318] px-2 py-0.5 text-[10px] font-semibold text-white disabled:opacity-40"
            onClick={() => onReassign(student.id, student.fullName, target)}
            title="De-nominate from current class and re-assign to the age-correct lower class"
          >
            Move down & re-assign
          </button>
        </div>
      ) : (
        <p className="mt-1 text-[10px] text-[#5a3a10]">
          Lowest class — cannot move lower. Suggestion: when{" "}
          <strong>{nextSess || "next session"}</strong> starts,{" "}
          <strong>repeat {className}</strong> (do not promote) to meet the UDISE
          age criteria.
        </p>
      )}
      <div className="mt-1">
        {student.promotionLocked ? (
          <button
            type="button"
            className="rounded border border-[#0f7a4c] px-2 py-0.5 text-[10px] font-semibold text-[#0f7a4c]"
            onClick={() => onLock(student.id, student.fullName, false)}
          >
            Unlock promotion
          </button>
        ) : (
          <button
            type="button"
            className="rounded bg-[#8a5a10] px-2 py-0.5 text-[10px] font-semibold text-white"
            onClick={() =>
              onLock(
                student.id,
                student.fullName,
                true,
                lowest
                  ? `Under-age — repeat ${className} in ${
                      nextSess || "next session"
                    } (UDISE MBU)`
                  : `Under-age for ${className} — hold promotion (UDISE MBU)`,
              )
            }
            title="Lock so next-session promotion keeps this student in the same class"
          >
            Lock for promotion (repeat class)
          </button>
        )}
      </div>
    </div>
  );
}

export function UdisePenApaarImportPanel({
  masters,
  sis,
  academicYearCode,
  onApplied,
}: Props) {
  const [open, setOpen] = useState(true);
  const [fileName, setFileName] = useState("");
  const [matrix, setMatrix] = useState<unknown[][] | null>(null);
  const [preview, setPreview] = useState<UdiseMatchPreview[] | null>(null);
  const [formatOk, setFormatOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [justApplied, setJustApplied] = useState(false);
  const [filter, setFilter] = useState<FilterTone>("all");
  const [migrateType, setMigrateType] = useState<FeeStudentType>("RTE");
  const [migrateFeeGroupId, setMigrateFeeGroupId] = useState("");
  const [fallbackClassId, setFallbackClassId] = useState("");
  const [matchOpts, setMatchOpts] = useState<UdiseMatchOptions>(
    DEFAULT_UDISE_MATCH_OPTIONS,
  );

  const feeGroups = useMemo(
    () => (masters.feeGroups || []).filter((g) => g.isActive !== false),
    [masters],
  );

  const activeClasses = useMemo(
    () => (masters.classes || []).filter((c) => c.isActive !== false),
    [masters],
  );

  const stats = useMemo(() => {
    if (!preview) return null;
    return {
      total: preview.length,
      fill: preview.filter((p) => p.tone === "fill").length,
      verify: preview.filter((p) => p.tone === "verify").length,
      suspect: preview.filter((p) => p.tone === "suspect").length,
      ok: preview.filter((p) => p.tone === "ok").length,
      ambiguous: preview.filter((p) => p.tone === "ambiguous").length,
      inactive: preview.filter((p) => p.sisInactive).length,
      mbuAge: preview.filter((p) => p.mbuAgeAlert).length,
      classMismatch: preview.filter((p) => p.classMismatch).length,
      dobMismatch: preview.filter((p) => p.dobMismatch).length,
      withChanges: preview.filter((p) => p.fillLabels.length > 0).length,
    };
  }, [preview]);

  const reconciliation = useMemo(() => {
    if (!matrix) return null;
    return reconcileUdisePortalUpload({
      matrix,
      sis,
      masters,
      academicYearCode: academicYearCode || "",
      options: matchOpts,
    });
  }, [matrix, sis, masters, academicYearCode, matchOpts]);

  const ambiguousRows = useMemo(
    () => (preview ?? []).filter((p) => p.method === "ambiguous"),
    [preview],
  );

  const inactiveRows = useMemo(
    () => (preview ?? []).filter((p) => p.sisInactive),
    [preview],
  );

  const otherSessionRows = useMemo(() => {
    if (!preview) return [];
    const scope = ayNorm(academicYearCode || "");
    if (!scope) return [];
    return preview.filter((p) => {
      if (p.method === "unmatched" || p.method === "ambiguous" || !p.studentId)
        return false;
      // Inactive students belong to the inactive list, not "other session".
      if (p.sisInactive) return false;
      const s = sis.students.find((x) => x.id === p.studentId);
      if (!s || s.status !== "active") return false;
      return ayNorm(s.academicYearCode) !== scope;
    });
  }, [preview, sis, academicYearCode]);

  const visible = useMemo(() => {
    if (!preview) return [];
    if (filter === "changes") return preview.filter((p) => p.fillLabels.length);
    if (filter === "class_mismatch")
      return preview.filter((p) => p.classMismatch);
    if (filter === "mbu_age") return preview.filter((p) => p.mbuAgeAlert);
    if (filter === "dob_mismatch")
      return preview.filter((p) => p.dobMismatch);
    if (filter === "ambiguous") return ambiguousRows;
    if (filter === "other_session") return otherSessionRows;
    if (filter === "inactive") return inactiveRows;
    if (filter === "all") return preview;
    return preview.filter((p) => p.tone === filter);
  }, [preview, filter, ambiguousRows, otherSessionRows, inactiveRows]);

  function refreshPreview(nextSis: SisState, mat: unknown[][]) {
    const { preview: p } = previewUdiseStudentDetailsSync(
      mat,
      nextSis,
      masters,
      matchOpts,
      academicYearCode,
    );
    setPreview(p);
    setJustApplied(false);
  }

  function updateMatchOpts(next: UdiseMatchOptions) {
    setMatchOpts(next);
    setJustApplied(false);
    if (matrix) {
      const { preview: p } = previewUdiseStudentDetailsSync(
        matrix,
        sis,
        masters,
        next,
        academicYearCode,
      );
      setPreview(p);
    }
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const mat = await matrixFromUdiseStudentsFile(buf);
      const { preview: p, formatOk: ok } = previewUdiseStudentDetailsSync(
        mat,
        sis,
        masters,
        matchOpts,
        academicYearCode,
      );
      setMatrix(mat);
      setPreview(p);
      setFormatOk(ok);
      setJustApplied(false);
      setApplyResult(null);
      setOpen(true);
      if (!ok || !p.length) {
        setError(
          "Could not find UDISE+ Students Details headers (Student PEN, Name, APAAR ID, …).",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read file");
      setMatrix(null);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  function applySync() {
    if (!matrix) {
      setError("Choose the UDISE+ Students_Details.xlsx file first");
      return;
    }
    setBusy(true);
    setError(null);
    setApplyResult(null);
    try {
      const result = applyUdiseStudentDetailsSync(
        matrix,
        sis,
        masters,
        matchOpts,
        academicYearCode,
      );
      saveSis(result.state);
      setPreview(result.preview);
      const summary =
        `Updated ${result.updated} student${result.updated === 1 ? "" : "s"} · ` +
        `matched ${result.matched} · no change ${result.skippedNoChange} · ` +
        `ambiguous ${result.ambiguous} · inactive in SIS ${result.inactive} · ` +
        `not in SIS ${result.unmatched}`;
      setApplyResult(
        result.updated === 0
          ? `Nothing written. ${summary}. ` +
              (result.ambiguous
                ? `The ${result.ambiguous} ambiguous rows match more than one SIS record — resolve those duplicates (Suspected duplicates) so their PEN can be written.`
                : "All matched students were already in sync.")
          : `Applied. ${summary}.`,
      );
      setJustApplied(true);
      onApplied(result.state, `UDISE+ fill: ${summary}`);
    } catch (e) {
      setError(
        `Apply failed: ${e instanceof Error ? e.message : "unknown error"}`,
      );
    } finally {
      setBusy(false);
    }
  }

  function importUnmatched() {
    if (!matrix) {
      setError("Choose the UDISE+ Students_Details.xlsx file first");
      return;
    }
    if (migrateType !== "RTE" && !migrateFeeGroupId) {
      setError("Pick a fee group (or set type RTE) before importing new students");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = importUnmatchedUdiseRows({
        matrix,
        sis,
        masters,
        studentType: migrateType,
        feeGroupId: migrateType === "RTE" ? migrateFeeGroupId || null : migrateFeeGroupId,
        matchOptions: matchOpts,
        defaultClassId: fallbackClassId || undefined,
        academicYearCode: academicYearCode || undefined,
      });
      saveSis(res.state);
      refreshPreview(res.state, matrix);
      const errNote = res.errors.length
        ? ` · ${res.errors.length} skipped (${res.errors[0]?.reason ?? ""}${res.errors.length > 1 ? "…" : ""})`
        : "";
      onApplied(
        res.state,
        `UDISE+ import: created ${res.created} new student${res.created === 1 ? "" : "s"}${errNote}`,
      );
      if (res.errors.length && !res.created) {
        setError(
          `No students created. First reason: ${res.errors[0]?.reason ?? "unknown"}. Set a fallback class / fee group and retry.`,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  function exportPreviewCsv(
    list: UdiseMatchPreview[],
    baseName: string,
    label: string,
  ) {
    if (!list.length) {
      setError(`No ${label} rows to export`);
      return;
    }
    const header = [
      "Portal row #",
      "Student (UDISE)",
      "As per Aadhaar",
      "Father",
      "Mother",
      "UDISE class",
      "Section",
      "PEN",
      "APAAR ID",
      "APAAR status",
      "Aadhaar validation",
      "MBU status",
      "Social category",
      "Gender",
      "UDISE DOB",
      "SIS DOB",
      "DOB differs",
      "Suspected duplicate",
      "SIS matched name",
      "SIS admission no",
      "SIS session",
      "Match / reason",
    ];
    const lines = list.map((p) => {
      const u = p.udise;
      const s = p.studentId
        ? sis.students.find((x) => x.id === p.studentId)
        : null;
      const reason = p.sisInactive
        ? `Inactive in SIS (${p.sisStatus || "inactive"} · session ${p.sisSession || "—"})`
        : p.method === "ambiguous"
          ? "Ambiguous — matches multiple SIS records"
          : p.method === "unmatched"
            ? p.note || "No name match in SIS"
            : s && ayNorm(s.academicYearCode) !== ayNorm(academicYearCode || "")
              ? `Matched but in session ${s.academicYearCode} (not ${academicYearCode})`
              : p.note || p.method;
      const cells = [
        String(p.rowIndex),
        u.fullName,
        u.aadhaarName,
        u.fatherName,
        u.motherName,
        u.classHint,
        u.sectionHint,
        u.pen,
        u.apaarId,
        u.apaarStatus,
        u.aadhaarValidation,
        u.mbuStatus,
        u.socialCategory,
        u.gender,
        p.udiseDob,
        p.sisDob,
        p.dobMismatch ? "YES" : "",
        u.suspectedDuplicate,
        p.matchedName,
        p.admissionNo,
        s?.academicYearCode ?? "",
        reason,
      ];
      return cells
        .map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`)
        .join(",");
    });
    const blob = new Blob(
      [["\uFEFF" + header.join(","), ...lines].join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportUnmatchedRows() {
    if (!preview) return;
    exportPreviewCsv(
      preview.filter((p) => p.method === "unmatched" && !p.studentId),
      "udise_not_in_sis",
      "not-in-SIS",
    );
  }

  function tickVerified(p: UdiseMatchPreview) {
    if (!p.studentId) return;
    const r = markStudentVerifiedFromUdise({
      studentId: p.studentId,
      pen: p.udise.pen || p.sisFilled.pen,
      apaarId: p.udise.apaarId || p.sisFilled.apaarId,
      aadhaarLast4: p.udise.aadhaarRaw || p.sisFilled.aadhaar,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    saveSis(r.state);
    onApplied(r.state, `Verified by UDISE+ · ${r.student.fullName}`);
    if (matrix) refreshPreview(r.state, matrix);
  }

  function applyRowToStudent(
    row: UdiseStudentRow,
    studentId: string,
    studentName: string,
    reactivate = false,
  ) {
    setError(null);
    const r = applyUdiseRowToStudent({
      row,
      studentId,
      reactivate,
      sis,
      masters,
    });
    if (!r.ok) {
      setError(r.error);
      setApplyResult(`Could not apply to ${studentName}: ${r.error}`);
      return;
    }
    saveSis(r.state);
    const msg = `UDISE+ applied to ${studentName}${
      reactivate ? " · reactivated" : ""
    }${r.fields.length ? ` (${r.fields.join(", ")})` : ""}`;
    setApplyResult(msg);
    onApplied(r.state, msg);
    if (matrix) refreshPreview(r.state, matrix);
  }

  function promoteToSession(
    row: UdiseStudentRow,
    sourceStudentId: string,
    studentName: string,
  ) {
    setError(null);
    const r = promoteUdiseRowToSession({
      row,
      sourceStudentId,
      targetAcademicYearCode: academicYearCode || "",
      sis,
      masters,
    });
    if (!r.ok) {
      setError(r.error);
      setApplyResult(`Could not promote ${studentName}: ${r.error}`);
      return;
    }
    saveSis(r.state);
    const msg = `${studentName} ${
      r.created ? `promoted to ${academicYearCode}` : `updated in ${academicYearCode}`
    } from UDISE+${r.fields.length ? ` (${r.fields.join(", ")})` : ""}`;
    setApplyResult(msg);
    onApplied(r.state, msg);
    if (matrix) refreshPreview(r.state, matrix);
  }

  function setStudentStatus(
    studentId: string,
    studentName: string,
    status: "active" | "inactive",
  ) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Mark ${studentName} ${status} in SIS?`)
    ) {
      return;
    }
    setError(null);
    const r = setUdiseStudentStatus({
      studentId,
      status,
      reason: "UDISE+ review",
      sis,
    });
    if (!r.ok) {
      setError(r.error);
      setApplyResult(`Could not mark ${studentName} ${status}: ${r.error}`);
      return;
    }
    saveSis(r.state);
    const msg = `${studentName} marked ${status} in SIS`;
    setApplyResult(msg);
    onApplied(r.state, msg);
    if (matrix) refreshPreview(r.state, matrix);
  }

  function reassignClass(
    studentId: string,
    studentName: string,
    toClassId: string,
  ) {
    if (!toClassId) return;
    const toClass = masters.classes.find((c) => c.id === toClassId);
    const section = masters.sections.find(
      (s) => s.classId === toClassId && s.isActive !== false,
    );
    if (!section) {
      setError(`No active section found for ${toClass?.name || "the class"}`);
      return;
    }
    setError(null);
    const r = upgradeStudentClass({
      studentId,
      toClassId,
      toSectionId: section.id,
      reason: `Age correction (UDISE MBU) → ${toClass?.name || "lower class"}`,
      masters,
      override: true,
    });
    if (!r.ok) {
      setError(r.error);
      setApplyResult(`Could not re-assign ${studentName}: ${r.error}`);
      return;
    }
    saveSis(r.state);
    const msg = `${studentName} re-assigned to ${toClass?.name || "lower class"} (age correction)`;
    setApplyResult(msg);
    onApplied(r.state, msg);
    if (matrix) refreshPreview(r.state, matrix);
  }

  function toggleLock(
    studentId: string,
    studentName: string,
    locked: boolean,
    reason?: string,
  ) {
    setError(null);
    const r = setStudentPromotionLock({ studentId, locked, reason, sis });
    if (!r.ok) {
      setError(r.error);
      setApplyResult(`Could not update ${studentName}: ${r.error}`);
      return;
    }
    saveSis(r.state);
    const msg = locked
      ? `${studentName} locked for promotion (repeat class) — ${r.student.promotionLockReason}`
      : `${studentName} promotion lock removed`;
    setApplyResult(msg);
    onApplied(r.state, msg);
    if (matrix) refreshPreview(r.state, matrix);
  }

  function migrate(p: UdiseMatchPreview) {
    setError(null);
    const r = migrateUdiseRowToSis({
      row: p.udise,
      studentType: migrateType,
      feeGroupId: migrateType === "RTE" ? migrateFeeGroupId || null : migrateFeeGroupId,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    saveSis(r.state);
    onApplied(
      r.state,
      `Migrated ${r.student.fullName} → ${r.student.admissionNo} (${migrateType})`,
    );
    if (matrix) refreshPreview(r.state, matrix);
  }

  return (
    <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div>
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            UDISE+ list → SIS fill / verify / migrate
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            Upload Students_Details.xlsx · colour rows show match status · apply
            fills SIS · verify on portal then tick Verified · suspects can migrate
            (fee required unless RTE).
          </p>
        </div>
        <span className="text-xs font-medium text-[var(--muted)]">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-[rgba(32,48,80,0.08)] px-4 py-3">
          <div className="flex flex-wrap gap-2 text-[10px]">
            {(Object.keys(TONE_LABEL) as UdiseRowTone[]).map((t) => (
              <span
                key={t}
                className={`rounded px-1.5 py-0.5 font-semibold ${TONE_BADGE[t]}`}
              >
                {TONE_LABEL[t]}
              </span>
            ))}
          </div>

          <label className="block text-xs text-[var(--muted)]">
            Students_Details.xlsx
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="mt-1 block w-full max-w-md text-xs"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = "";
                void onFile(f);
              }}
            />
          </label>
          {fileName ? (
            <p className="text-[11px] text-[var(--muted)]">File: {fileName}</p>
          ) : null}
          {!formatOk ? (
            <p className="text-xs text-[#b42318]">
              Header row not recognised — use UDISE+ “List of All Students” export.
            </p>
          ) : null}
          {error ? (
            <p className="rounded-lg bg-[rgba(180,35,24,0.08)] px-3 py-2 text-sm text-[#b42318]">
              {error}
            </p>
          ) : null}

          <div className="rounded-lg border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] p-3">
            <p className="text-xs font-medium text-[var(--brand-deep)]">
              Match SIS ↔ UDISE by
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-[var(--brand-deep)]">
              {(
                [
                  ["usePen", "PEN"],
                  ["useApaar", "APAAR"],
                  ["useAadhaar", "Aadhaar last-4"],
                  ["useNameFather", "Name + father"],
                  ["useNameClass", "Name + class"],
                  ["useNameUnique", "Unique name"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={matchOpts[key]}
                    onChange={(e) =>
                      updateMatchOpts({ ...matchOpts, [key]: e.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
              <label className="flex items-center gap-1.5 font-semibold">
                <input
                  type="checkbox"
                  checked={matchOpts.fuzzy}
                  onChange={(e) =>
                    updateMatchOpts({ ...matchOpts, fuzzy: e.target.checked })
                  }
                />
                Fuzzy names
              </label>
              {matchOpts.fuzzy ? (
                <label className="flex items-center gap-1.5 text-[var(--muted)]">
                  Tolerance
                  <select
                    className="rounded border border-[rgba(32,48,80,0.15)] px-1 py-0.5 text-[11px]"
                    value={String(matchOpts.fuzzyThreshold)}
                    onChange={(e) =>
                      updateMatchOpts({
                        ...matchOpts,
                        fuzzyThreshold: Number(e.target.value),
                      })
                    }
                  >
                    <option value="0.9">Strict (90%)</option>
                    <option value="0.82">Balanced (82%)</option>
                    <option value="0.72">Loose (72%)</option>
                  </select>
                </label>
              ) : null}
            </div>
            <p className="mt-1.5 text-[10px] text-[var(--muted)]">
              Change keys to re-match instantly. Fuzzy tolerates small spelling
              differences in student / father name.
            </p>
          </div>

          {stats ? (
            <div className="flex flex-wrap gap-3 text-xs text-[var(--brand-deep)]">
              <span>Rows {stats.total}</span>
              <span className="text-[#0a4a73]">Fill {stats.fill}</span>
              <span className="text-[#8a5a10]">Verify {stats.verify}</span>
              <span className="text-[#8b1a12]">Suspect {stats.suspect}</span>
              <span className="font-semibold text-[#b42318]">
                MBU age {stats.mbuAge}
              </span>
              <span className="text-[#8a5a10]">
                Class≠UDISE {stats.classMismatch}
              </span>
              <span className="text-[#0f7a4c]">OK {stats.ok}</span>
              {stats.ambiguous ? (
                <span className="text-[#5a2a7a]">Ambiguous {stats.ambiguous}</span>
              ) : null}
              {stats.inactive ? (
                <span className="text-[#333]">Inactive in SIS {stats.inactive}</span>
              ) : null}
            </div>
          ) : null}

          {reconciliation ? (
            <div className="rounded-lg border border-[rgba(138,90,16,0.35)] bg-[rgba(138,90,16,0.06)] p-3">
              <p className="text-xs font-semibold text-[#8a5a10]">
                Portal ↔ SIS reconciliation
                {academicYearCode ? ` · ${academicYearCode}` : ""}
              </p>
              <div className="mt-2 grid gap-x-6 gap-y-1 text-[11px] text-[var(--brand-deep)] sm:grid-cols-2 lg:grid-cols-3">
                <span>
                  Students in portal file:{" "}
                  <strong>{reconciliation.uniqueFilePens || reconciliation.fileRows}</strong>
                  {reconciliation.duplicateFilePens > 0
                    ? ` (${reconciliation.duplicateFilePens} duplicate PEN row${reconciliation.duplicateFilePens === 1 ? "" : "s"})`
                    : ""}
                </span>
                <span className="text-[#0f7a4c]">
                  On UDISE+ now (this year):{" "}
                  <strong>{reconciliation.onUdiseSelectedYear}</strong>
                </span>
                <span className="text-[#8b1a12]">
                  Not in SIS (import as new):{" "}
                  <strong>{reconciliation.unmatchedRows}</strong>
                </span>
                {reconciliation.ambiguousRows > 0 ? (
                  <span className="text-[#5a2a7a]">
                    Ambiguous (needs manual):{" "}
                    <strong>{reconciliation.ambiguousRows}</strong>
                  </span>
                ) : null}
                {reconciliation.matchedButOtherYear > 0 ? (
                  <span className="text-[#8a5a10]">
                    Matched but in another session:{" "}
                    <strong>{reconciliation.matchedButOtherYear}</strong>
                  </span>
                ) : null}
                {reconciliation.matchedButInactive > 0 ? (
                  <span className="text-[#8a5a10]">
                    Matched but inactive/TC:{" "}
                    <strong>{reconciliation.matchedButInactive}</strong>
                  </span>
                ) : null}
                {reconciliation.matchedButPlaceholderPen > 0 ? (
                  <span className="text-[#8a5a10]">
                    Matched, PEN not applied yet (click Apply):{" "}
                    <strong>{reconciliation.matchedButPlaceholderPen}</strong>
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-[10px] text-[var(--muted)]">
                The “on UDISE+” number counts <strong>active SIS students in the
                selected year that carry a PEN</strong>. A portal student is not
                counted if they didn’t match any SIS student (name/father/class
                differs, or not admitted here), if their SIS record is inactive or
                in another session, or if Apply hasn’t been run yet. Use{" "}
                <strong>Apply SIS fills</strong> to write PENs, and{" "}
                <strong>Import all not-in-SIS as new</strong> for the{" "}
                {reconciliation.unmatchedRows} unmatched.
              </p>
            </div>
          ) : null}

          {preview ? (
            <>
              <div className="flex flex-wrap items-end gap-2">
                {(
                  [
                    ["all", "All"],
                    ["fill", "To fill"],
                    ["verify", "Verify"],
                    ["suspect", "Suspect / not in SIS"],
                    ["ambiguous", `Ambiguous (${ambiguousRows.length})`],
                    ["other_session", `Other session (${otherSessionRows.length})`],
                    ["inactive", `Inactive in SIS (${inactiveRows.length})`],
                    ["mbu_age", `MBU age alert (${stats?.mbuAge ?? 0})`],
                    [
                      "class_mismatch",
                      `UDISE class ≠ SIS (${stats?.classMismatch ?? 0})`,
                    ],
                    [
                      "dob_mismatch",
                      `DOB differs (${stats?.dobMismatch ?? 0})`,
                    ],
                    ["ok", "In sync"],
                    ["changes", `Has field updates (${stats?.withChanges ?? 0})`],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-medium ${
                      filter === id
                        ? "bg-[var(--brand-deep)] text-white"
                        : "border border-[rgba(32,48,80,0.15)] bg-white text-[var(--brand-deep)]"
                    }`}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  disabled={busy || justApplied || !stats?.withChanges}
                  onClick={applySync}
                >
                  {busy
                    ? "Working…"
                    : justApplied
                      ? "Applied ✓"
                      : `Apply SIS fills (${stats?.withChanges ?? 0})`}
                </button>
                {!stats?.withChanges ? (
                  <span className="text-[11px] text-[var(--muted)]">
                    No pending field updates to apply (all matched rows already in
                    sync).
                  </span>
                ) : null}
              </div>

              {applyResult ? (
                <p className="rounded-lg bg-[rgba(15,122,76,0.1)] px-3 py-2 text-xs text-[#0f7a4c]">
                  {applyResult}
                </p>
              ) : null}

              <div className="rounded-lg border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] p-3">
                <p className="text-xs font-medium text-[var(--brand-deep)]">
                  Migrate defaults (for Not in SIS rows)
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <label className="text-xs text-[var(--muted)]">
                    Student type
                    <select
                      className="mt-0.5 block rounded-lg border border-[rgba(32,48,80,0.15)] px-2 py-1 text-sm"
                      value={migrateType}
                      onChange={(e) =>
                        setMigrateType(e.target.value as FeeStudentType)
                      }
                    >
                      {STUDENT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-[var(--muted)]">
                    Fee group {migrateType !== "RTE" ? "(required)" : "(RTE auto)"}
                    <select
                      className="mt-0.5 block min-w-[180px] rounded-lg border border-[rgba(32,48,80,0.15)] px-2 py-1 text-sm"
                      value={migrateFeeGroupId}
                      onChange={(e) => setMigrateFeeGroupId(e.target.value)}
                    >
                      <option value="">
                        {migrateType === "RTE"
                          ? "Auto RTE group"
                          : "Select fee group…"}
                      </option>
                      {feeGroups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} · {g.studentType}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-[var(--muted)]">
                    Fallback class (unmapped UDISE)
                    <select
                      className="mt-0.5 block min-w-[150px] rounded-lg border border-[rgba(32,48,80,0.15)] px-2 py-1 text-sm"
                      value={fallbackClassId}
                      onChange={(e) => setFallbackClassId(e.target.value)}
                    >
                      <option value="">Only if UDISE class maps</option>
                      {activeClasses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {migrateType !== "RTE" ? (
                  <p className="mt-1 text-[10px] text-[#8b1a12]">
                    Non-RTE migrate without fee group is blocked.
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--brand-deep)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-50"
                    disabled={busy || !stats?.suspect}
                    onClick={importUnmatched}
                    title="Create new SIS students for every UDISE row not found in SIS"
                  >
                    {busy
                      ? "Working…"
                      : `Import all not-in-SIS as new (${stats?.suspect ?? 0})`}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[#8a5a10] bg-white px-3 py-1.5 text-xs font-semibold text-[#8a5a10] disabled:opacity-50"
                    disabled={busy || !stats?.suspect}
                    onClick={exportUnmatchedRows}
                    title="Download the UDISE+ rows that did not match any SIS student"
                  >
                    Export not-in-SIS ({stats?.suspect ?? 0})
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[#5a2a7a] bg-white px-3 py-1.5 text-xs font-semibold text-[#5a2a7a] disabled:opacity-50"
                    disabled={busy || !ambiguousRows.length}
                    onClick={() =>
                      exportPreviewCsv(
                        ambiguousRows,
                        "udise_ambiguous",
                        "ambiguous",
                      )
                    }
                    title="Portal rows matching more than one SIS record (merge duplicates)"
                  >
                    Export ambiguous ({ambiguousRows.length})
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[#8a5a10] bg-white px-3 py-1.5 text-xs font-semibold text-[#8a5a10] disabled:opacity-50"
                    disabled={busy || !otherSessionRows.length}
                    onClick={() =>
                      exportPreviewCsv(
                        otherSessionRows,
                        "udise_other_session",
                        "other-session",
                      )
                    }
                    title="Matched students whose SIS record is in another academic session"
                  >
                    Export other session ({otherSessionRows.length})
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[#555] bg-white px-3 py-1.5 text-xs font-semibold text-[#333] disabled:opacity-50"
                    disabled={busy || !inactiveRows.length}
                    onClick={() =>
                      exportPreviewCsv(
                        inactiveRows,
                        "udise_inactive_in_sis",
                        "inactive-in-SIS",
                      )
                    }
                    title="Portal students that exist in SIS but are inactive (any session)"
                  >
                    Export inactive in SIS ({inactiveRows.length})
                  </button>
                  <span className="text-[10px] text-[var(--muted)]">
                    Uses the type / fee group / fallback class above. Rows whose
                    class can’t be resolved are skipped and reported. Export to
                    review which portal students are causing the gap.
                  </span>
                </div>
              </div>

              <div className="max-h-[28rem] overflow-auto rounded-lg border border-[rgba(32,48,80,0.1)]">
                <table className="min-w-[1100px] w-full border-collapse text-left text-[11px]">
                  <thead>
                    <tr className="sticky top-0 border-b border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.06)] text-[var(--muted)]">
                      <th className="px-2 py-1.5 font-medium">Status</th>
                      <th className="px-2 py-1.5 font-medium">UDISE student</th>
                      <th className="px-2 py-1.5 font-medium">
                        Class · Aadhaar validation · MBU
                      </th>
                      <th className="px-2 py-1.5 font-medium">SIS (filled)</th>
                      <th className="px-2 py-1.5 font-medium">Will fill / hint</th>
                      <th className="px-2 py-1.5 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.slice(0, 250).map((p) => (
                      <tr
                        key={`${p.rowIndex}-${p.udise.pen}-${p.udise.fullName}`}
                        className={`border-b border-[rgba(32,48,80,0.06)] align-top ${TONE_ROW[p.tone]}`}
                      >
                        <td className="px-2 py-2">
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${TONE_BADGE[p.tone]}`}
                          >
                            {TONE_LABEL[p.tone]}
                          </span>
                          {p.portalSuspect ? (
                            <span className="mt-1 block text-[10px] font-semibold text-[#8b1a12]">
                              Portal suspected duplicate
                            </span>
                          ) : null}
                          {p.mbuAgeAlert ? (
                            <span className="mt-1 block text-[10px] font-bold text-[#b42318]">
                              Notify: age below for class (govt MBU)
                            </span>
                          ) : null}
                          {p.classMismatch ? (
                            <span className="mt-1 block text-[10px] font-semibold text-[#8a5a10]">
                              UDISE+ class likely wrong
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">
                          <p className="font-semibold text-[var(--brand-deep)]">
                            {p.udise.fullName}
                          </p>
                          {p.udise.aadhaarName &&
                          !/not available/i.test(p.udise.aadhaarName) ? (
                            <p className="text-[10px] text-[var(--muted)]">
                              As per Aadhaar: {p.udise.aadhaarName}
                            </p>
                          ) : null}
                          <p className="text-[var(--muted)]">
                            F: {p.udise.fatherName || "—"}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px]">
                            PEN {p.udise.pen || "—"} · APAAR{" "}
                            {p.udise.apaarId || "—"}
                          </p>
                        </td>
                        <td className="px-2 py-2 text-[10px]">
                          <div>
                            <span className="font-medium">UDISE+ class:</span>{" "}
                            {p.udiseClassHint}
                          </div>
                          <div>
                            <span className="font-medium">SIS class:</span>{" "}
                            {p.sisClassLabel}{" "}
                            <span className="text-[var(--muted)]">
                              (never overwritten)
                            </span>
                          </div>
                          <div className="mt-1">
                            Aadhaar validation:{" "}
                            <span
                              className={
                                /^verified$/i.test(p.aadhaarValidationStatus)
                                  ? "font-semibold text-[#0f7a4c]"
                                  : /fail/i.test(p.aadhaarValidationStatus)
                                    ? "font-semibold text-[#b42318]"
                                    : ""
                              }
                            >
                              {p.aadhaarValidationStatus}
                            </span>
                          </div>
                          <div>
                            MBU:{" "}
                            <span
                              className={
                                p.mbuAgeAlert
                                  ? "font-bold text-[#b42318]"
                                  : ""
                              }
                            >
                              {p.mbuStatus}
                            </span>
                          </div>
                          {p.udiseDob || p.sisDob ? (
                            <div
                              className={
                                p.dobMismatch
                                  ? "mt-1 font-semibold text-[#b42318]"
                                  : "mt-1"
                              }
                            >
                              DOB — SIS {p.sisDob || "—"} · UDISE+{" "}
                              {p.udiseDob || "—"}
                              {p.dobMismatch ? " ⚠ differs" : ""}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">
                          {p.studentId ? (
                            <>
                              <Link
                                href={`/students/${p.studentId}/edit`}
                                className="font-medium text-[var(--brand-deep)] underline"
                              >
                                {p.matchedName}
                              </Link>
                              <span className="block text-[var(--muted)]">
                                {p.admissionNo}
                              </span>
                              <p className="mt-0.5 text-[10px]">
                                Session:{" "}
                                <span
                                  className={
                                    ayNorm(p.sisSession) !==
                                    ayNorm(academicYearCode || "")
                                      ? "font-semibold text-[#8a5a10]"
                                      : ""
                                  }
                                >
                                  {p.sisSession || "—"}
                                </span>{" "}
                                ·{" "}
                                <span
                                  className={
                                    p.sisInactive
                                      ? "font-semibold text-[#8b1a12]"
                                      : "text-[#0f7a4c]"
                                  }
                                >
                                  {p.sisStatus || "—"}
                                </span>
                              </p>
                              <p className="mt-1 text-[10px]">
                                SIS PEN: {p.sisFilled.pen || "—"}
                                <br />
                                SIS APAAR: {p.sisFilled.apaarId || "—"}
                                <br />
                                SIS Aadhaar: {p.sisFilled.aadhaar || "—"}
                                {p.sisFilled.aadhaarVerification ===
                                "verified_udise"
                                  ? " · Verified by UDISE+"
                                  : p.sisFilled.aadhaarVerification ===
                                      "received"
                                    ? " · received"
                                    : ""}
                              </p>
                            </>
                          ) : p.method === "ambiguous" ? (
                            <div className="space-y-1.5">
                              <p className="text-[10px] font-semibold text-[#5a2a7a]">
                                Matches {" "}
                                {findUdiseMatchCandidates(
                                  p.udise,
                                  sis,
                                  masters,
                                ).length}{" "}
                                SIS records — pick the correct one:
                              </p>
                              {findUdiseMatchCandidates(
                                p.udise,
                                sis,
                                masters,
                              ).map((c) => (
                                <div
                                  key={c.student.id}
                                  className="rounded border border-[rgba(100,60,140,0.25)] bg-white px-1.5 py-1"
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <Link
                                      href={`/students/${c.student.id}/edit`}
                                      className="font-medium text-[var(--brand-deep)] underline"
                                    >
                                      {c.student.fullName}
                                    </Link>
                                    <span
                                      className={`text-[9px] font-semibold ${
                                        c.student.status === "active"
                                          ? "text-[#0f7a4c]"
                                          : "text-[#8b1a12]"
                                      }`}
                                    >
                                      {c.student.status}
                                    </span>
                                  </div>
                                  <p className="text-[9px] text-[var(--muted)]">
                                    {c.student.admissionNo} · {c.classLabel} ·{" "}
                                    {c.student.academicYearCode || "—"}
                                  </p>
                                  <p className="text-[9px] text-[#5a2a7a]">
                                    F: {c.student.fatherName || "—"} ·{" "}
                                    {c.reasons.join(", ")}
                                  </p>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    <button
                                      type="button"
                                      className="rounded bg-[#5a2a7a] px-2 py-0.5 text-[10px] font-semibold text-white"
                                      onClick={() =>
                                        applyRowToStudent(
                                          p.udise,
                                          c.student.id,
                                          c.student.fullName,
                                          c.student.status !== "active",
                                        )
                                      }
                                    >
                                      Apply UDISE here
                                      {c.student.status !== "active"
                                        ? " + reactivate"
                                        : ""}
                                    </button>
                                    {c.student.status === "active" ? (
                                      <button
                                        type="button"
                                        className="rounded border border-[#b0344b] px-2 py-0.5 text-[10px] font-semibold text-[#b0344b]"
                                        onClick={() =>
                                          setStudentStatus(
                                            c.student.id,
                                            c.student.fullName,
                                            "inactive",
                                          )
                                        }
                                      >
                                        Make inactive
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        className="rounded border border-[#0f7a4c] px-2 py-0.5 text-[10px] font-semibold text-[#0f7a4c]"
                                        onClick={() =>
                                          setStudentStatus(
                                            c.student.id,
                                            c.student.fullName,
                                            "active",
                                          )
                                        }
                                      >
                                        Make active
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[#8b1a12]">{p.note}</span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {p.fillLabels.length ? (
                            <ul className="list-disc pl-3 text-[#0a4a73]">
                              {p.fillLabels.map((l) => (
                                <li key={l}>{l}</li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-[var(--muted)]">—</span>
                          )}
                          <p className="mt-1 text-[10px] font-medium text-[var(--brand-deep)]">
                            {p.actionHint}
                          </p>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex min-w-[130px] flex-col gap-1">
                            {(() => {
                              if (!p.mbuAgeAlert || !p.studentId || p.sisInactive)
                                return null;
                              const mbuStudent = sis.students.find(
                                (s) => s.id === p.studentId,
                              );
                              if (!mbuStudent || mbuStudent.status !== "active")
                                return null;
                              return (
                                <MbuAgeActions
                                  student={mbuStudent}
                                  masters={masters}
                                  academicYearCode={academicYearCode}
                                  onReassign={reassignClass}
                                  onLock={toggleLock}
                                />
                              );
                            })()}
                            {p.studentId && p.sisInactive ? (
                              <button
                                type="button"
                                className="rounded-lg bg-[#8a5a10] px-2 py-1 text-[11px] font-semibold text-white"
                                onClick={() =>
                                  applyRowToStudent(
                                    p.udise,
                                    p.studentId!,
                                    p.matchedName,
                                    true,
                                  )
                                }
                                title="Reactivate this student and fill UDISE data"
                              >
                                Reactivate & apply
                              </button>
                            ) : null}
                            {p.studentId &&
                            !p.sisInactive &&
                            ayNorm(p.sisSession) !==
                              ayNorm(academicYearCode || "") ? (
                              <>
                                <button
                                  type="button"
                                  className="rounded-lg bg-[var(--brand-deep)] px-2 py-1 text-[11px] font-semibold text-white"
                                  onClick={() =>
                                    promoteToSession(
                                      p.udise,
                                      p.studentId!,
                                      p.matchedName,
                                    )
                                  }
                                  title={`Create a ${academicYearCode} enrollment for this student and apply UDISE data`}
                                >
                                  Promote to {academicYearCode || "current"} &
                                  apply
                                </button>
                                <button
                                  type="button"
                                  className="rounded-lg border border-[#8a5a10] px-2 py-1 text-[11px] font-semibold text-[#8a5a10]"
                                  onClick={() =>
                                    applyRowToStudent(
                                      p.udise,
                                      p.studentId!,
                                      p.matchedName,
                                    )
                                  }
                                  title="Write UDISE data onto the existing other-session record (does not move the student to this year)"
                                >
                                  Apply to {p.sisSession || "this"} record only
                                </button>
                              </>
                            ) : null}
                            {p.studentId &&
                            !p.sisInactive &&
                            p.fillLabels.length &&
                            ayNorm(p.sisSession) ===
                              ayNorm(academicYearCode || "") ? (
                              <button
                                type="button"
                                className="rounded-lg bg-[var(--brand-deep)] px-2 py-1 text-[11px] font-medium text-white"
                                onClick={() =>
                                  applyRowToStudent(
                                    p.udise,
                                    p.studentId!,
                                    p.matchedName,
                                  )
                                }
                                title="Write UDISE data onto this student"
                              >
                                Apply UDISE here
                              </button>
                            ) : null}
                            {p.studentId &&
                            !p.sisInactive &&
                            (p.tone === "verify" ||
                              p.tone === "fill" ||
                              p.tone === "ok" ||
                              p.tone === "mbu_age") ? (
                              <button
                                type="button"
                                className="rounded-lg border border-[rgba(15,122,76,0.4)] bg-white px-2 py-1 text-[11px] font-medium text-[#0f7a4c]"
                                onClick={() => tickVerified(p)}
                              >
                                ✓ Tick verified
                              </button>
                            ) : null}
                            {p.tone === "suspect" ? (
                              <button
                                type="button"
                                className="rounded-lg bg-[var(--brand-deep)] px-2 py-1 text-[11px] font-medium text-white"
                                onClick={() => migrate(p)}
                              >
                                Migrate to SIS
                              </button>
                            ) : null}
                            {p.studentId ? (
                              p.sisInactive ? (
                                <button
                                  type="button"
                                  className="rounded-lg border border-[#0f7a4c] px-2 py-1 text-[11px] font-semibold text-[#0f7a4c]"
                                  onClick={() =>
                                    setStudentStatus(
                                      p.studentId!,
                                      p.matchedName,
                                      "active",
                                    )
                                  }
                                  title="Reactivate this student in SIS"
                                >
                                  Make active
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="rounded-lg border border-[#b0344b] px-2 py-1 text-[11px] font-semibold text-[#b0344b]"
                                  onClick={() =>
                                    setStudentStatus(
                                      p.studentId!,
                                      p.matchedName,
                                      "inactive",
                                    )
                                  }
                                  title="Mark this student inactive in SIS (left / TC / not enrolled)"
                                >
                                  Make inactive
                                </button>
                              )
                            ) : null}
                            {p.studentId ? (
                              <Link
                                href={`/students/${p.studentId}/edit?tab=ids`}
                                className="text-[10px] text-[var(--brand-deep)] underline"
                              >
                                Open in SIS
                              </Link>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!visible.length ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-3 py-4 text-center text-[var(--muted)]"
                        >
                          No rows in this filter.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-[var(--muted)]">
                Student Aadhaar verified ≠ APAAR ready. APAAR on UDISE+ also needs
                parent Aadhaar, then generation on the portal — re-upload /
                Apply to fill APAAR when it appears. Use{" "}
                <strong>Tick verified</strong> for student Aadhaar after portal
                verification. PEN locks when verified + PEN present; APAAR locks
                only once the APAAR ID is filled.
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
