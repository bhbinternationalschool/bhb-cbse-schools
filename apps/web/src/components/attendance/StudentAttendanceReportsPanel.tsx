"use client";
// ratchet-allow: grids_without_row_menu — report output with dynamic columns; rows are aggregates, not records

import { useEffect, useMemo, useState } from "react";
import { ATTENDANCE_STATUSES, loadAttendance, type AttendanceStatus } from "@/lib/attendance";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import {
  STUDENT_ATT_REPORTS,
  runStudentAttReport,
  studentReportNeedsStudent,
  type StudentAttReportId,
} from "@/lib/studentAttendanceReportCatalog";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function thisMonth() {
  return todayIso().slice(0, 7);
}

export function StudentAttendanceReportsPanel({ ay }: { ay: string }) {
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [reportId, setReportId] = useState<StudentAttReportId>("day_wise");
  const [date, setDate] = useState(todayIso);
  const [fromDate, setFromDate] = useState(() => `${ay.slice(0, 4)}-04-01`);
  const [toDate, setToDate] = useState(todayIso);
  const [month, setMonth] = useState(thisMonth);
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [status, setStatus] = useState<"all" | AttendanceStatus>("all");
  const [gender, setGender] = useState<"" | "M" | "F" | "O">("");
  const [maxPercent, setMaxPercent] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    columns: { key: string; header: string }[];
    rows: Record<string, string | number | null | undefined>[];
  } | null>(null);

  useEffect(() => {
    setMasters(loadMasters());
    setSis(loadSis());
  }, []);

  const def = useMemo(
    () => STUDENT_ATT_REPORTS.find((r) => r.id === reportId)!,
    [reportId],
  );

  const classOptions = useMemo(() => {
    if (!masters) return [];
    return masters.classes.filter((c) => c.isActive);
  }, [masters]);

  const sectionOptions = useMemo(() => {
    if (!masters || !classId) return [];
    return masters.sections.filter((s) => s.isActive && s.classId === classId);
  }, [masters, classId]);

  useEffect(() => {
    if (sectionId && !sectionOptions.some((s) => s.id === sectionId)) {
      setSectionId("");
    }
  }, [sectionId, sectionOptions]);

  const studentHits = useMemo(() => {
    if (!sis) return [];
    const q = studentQuery.trim().toLowerCase();
    let list = (sis.students ?? []).filter((s) => s.status === "active");
    if (classId) list = list.filter((s) => s.classId === classId);
    if (sectionId) list = list.filter((s) => s.sectionId === sectionId);
    if (ay) {
      list = list.filter(
        (s) => !s.academicYearCode || s.academicYearCode === ay,
      );
    }
    if (q) {
      list = list.filter((s) =>
        [s.admissionNo, s.fullName, s.rollNo]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return list
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .slice(0, 40);
  }, [sis, classId, sectionId, ay, studentQuery]);

  function flash(msg: string, isErr = false) {
    if (isErr) {
      setError(msg);
      setNotice(null);
    } else {
      setNotice(msg);
      setError(null);
    }
    window.setTimeout(() => {
      setNotice(null);
      setError(null);
    }, 3200);
  }

  function filterPayload() {
    return {
      academicYearCode: ay,
      date,
      fromDate,
      toDate,
      month,
      classId: classId || undefined,
      sectionId: sectionId || undefined,
      studentId: studentId || undefined,
      status,
      gender: gender || undefined,
      maxPercent: maxPercent.trim() ? Number(maxPercent) : undefined,
      masters: masters ?? undefined,
      sis: sis ?? undefined,
      attendance: loadAttendance(),
    };
  }

  function onPreview() {
    if (studentReportNeedsStudent(reportId) && !studentId) {
      flash("Select a student for this report", true);
      return;
    }
    const result = runStudentAttReport(reportId, {
      ...filterPayload(),
      format: "preview",
    });
    if (!result.ok) {
      flash(result.error, true);
      setPreview(null);
      return;
    }
    setPreview(result.preview ?? null);
    flash(result.message);
  }

  function onExport(format: "excel" | "pdf") {
    if (studentReportNeedsStudent(reportId) && !studentId) {
      flash("Select a student for this report", true);
      return;
    }
    const result = runStudentAttReport(reportId, {
      ...filterPayload(),
      format,
    });
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    if (result.preview) setPreview(result.preview);
    flash(result.message);
  }

  useEffect(() => {
    if (!masters || !sis) return;
    if (studentReportNeedsStudent(reportId) && !studentId) {
      setPreview(null);
      return;
    }
    const result = runStudentAttReport(reportId, {
      ...filterPayload(),
      format: "preview",
    });
    if (result.ok && result.preview) setPreview(result.preview);
    else setPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, masters, sis, ay]);

  if (!masters || !sis) {
    return <p className="text-sm text-[var(--muted)]">Loading reports…</p>;
  }

  const needs = new Set(def.filters);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(240px,280px)_minmax(0,1fr)]">
      <aside className="rounded-xl border border-[rgba(32,48,80,0.14)] bg-white overflow-hidden">
        <div className="border-b border-[rgba(32,48,80,0.08)] px-3 py-2.5">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Student attendance reports
          </h2>
          <p className="text-[11px] text-[var(--muted)]">AY {ay}</p>
        </div>
        <nav className="max-h-[min(70vh,640px)] overflow-y-auto py-1">
          <ul>
            {STUDENT_ATT_REPORTS.map((r) => {
              const active = reportId === r.id;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setReportId(r.id)}
                    className={`block w-full px-4 py-2 text-left text-sm ${
                      active
                        ? "bg-[rgba(32,48,80,0.08)] font-semibold text-[var(--brand-deep)]"
                        : "text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.04)]"
                    }`}
                  >
                    {r.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <div className="space-y-4 min-w-0">
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <h2 className="text-base font-bold text-[var(--brand-deep)]">
            {def.label}
          </h2>
          {def.hint ? (
            <p className="mt-0.5 text-[12px] text-[var(--muted)]">{def.hint}</p>
          ) : null}

          {error ? (
            <p className="mt-3 rounded-lg bg-[#fee2e2] px-3 py-2 text-sm font-medium text-[#b91c1c]">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="mt-3 rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]">
              {notice}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            {needs.has("date") ? (
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Date
                </span>
                <input
                  type="date"
                  className="field !py-1.5"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            ) : null}
            {needs.has("fromTo") ? (
              <>
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    From
                  </span>
                  <input
                    type="date"
                    className="field !py-1.5"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    To
                  </span>
                  <input
                    type="date"
                    className="field !py-1.5"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                  />
                </label>
              </>
            ) : null}
            {needs.has("month") ? (
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Month
                </span>
                <input
                  type="month"
                  className="field !py-1.5"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                />
              </label>
            ) : null}
            {needs.has("class") ? (
              <label className="block text-sm min-w-[140px]">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Class
                </span>
                <select
                  className="field !py-1.5"
                  value={classId}
                  onChange={(e) => {
                    setClassId(e.target.value);
                    setSectionId("");
                  }}
                >
                  <option value="">All classes</option>
                  {classOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {needs.has("section") ? (
              <label className="block text-sm min-w-[120px]">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Section
                </span>
                <select
                  className="field !py-1.5"
                  value={sectionId}
                  onChange={(e) => setSectionId(e.target.value)}
                  disabled={!classId}
                >
                  <option value="">All sections</option>
                  {sectionOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {needs.has("student") ? (
              <div className="min-w-[220px] space-y-1">
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Student{studentReportNeedsStudent(reportId) ? " *" : " (optional)"}
                  </span>
                  <input
                    className="field !py-1.5 mb-1"
                    placeholder="Search name / adm no…"
                    value={studentQuery}
                    onChange={(e) => setStudentQuery(e.target.value)}
                  />
                  <select
                    className="field !py-1.5"
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value)}
                  >
                    <option value="">
                      {studentReportNeedsStudent(reportId)
                        ? "Select…"
                        : "All students"}
                    </option>
                    {studentHits.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.admissionNo} · {s.fullName}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            {needs.has("status") ? (
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Status
                </span>
                <select
                  className="field !py-1.5"
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as "all" | AttendanceStatus)
                  }
                >
                  <option value="all">All</option>
                  {ATTENDANCE_STATUSES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.short} — {s.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {needs.has("gender") ? (
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Gender
                </span>
                <select
                  className="field !py-1.5"
                  value={gender}
                  onChange={(e) =>
                    setGender(e.target.value as "" | "M" | "F" | "O")
                  }
                >
                  <option value="">All</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="O">Other</option>
                </select>
              </label>
            ) : null}
            {needs.has("percentBand") ? (
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  At or below %
                </span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className="field !py-1.5"
                  placeholder="e.g. 75"
                  value={maxPercent}
                  onChange={(e) => setMaxPercent(e.target.value)}
                />
              </label>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-xs font-bold text-white"
              onClick={onPreview}
            >
              Run report
            </button>
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.2)] px-4 py-2 text-xs font-bold text-[var(--brand-deep)]"
              onClick={() => onExport("excel")}
            >
              Excel
            </button>
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.2)] px-4 py-2 text-xs font-bold text-[var(--brand-deep)]"
              onClick={() => onExport("pdf")}
            >
              PDF
            </button>
          </div>
        </div>

        {preview ? (
          <ErpTableShell exportAs="attendance_report" exportTitle="Attendance report">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
              <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                {preview.title}
              </h3>
              <span className="text-[11px] text-[var(--muted)]">
                {preview.rows.length} row{preview.rows.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="overflow-x-auto max-h-[min(55vh,520px)]">
              <ErpTable>
                <ErpTableHead sticky>
                  <tr>
                    {preview.columns.map((c) => (
                      <th key={c.key} className="px-3 py-2 whitespace-nowrap">
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {preview.rows.map((row, i) => (
                    <tr key={i}>
                      {preview.columns.map((c) => (
                        <td
                          key={c.key}
                          className="px-3 py-1.5 whitespace-nowrap text-xs"
                        >
                          {row[c.key] == null || row[c.key] === ""
                            ? "—"
                            : String(row[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {preview.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={preview.columns.length}
                        className="px-4 py-8 text-center text-sm text-[var(--muted)]"
                      >
                        No rows for these filters
                      </td>
                    </tr>
                  ) : null}
                </ErpTableBody>
              </ErpTable>
            </div>
          </ErpTableShell>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            Select filters and run the report to preview.
          </p>
        )}
      </div>
    </div>
  );
}
