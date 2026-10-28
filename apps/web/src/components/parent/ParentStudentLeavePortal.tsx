"use client";

import { useState } from "react";
import { btn, field } from "@/components/ui/erp-ui";
import {
  ChildPicker,
  Flash,
  ParentReadState,
  WithChildren,
  parentPost,
  useActiveChild,
  useFlash,
  useParentRead,
  useParentRefresh,
  type ParentChild,
} from "@/components/parent/parentData";

/** GET /api/v1/leave/list — the family's leave requests (the app's Leave screen). */
type LeaveList = {
  requests: {
    id: string;
    studentId: string;
    studentName: string;
    fromDate: string;
    toDate: string;
    days: number;
    leaveType: string;
    leaveTypeLabel: string;
    reason: string;
    status: string;
    createdAt: string;
    decisionNote?: string;
  }[];
  leaveTypes: { code: string; label: string; note?: string }[];
};

function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Leave for the parent's own children. Requests are read from and written to
 * the server (POST /api/v1/leave/request and /cancel); the list is the
 * session's household's only.
 */
export function ParentStudentLeavePortal() {
  return (
    <WithChildren>{(list) => <LeaveForFamily list={list} />}</WithChildren>
  );
}

const KEY = ["leave"] as const;

function LeaveForFamily({ list }: { list: ParentChild[] }) {
  const { child, setActiveId } = useActiveChild(list);
  const leave = useParentRead<LeaveList>(
    KEY,
    "/api/v1/leave/list",
    (v) => Array.isArray(v.requests) && Array.isArray(v.leaveTypes),
    "Leave requests",
  );
  const refresh = useParentRefresh();
  const flash = useFlash();
  const [leaveType, setLeaveType] = useState("");
  const [fromDate, setFromDate] = useState(todayIst);
  const [toDate, setToDate] = useState(todayIst);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="px-4 pb-8 pt-3">
      <ChildPicker list={list} child={child} onPick={setActiveId} />
      <ParentReadState query={leave} what="your leave requests">
        {(l) => {
          const type = leaveType || l.leaveTypes[0]?.code || "";
          const mine = l.requests.filter((r) => r.studentId === child?.id);
          async function submit() {
            if (!child) return;
            setBusy(true);
            const r = await parentPost("/api/v1/leave/request", {
              studentId: child.id,
              fromDate,
              toDate,
              leaveType: type,
              reason,
            });
            setBusy(false);
            if (!r.ok) return flash.fail(r.error);
            setReason("");
            await refresh(KEY);
            flash.ok("Leave request submitted");
          }
          async function cancel(id: string) {
            setBusy(true);
            const r = await parentPost("/api/v1/leave/cancel", { id });
            setBusy(false);
            if (!r.ok) return flash.fail(r.error);
            await refresh(KEY);
            flash.ok("Cancelled");
          }
          return (
            <div className="space-y-4" data-testid="parent-leave">
              <Flash notice={flash.notice} error={flash.error} />
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-[var(--brand-deep)]">
                  Apply leave
                </h2>
                <label className="block text-xs text-[var(--muted)]">
                  Type
                  <select
                    className={`${field} mt-1 w-full`}
                    value={type}
                    onChange={(e) => setLeaveType(e.target.value)}
                  >
                    {l.leaveTypes.map((t) => (
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
                <button
                  type="button"
                  className={btn}
                  disabled={busy || !child}
                  onClick={() => void submit()}
                >
                  {busy ? "Sending…" : "Submit request"}
                </button>
              </section>
              <section>
                <h2 className="mb-2 text-sm font-semibold text-[var(--brand-deep)]">
                  Your requests
                </h2>
                {mine.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">
                    No leave requests yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {mine.map((req) => (
                      <li
                        key={req.id}
                        data-leave-id={req.id}
                        className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[var(--card)] px-3 py-3"
                      >
                        <p className="text-sm font-medium text-[var(--brand-deep)]">
                          {req.leaveTypeLabel} · {req.fromDate}
                          {req.toDate !== req.fromDate
                            ? ` → ${req.toDate}`
                            : ""}
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          {req.days} day(s) · {req.status}
                        </p>
                        <p className="mt-1 text-sm">{req.reason}</p>
                        {req.decisionNote ? (
                          <p className="mt-1 text-xs text-[var(--muted)]">
                            Note: {req.decisionNote}
                          </p>
                        ) : null}
                        {req.status === "pending" ? (
                          <button
                            type="button"
                            className="mt-2 text-xs text-[var(--danger)] underline"
                            disabled={busy}
                            onClick={() => void cancel(req.id)}
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
          );
        }}
      </ParentReadState>
    </div>
  );
}
