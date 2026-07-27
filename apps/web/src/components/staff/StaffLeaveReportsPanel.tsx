"use client";

import { useEffect, useMemo, useState } from "react";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadStaffAttendance } from "@/lib/staffAttendance";
import { loadStaffHr, type LeaveStatus } from "@/lib/staffHr";
import {
  attendanceReportDefs,
  leaveReportDefs,
  reportNeedsStaff,
  runStaffLeaveReport,
  type StaffLeaveReportId,
} from "@/lib/staffLeaveReportCatalog";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function thisMonth() {
  return todayIso().slice(0, 7);
}

export type StaffReportsScope = "leave" | "attendance";

export function StaffLeaveReportsPanel({
  ay,
  scope = "leave",
}: {
  ay: string;
  /** leave = Staff → Reports; attendance = Attendance → Reports */
  scope?: StaffReportsScope;
}) {
  const reports = useMemo(
    () => (scope === "attendance" ? attendanceReportDefs() : leaveReportDefs()),
    [scope],
  );
  const defaultId = (reports[0]?.id ??
    "staff_on_leave_today") as StaffLeaveReportId;

  const [masters, setMasters] = useState<MastersState | null>(null);
  const [reportId, setReportId] = useState<StaffLeaveReportId>(defaultId);
  const [date, setDate] = useState(todayIso);
  const [fromDate, setFromDate] = useState(() => `${ay.slice(0, 4)}-04-01`);
  const [toDate, setToDate] = useState(todayIso);
  const [month, setMonth] = useState(thisMonth);
  const [staffId, setStaffId] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [status, setStatus] = useState<"all" | LeaveStatus>("all");
  const [departmentId, setDepartmentId] = useState("");
  const [stream, setStream] = useState<"" | "teaching" | "non_teaching">("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    columns: { key: string; header: string }[];
    rows: Record<string, string | number | null | undefined>[];
  } | null>(null);

  useEffect(() => {
    setMasters(loadMasters());
  }, []);

  useEffect(() => {
    if (!reports.some((r) => r.id === reportId)) {
      setReportId(defaultId);
    }
  }, [reports, reportId, defaultId]);

  const def = useMemo(
    () => reports.find((r) => r.id === reportId) ?? reports[0],
    [reports, reportId],
  );

  const hrTypes = useMemo(() => loadStaffHr().leaveTypes, [masters]);

  const roster = useMemo(() => {
    if (!masters) return [];
    return (masters.staff ?? [])
      .filter((s) => s.status === "active")
      .sort((a, b) => a.empCode.localeCompare(b.empCode));
  }, [masters]);

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
      staffId: staffId || undefined,
      leaveType: leaveType || undefined,
      status,
      departmentId: departmentId || undefined,
      stream: stream || undefined,
      masters: masters ?? undefined,
      hr: loadStaffHr(),
      attendance: loadStaffAttendance(),
    };
  }

  function onPreview() {
    if (!def) return;
    if (reportNeedsStaff(def.id) && !staffId) {
      flash("Select a staff member for this report", true);
      return;
    }
    const result = runStaffLeaveReport(def.id, {
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
    if (!def) return;
    if (reportNeedsStaff(def.id) && !staffId) {
      flash("Select a staff member for this report", true);
      return;
    }
    const result = runStaffLeaveReport(def.id, {
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
    if (!masters || !def) return;
    if (reportNeedsStaff(def.id) && !staffId) {
      setPreview(null);
      return;
    }
    const result = runStaffLeaveReport(def.id, {
      ...filterPayload(),
      format: "preview",
    });
    if (result.ok && result.preview) setPreview(result.preview);
    else setPreview(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, masters, ay, scope]);

  if (!masters || !def) {
    return <p className="text-sm text-[var(--muted)]">Loading reports…</p>;
  }

  const needs = new Set(def.filters);
  const panelTitle =
    scope === "attendance" ? "Attendance reports" : "Leave reports";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(240px,280px)_minmax(0,1fr)]">
      <aside className="rounded-xl border border-[rgba(32,48,80,0.14)] bg-white overflow-hidden">
        <div className="border-b border-[rgba(32,48,80,0.08)] px-3 py-2.5">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            {panelTitle}
          </h2>
          <p className="text-[11px] text-[var(--muted)]">AY {ay}</p>
        </div>
        <nav className="max-h-[min(70vh,640px)] overflow-y-auto py-1">
          <ul>
            {reports.map((r) => {
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
            {needs.has("staff") ? (
              <label className="block text-sm min-w-[200px]">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Staff{reportNeedsStaff(def.id) ? " *" : " (optional)"}
                </span>
                <select
                  className="field !py-1.5"
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                >
                  <option value="">
                    {reportNeedsStaff(def.id) ? "Select…" : "All staff"}
                  </option>
                  {roster.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.empCode} · {s.fullName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {needs.has("leaveType") ? (
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Leave type
                </span>
                <select
                  className="field !py-1.5"
                  value={leaveType}
                  onChange={(e) => setLeaveType(e.target.value)}
                >
                  <option value="">All types</option>
                  {hrTypes.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.code} — {t.name}
                    </option>
                  ))}
                </select>
              </label>
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
                    setStatus(e.target.value as "all" | LeaveStatus)
                  }
                >
                  <option value="all">All</option>
                  <option value="pending">Pending</option>
                  <option value="pending_l2">Pending L2</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>
            ) : null}
            {needs.has("department") ? (
              <label className="block text-sm min-w-[160px]">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Department
                </span>
                <select
                  className="field !py-1.5"
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                >
                  <option value="">All</option>
                  {(masters.departments ?? [])
                    .filter((d) => d.isActive)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            {needs.has("stream") ? (
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Stream
                </span>
                <select
                  className="field !py-1.5"
                  value={stream}
                  onChange={(e) =>
                    setStream(
                      e.target.value as "" | "teaching" | "non_teaching",
                    )
                  }
                >
                  <option value="">All</option>
                  <option value="teaching">Teaching</option>
                  <option value="non_teaching">Non-teaching</option>
                </select>
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
          <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(32,48,80,0.08)] px-4 py-3">
              <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                {preview.title}
              </h3>
              <span className="text-[11px] text-[var(--muted)]">
                {preview.rows.length} row{preview.rows.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="overflow-x-auto max-h-[min(55vh,520px)]">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 bg-[rgba(32,48,80,0.04)] text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  <tr>
                    {preview.columns.map((c) => (
                      <th key={c.key} className="px-3 py-2 whitespace-nowrap">
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr
                      key={i}
                      className="border-t border-[rgba(32,48,80,0.06)]"
                    >
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
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            Select filters and run the report to preview.
          </p>
        )}
      </div>
    </div>
  );
}

export function StaffAttendanceReportsPanel({ ay }: { ay: string }) {
  return <StaffLeaveReportsPanel ay={ay} scope="attendance" />;
}
