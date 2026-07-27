"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarOff } from "lucide-react";
import { useDemoSession } from "@/components/shell/SessionContext";
import { ModuleTabs, type ModuleTabItem } from "@/components/ui/ModuleTabs";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { useModuleTabQuery } from "@/lib/useModuleTabQuery";
import {
  cancelStudentLeaveRequest,
  createStudentLeaveRequest,
  decideStudentLeave,
  leaveDayCount,
  leaveTypeLabel,
  loadStudentLeave,
  pendingApproverHint,
  runStudentLeaveReport,
  STUDENT_LEAVE_REPORTS,
  STUDENT_LEAVE_TYPES,
  type StudentLeaveReportId,
  type StudentLeaveRequest,
  type StudentLeaveState,
  type StudentLeaveType,
} from "@/lib/studentLeave";

type LeaveTab = "dashboard" | "pending" | "all" | "apply" | "reports";

const TABS: ModuleTabItem[] = [
  { id: "dashboard", label: "Dashboard", tone: "navy" },
  { id: "pending", label: "Pending", tone: "amber" },
  { id: "all", label: "All", tone: "navy" },
  { id: "apply", label: "Apply (staff)", tone: "teal" },
  { id: "reports", label: "Reports", tone: "slate" },
];

const field =
  "rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-2.5 py-1.5 text-sm text-[var(--brand-deep)]";
const btn =
  "rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
const btnOutline =
  "rounded-lg border border-[rgba(32,48,80,0.2)] bg-white px-3 py-1.5 text-sm text-[var(--brand-deep)]";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  return `${todayIso().slice(0, 7)}-01`;
}

function classLabel(
  masters: MastersState,
  classId: string,
  sectionId: string,
): string {
  const c = masters.classes.find((x) => x.id === classId);
  const s = masters.sections.find((x) => x.id === sectionId);
  return [c?.name, s?.name].filter(Boolean).join(" · ") || "—";
}

function RequestRow({
  req,
  masters,
  sis,
  actorName,
  onRefresh,
  onFlash,
  onError,
  showActions,
}: {
  req: StudentLeaveRequest;
  masters: MastersState;
  sis: SisState;
  actorName: string;
  onRefresh: () => void;
  onFlash: (msg: string) => void;
  onError: (msg: string) => void;
  showActions: boolean;
}) {
  const student = sis.students.find((s) => s.id === req.studentId);
  return (
    <li className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            {student?.fullName || req.studentId}
          </p>
          <p className="text-xs text-[var(--muted)]">
            {student
              ? classLabel(masters, student.classId, student.sectionId)
              : ""}{" "}
            · {leaveTypeLabel(req.leaveType)} · {req.fromDate}
            {req.toDate !== req.fromDate ? ` → ${req.toDate}` : ""} ·{" "}
            {leaveDayCount(req)} day(s)
          </p>
          <p className="mt-1 text-sm text-[var(--brand-deep)]">{req.reason}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {req.status}
            {req.status === "pending"
              ? ` · ${pendingApproverHint(req)}`
              : ""}
            {req.decidedBy ? ` · ${req.decidedBy}` : ""}
            {req.attendanceApplied ? " · attendance applied" : ""}
          </p>
        </div>
        {showActions && req.status === "pending" ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btn}
              onClick={() => {
                const r = decideStudentLeave({
                  id: req.id,
                  approve: true,
                  by: actorName,
                });
                if (!r.ok) onError(r.error);
                else {
                  onRefresh();
                  onFlash("Approved");
                }
              }}
            >
              Approve
            </button>
            <button
              type="button"
              className={btnOutline}
              onClick={() => {
                const r = decideStudentLeave({
                  id: req.id,
                  approve: false,
                  by: actorName,
                });
                if (!r.ok) onError(r.error);
                else {
                  onRefresh();
                  onFlash("Rejected");
                }
              }}
            >
              Reject
            </button>
          </div>
        ) : null}
        {req.status === "pending" && req.requestedBy === actorName ? (
          <button
            type="button"
            className="text-xs text-[#b42318] underline"
            onClick={() => {
              const r = cancelStudentLeaveRequest(req.id);
              if (!r.ok) onError(r.error);
              else {
                onRefresh();
                onFlash("Cancelled");
              }
            }}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function StudentLeaveWorkspace({
  embedded = false,
}: {
  /** When true, hide page chrome (used under Attendance › Student leave). */
  embedded?: boolean;
}) {
  const session = useDemoSession();
  const ay = session.academicYearCode || DEFAULT_AY;
  const [tab, setTab] = useModuleTabQuery<LeaveTab>("dashboard", [
    "dashboard",
    "pending",
    "all",
    "apply",
    "reports",
  ]);
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [sis, setSis] = useState<SisState | null>(null);
  const [state, setState] = useState<StudentLeaveState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [fromDate, setFromDate] = useState(todayIso);
  const [toDate, setToDate] = useState(todayIso);
  const [leaveType, setLeaveType] = useState<StudentLeaveType>("SL");
  const [reason, setReason] = useState("");
  const [studentId, setStudentId] = useState("");

  const [reportFrom, setReportFrom] = useState(monthStart);
  const [reportTo, setReportTo] = useState(todayIso);
  const [reportFormat, setReportFormat] = useState<"excel" | "pdf">("excel");

  const actorName = session.fullName || "Staff";

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function refresh() {
    setMasters(loadMasters());
    setSis(loadSis());
    setState(loadStudentLeave());
  }

  useEffect(() => {
    refresh();
  }, [ay]);

  const activeStudents = useMemo(() => {
    if (!sis) return [];
    return sis.students
      .filter(
        (s) =>
          s.status === "active" &&
          (s.academicYearCode === ay || !s.academicYearCode),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [sis, ay]);

  useEffect(() => {
    if (!studentId && activeStudents[0]) setStudentId(activeStudents[0].id);
  }, [studentId, activeStudents]);

  const pending = useMemo(() => {
    if (!state) return [];
    return state.requests.filter(
      (r) => r.academicYearCode === ay && r.status === "pending",
    );
  }, [state, ay]);

  const allRequests = useMemo(() => {
    if (!state) return [];
    return state.requests
      .filter((r) => r.academicYearCode === ay)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [state, ay]);

  function submitApply() {
    const student = activeStudents.find((s) => s.id === studentId);
    const r = createStudentLeaveRequest({
      academicYearCode: ay,
      studentId,
      fromDate,
      toDate,
      leaveType,
      reason,
      requestedBy: actorName,
      householdId: student?.householdId || "",
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setReason("");
    refresh();
    flash("Leave request submitted");
    setTab("pending");
  }

  if (!state || !masters || !sis) {
    return (
      <div className="px-4 py-8 text-sm text-[var(--muted)]">
        Loading student leave…
      </div>
    );
  }

  const rowProps = {
    masters,
    sis,
    actorName,
    onRefresh: refresh,
    onFlash: flash,
    onError: (msg: string) => {
      setError(msg);
      setNotice(null);
    },
  };

  return (
    <div
      className={
        embedded
          ? "pb-6"
          : "mx-auto max-w-6xl px-4 pb-10 pt-4"
      }
    >
      {embedded ? (
        <p className="mb-3 text-sm text-[var(--muted)]">
          Parent requests · approve · auto attendance codes (LE / HD)
        </p>
      ) : (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--brand-deep)]">
              <CalendarOff className="h-7 w-7" aria-hidden />
              Student leave
            </h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Parent requests · staff approval · attendance codes (§19c)
            </p>
          </div>
          <Link href="/reports?module=student_leave" className={btnOutline}>
            Reports Center
          </Link>
        </header>
      )}

      {error ? (
        <p className="mb-3 rounded-lg bg-[rgba(180,35,24,0.08)] px-3 py-2 text-sm text-[#b42318]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-3 rounded-lg bg-[rgba(15,122,76,0.1)] px-3 py-2 text-sm text-[#0f7a4c]">
          {notice}
        </p>
      ) : null}

      <ModuleTabs
        items={TABS.map((t) =>
          t.id === "pending"
            ? { ...t, badge: pending.length || undefined }
            : t,
        )}
        value={tab}
        onChange={(id) => setTab(id as LeaveTab)}
      />

      {tab === "dashboard" ? (
        <ModuleDashboardHost
          moduleId="student_leave"
          onNavigateTab={(t) => setTab(t as LeaveTab)}
        />
      ) : null}

      {tab === "pending" ? (
        <section className="mt-4">
          {pending.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No pending requests.</p>
          ) : (
            <ul className="space-y-2">
              {pending.map((req) => (
                <RequestRow
                  key={req.id}
                  req={req}
                  showActions
                  {...rowProps}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "all" ? (
        <section className="mt-4">
          {allRequests.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No requests yet.</p>
          ) : (
            <ul className="space-y-2">
              {allRequests.map((req) => (
                <RequestRow
                  key={req.id}
                  req={req}
                  showActions={false}
                  {...rowProps}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === "apply" ? (
        <section className="mt-4 max-w-xl space-y-3">
          <p className="text-sm text-[var(--muted)]">
            Staff can apply leave on behalf of a student (e.g. office walk-in).
          </p>
          <label className="block text-xs text-[var(--muted)]">
            Student
            <select
              className={`${field} mt-1 w-full`}
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
            >
              {activeStudents.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName} ·{" "}
                  {classLabel(masters, s.classId, s.sectionId)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[var(--muted)]">
            Leave type
            <select
              className={`${field} mt-1 w-full`}
              value={leaveType}
              onChange={(e) =>
                setLeaveType(e.target.value as StudentLeaveType)
              }
            >
              {STUDENT_LEAVE_TYPES.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label} — {t.note}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="text-xs text-[var(--muted)]">
              From
              <input
                type="date"
                className={`${field} mt-1 block`}
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              To
              <input
                type="date"
                className={`${field} mt-1 block`}
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </label>
          </div>
          <label className="block text-xs text-[var(--muted)]">
            Reason
            <textarea
              className={`${field} mt-1 w-full`}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button type="button" className={btn} onClick={submitApply}>
            Submit request
          </button>
        </section>
      ) : null}

      {tab === "reports" ? (
        <section className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-[var(--muted)]">
              From
              <input
                type="date"
                className={`${field} mt-1 block`}
                value={reportFrom}
                onChange={(e) => setReportFrom(e.target.value)}
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              To
              <input
                type="date"
                className={`${field} mt-1 block`}
                value={reportTo}
                onChange={(e) => setReportTo(e.target.value)}
              />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Format
              <select
                className={`${field} mt-1 block`}
                value={reportFormat}
                onChange={(e) =>
                  setReportFormat(e.target.value as "excel" | "pdf")
                }
              >
                <option value="excel">Excel</option>
                <option value="pdf">PDF</option>
              </select>
            </label>
          </div>
          <ul className="space-y-1.5">
            {STUDENT_LEAVE_REPORTS.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[rgba(32,48,80,0.08)] bg-white px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--brand-deep)]">
                    {r.label}
                  </p>
                  {r.hint ? (
                    <p className="text-xs text-[var(--muted)]">{r.hint}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className={btn}
                  onClick={() => {
                    const res = runStudentLeaveReport(
                      r.id as StudentLeaveReportId,
                      {
                        academicYearCode: ay,
                        fromDate: reportFrom,
                        toDate: reportTo,
                        format: reportFormat,
                        leave: state,
                        masters,
                      },
                    );
                    if (!res.ok) setError(res.error);
                    else flash(res.message);
                  }}
                >
                  Export
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
