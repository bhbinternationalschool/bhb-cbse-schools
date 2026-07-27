"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_AY } from "@/lib/masters";
import {
  classLabelForStudent,
  resolveParentHousehold,
} from "@/lib/parentPortal";
import { loadSis, type Household, type SisStudent } from "@/lib/sis";
import { StudentNameLabel } from "@/components/students/StudentAvatar";
import {
  cancelStudentLeaveRequest,
  createStudentLeaveRequest,
  leaveDayCount,
  leaveTypeLabel,
  loadStudentLeave,
  pendingApproverHint,
  STUDENT_LEAVE_TYPES,
  type StudentLeaveRequest,
  type StudentLeaveState,
  type StudentLeaveType,
} from "@/lib/studentLeave";

const field =
  "rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-2.5 py-1.5 text-sm text-[var(--brand-deep)]";
const btn =
  "rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function ParentStudentLeavePortal({
  guardianDisplayName,
}: {
  guardianDisplayName: string;
}) {
  const [household, setHousehold] = useState<Household | null>(null);
  const [children, setChildren] = useState<SisStudent[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [leave, setLeave] = useState<StudentLeaveState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [fromDate, setFromDate] = useState(todayIso);
  const [toDate, setToDate] = useState(todayIso);
  const [leaveType, setLeaveType] = useState<StudentLeaveType>("SL");
  const [reason, setReason] = useState("");

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function reload() {
    const sis = loadSis();
    setLeave(loadStudentLeave());
    const hh = resolveParentHousehold(sis, {
      guardianName: guardianDisplayName,
      mobile: "9876543210",
    });
    setHousehold(hh);
    if (!hh) {
      setChildren([]);
      setActiveId(null);
      return;
    }
    const kids = sis.students.filter(
      (s) => s.householdId === hh.id && s.status === "active",
    );
    setChildren(kids);
    const aid =
      activeId && kids.some((k) => k.id === activeId)
        ? activeId
        : kids[0]?.id ?? null;
    setActiveId(aid);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardianDisplayName]);

  const child = useMemo(
    () => children.find((c) => c.id === activeId) ?? null,
    [children, activeId],
  );

  const childRequests = useMemo((): StudentLeaveRequest[] => {
    if (!leave || !child) return [];
    return leave.requests
      .filter(
        (r) =>
          r.studentId === child.id &&
          r.academicYearCode ===
            (child.academicYearCode || DEFAULT_AY),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [leave, child]);

  function submitLeave() {
    if (!child || !household) return;
    const r = createStudentLeaveRequest({
      academicYearCode: child.academicYearCode || DEFAULT_AY,
      studentId: child.id,
      fromDate,
      toDate,
      leaveType,
      reason,
      requestedBy: household.guardianName,
      householdId: household.id,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setReason("");
    setLeave(loadStudentLeave());
    flash("Leave request submitted");
  }

  if (!household) {
    return (
      <p className="px-4 py-8 text-sm text-[var(--muted)]">
        No household linked for this parent demo.
      </p>
    );
  }

  return (
    <div className="px-4 pb-8 pt-3">
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

      {children.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {children.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveId(c.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                activeId === c.id
                  ? "bg-[var(--brand-deep)] text-white"
                  : "bg-[rgba(32,48,80,0.08)] text-[var(--brand-deep)]"
              }`}
            >
              <StudentNameLabel student={c} />
            </button>
          ))}
        </div>
      ) : child ? (
        <p className="mb-2 text-sm font-semibold text-[var(--brand-deep)]">
          <StudentNameLabel student={child} />
          <span className="ml-2 text-xs font-normal text-[var(--muted)]">
            {classLabelForStudent(child)}
          </span>
        </p>
      ) : null}

      {!child ? (
        <p className="text-sm text-[var(--muted)]">No children on household.</p>
      ) : (
        <div className="space-y-4">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
              Apply leave
            </h2>
            <label className="block text-xs text-[var(--muted)]">
              Type
              <select
                className={`${field} mt-1 w-full`}
                value={leaveType}
                onChange={(e) =>
                  setLeaveType(e.target.value as StudentLeaveType)
                }
              >
                {STUDENT_LEAVE_TYPES.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
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
            <button type="button" className={btn} onClick={submitLeave}>
              Submit request
            </button>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-[var(--brand-deep)]">
              Your requests
            </h2>
            {childRequests.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No leave requests yet.</p>
            ) : (
              <ul className="space-y-2">
                {childRequests.map((req) => (
                  <li
                    key={req.id}
                    className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-3 py-3"
                  >
                    <p className="text-sm font-medium text-[var(--brand-deep)]">
                      {leaveTypeLabel(req.leaveType)} · {req.fromDate}
                      {req.toDate !== req.fromDate ? ` → ${req.toDate}` : ""}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {leaveDayCount(req)} day(s) · {req.status}
                      {req.status === "pending"
                        ? ` · ${pendingApproverHint(req)}`
                        : ""}
                    </p>
                    <p className="mt-1 text-sm">{req.reason}</p>
                    {req.status === "pending" ? (
                      <button
                        type="button"
                        className="mt-2 text-xs text-[#b42318] underline"
                        onClick={() => {
                          const r = cancelStudentLeaveRequest(req.id);
                          if (!r.ok) setError(r.error);
                          else {
                            setLeave(loadStudentLeave());
                            flash("Cancelled");
                          }
                        }}
                      >
                        Cancel request
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
