"use client";

import { useEffect, useMemo, useState } from "react";
import { useDemoSession } from "@/components/shell/SessionContext";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
} from "@/components/ui/erp-roster";
import { listSessionYearOptions, loadMasters, type MastersState } from "@/lib/masters";
import {
  adjustHalfDayLeave,
  adjustLeave,
  applyLeave,
  carryForwardLeaveBalances,
  computeLeaveDays,
  decideLeave,
  describeLeaveRules,
  directLeave,
  encashLeave,
  ensureBalancesForAy,
  loadStaffHr,
  normalizeLeaveSettings,
  remainingBalance,
  saveStaffHr,
  type LeaveRequest,
  type LeaveStatus,
  type LeaveTypeCode,
  type StaffHrState,
} from "@/lib/staffHr";
import {
  canManageStaffLeave,
  resolveSessionStaff,
} from "@/lib/staffResolve";
import { RowActionMenu } from "@/components/ui/erp-grid";

type LeaveTab =
  | "request"
  | "manage"
  | "direct"
  | "adjust"
  | "halfday";

export function StaffLeavePanel({ ay }: { ay: string }) {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [hr, setHr] = useState<StaffHrState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | LeaveStatus>("all");
  const [tab, setTab] = useState<LeaveTab>("request");

  const [staffId, setStaffId] = useState("");
  const [typeCode, setTypeCode] = useState<LeaveTypeCode>("CL");
  const [fromDate, setFromDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [toDate, setToDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [adjustId, setAdjustId] = useState("");
  const [halfDayId, setHalfDayId] = useState("");

  function reload() {
    const m = loadMasters();
    setMasters(m);
    let state = loadStaffHr();
    state = ensureBalancesForAy(state, m.staff ?? [], ay);
    saveStaffHr(state);
    setHr(state);
  }

  useEffect(() => {
    reload();
    void (async () => {
      const [{ ensureStaffHydrated }, { ensureStaffHrHydrated }, { withHydrationSlot }] =
        await Promise.all([
          import("@/lib/staffPersistence"),
          import("@/lib/staffHrPersistence"),
          import("@/lib/deskHydrateGuard"),
        ]);
      const [didStaff, didHr] = await Promise.all([
        withHydrationSlot(() => ensureStaffHydrated()),
        withHydrationSlot(() => ensureStaffHrHydrated()),
      ]);
      if (didStaff || didHr) reload();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ay drives reload
  }, [ay]);

  const selfStaff = useMemo(() => {
    if (!masters) return null;
    return resolveSessionStaff(session, masters);
  }, [masters, session]);

  const isManager = useMemo(() => {
    if (!masters) return false;
    return canManageStaffLeave(session, masters);
  }, [masters, session]);

  useEffect(() => {
    if (!isManager && selfStaff) {
      setStaffId(selfStaff.id);
    }
  }, [isManager, selfStaff]);

  useEffect(() => {
    if (!isManager && (tab === "manage" || tab === "direct" || tab === "adjust" || tab === "halfday")) {
      setTab("request");
    }
  }, [isManager, tab]);

  const roster = useMemo(() => {
    if (!masters) return [];
    return (masters.staff ?? [])
      .filter((s) => s.status === "active")
      .sort((a, b) => a.empCode.localeCompare(b.empCode));
  }, [masters]);

  const daysPreview = useMemo(
    () => computeLeaveDays(fromDate, halfDay ? fromDate : toDate, halfDay),
    [fromDate, toDate, halfDay],
  );

  const selectedType = useMemo(
    () => hr?.leaveTypes.find((t) => t.code === typeCode) ?? null,
    [hr, typeCode],
  );

  const settings = useMemo(
    () => normalizeLeaveSettings(hr?.leaveSettings),
    [hr],
  );

  const pendingL1 = useMemo(
    () =>
      (hr?.leaveRequests ?? []).filter(
        (r) => r.academicYearCode === ay && r.status === "pending",
      ),
    [hr, ay],
  );

  const pendingL2 = useMemo(
    () =>
      (hr?.leaveRequests ?? []).filter(
        (r) => r.academicYearCode === ay && r.status === "pending_l2",
      ),
    [hr, ay],
  );

  const adjustable = useMemo(
    () =>
      (hr?.leaveRequests ?? [])
        .filter(
          (r) =>
            r.academicYearCode === ay &&
            (r.status === "pending" ||
              r.status === "pending_l2" ||
              r.status === "approved"),
        )
        .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt)),
    [hr, ay],
  );

  const history = useMemo(() => {
    let rows = (hr?.leaveRequests ?? []).filter(
      (r) => r.academicYearCode === ay,
    );
    if (!isManager && selfStaff) {
      rows = rows.filter((r) => r.staffId === selfStaff.id);
    }
    const filtered =
      statusFilter === "all"
        ? rows
        : rows.filter((r) => r.status === statusFilter);
    return filtered.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  }, [hr, ay, statusFilter, isManager, selfStaff]);

  const balances = useMemo(() => {
    if (!hr || !masters) return [];
    const people =
      !isManager && selfStaff
        ? roster.filter((s) => s.id === selfStaff.id)
        : roster;
    return people.map((s) => {
      const byType = hr.leaveTypes.map((t) => {
        const bal = hr.leaveBalances.find(
          (b) =>
            b.staffId === s.id &&
            b.typeCode === t.code &&
            b.academicYearCode === ay,
        );
        return {
          code: t.code,
          allotted: bal?.allotted ?? t.defaultDaysPerYear,
          carried: bal?.carriedForward ?? 0,
          encashed: bal?.encashed ?? 0,
          used: bal?.used ?? 0,
          remaining: bal ? remainingBalance(bal) : t.defaultDaysPerYear,
          paid: t.paid,
        };
      });
      return { staff: s, byType };
    });
  }, [hr, masters, roster, ay, isManager, selfStaff]);

  function flash(msg: string, isError = false) {
    if (isError) {
      setError(msg);
      setNotice(null);
    } else {
      setNotice(msg);
      setError(null);
    }
    window.setTimeout(() => {
      setNotice(null);
      setError(null);
    }, 2800);
  }

  function resetForm() {
    setReason("");
    setHalfDay(false);
    if (!isManager && selfStaff) setStaffId(selfStaff.id);
  }

  function onRequest(e: React.FormEvent) {
    e.preventDefault();
    const targetId =
      !isManager && selfStaff ? selfStaff.id : staffId;
    if (!targetId) {
      flash(
        "Sign in with your staff login to request leave, or ask admin to apply for you.",
        true,
      );
      return;
    }
    const result = applyLeave({
      academicYearCode: ay,
      staffId: targetId,
      typeCode,
      fromDate,
      toDate,
      halfDay,
      reason,
      appliedBy: session.fullName,
    });
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    setHr(result.state);
    resetForm();
    if (result.request.status === "approved") {
      flash("Leave auto-approved");
    } else {
      flash("Leave request submitted");
    }
  }

  function onDirect(e: React.FormEvent) {
    e.preventDefault();
    if (!isManager) {
      flash("Only principal / admin can grant direct leave", true);
      return;
    }
    const result = directLeave({
      academicYearCode: ay,
      staffId,
      typeCode,
      fromDate,
      toDate,
      halfDay,
      reason,
      appliedBy: session.fullName,
    });
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    setHr(result.state);
    resetForm();
    flash("Direct leave recorded (approved)");
  }

  function loadAdjust(id: string) {
    setAdjustId(id);
    const r = hr?.leaveRequests.find((x) => x.id === id);
    if (!r) return;
    setStaffId(r.staffId);
    setTypeCode(r.typeCode);
    setFromDate(r.fromDate);
    setToDate(r.toDate);
    setHalfDay(r.halfDay);
    setReason(r.reason);
  }

  function onAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!isManager) {
      flash("Only principal / admin can adjust leave", true);
      return;
    }
    if (!adjustId) {
      flash("Select a leave to adjust", true);
      return;
    }
    const result = adjustLeave({
      requestId: adjustId,
      fromDate,
      toDate,
      halfDay,
      typeCode,
      reason,
      adjustedBy: session.fullName,
    });
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    setHr(result.state);
    flash("Leave adjusted");
  }

  function onHalfDayAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!isManager) {
      flash("Only principal / admin can adjust half-day leave", true);
      return;
    }
    if (!halfDayId) {
      flash("Select a leave", true);
      return;
    }
    const result = adjustHalfDayLeave({
      requestId: halfDayId,
      halfDay,
      adjustedBy: session.fullName,
    });
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    setHr(result.state);
    flash(halfDay ? "Converted to half-day leave" : "Converted to full-day leave");
  }

  function onDecide(requestId: string, decision: "approved" | "rejected") {
    if (!isManager) {
      flash("Only principal / admin can manage leave", true);
      return;
    }
    const before = hr?.leaveRequests.find((r) => r.id === requestId);
    const result = decideLeave({
      requestId,
      decision,
      decidedBy: session.fullName,
    });
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    setHr(result.state);
    if (decision === "rejected") {
      flash("Leave rejected");
      return;
    }
    const after = result.state.leaveRequests.find((r) => r.id === requestId);
    if (before?.status === "pending" && after?.status === "pending_l2") {
      flash("Level 1 approved — awaiting Level 2");
    } else {
      flash("Leave approved");
    }
  }

  function staffLabel(id: string) {
    const s = masters?.staff.find((x) => x.id === id);
    return s ? `${s.empCode} · ${s.fullName}` : id;
  }

  if (!masters || !hr) {
    return <p className="text-sm text-[var(--muted)]">Loading leave…</p>;
  }

  const tabs: { id: LeaveTab; label: string }[] = [
    { id: "request", label: "Request leave" },
    ...(isManager
      ? ([
          { id: "manage", label: "Manage" },
          { id: "direct", label: "Direct leave" },
          { id: "adjust", label: "Adjust leave" },
          { id: "halfday", label: "Adjust half-day" },
        ] as const)
      : []),
  ];

  return (
    <div className="space-y-5">
      {error ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm font-medium text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-2 text-sm font-medium text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-2.5 text-sm text-[var(--muted)]">
        {isManager ? (
          <>
            Signed in as <strong className="text-[var(--brand-deep)]">{session.fullName}</strong>{" "}
            (principal / admin) — manage, direct, and adjust leave for any staff.
            Staff can also request their own leave.
          </>
        ) : selfStaff ? (
          <>
            Requesting as <strong className="text-[var(--brand-deep)]">{selfStaff.empCode} · {selfStaff.fullName}</strong>.
            Approvals are handled by principal / admin.
          </>
        ) : (
          <>
            Sign in with your staff login (Staff → Login) to request leave for yourself.
            Principal / admin can still manage leave after signing in with an office account.
          </>
        )}
      </p>

      {settings.autoApproveLeaves ? (
        <p className="rounded-xl border border-[rgba(21,128,61,0.25)] bg-[rgba(21,128,61,0.08)] px-4 py-2.5 text-sm text-[var(--success)]">
          Auto-approve is on — new leave requests are approved immediately.
        </p>
      ) : settings.twoLevelApproval ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-4 py-2.5 text-sm text-[var(--muted)]">
          Two-level approval is on — Level 1 then Level 2.
        </p>
      ) : null}

      <ModuleTabs
        aria-label="Leave actions"
        value={tab}
        onChange={(id) => setTab(id as LeaveTab)}
        items={tabs.map((t) => ({
          id: t.id,
          label: t.label,
          tone:
            t.id === "request"
              ? ("teal" as const)
              : t.id === "manage"
                ? ("navy" as const)
                : t.id === "direct"
                  ? ("amber" as const)
                  : t.id === "adjust"
                    ? ("violet" as const)
                    : ("sky" as const),
        }))}
      />

      {tab === "request" ? (
        <LeaveForm
          title={`Request leave · ${ay}`}
          submitLabel="Submit request"
          roster={roster}
          staffId={!isManager && selfStaff ? selfStaff.id : staffId}
          staffLocked={!isManager}
          typeCode={typeCode}
          fromDate={fromDate}
          toDate={toDate}
          halfDay={halfDay}
          reason={reason}
          daysPreview={daysPreview}
          leaveTypes={hr.leaveTypes}
          selectedRules={selectedType ? describeLeaveRules(selectedType) : null}
          onStaffId={setStaffId}
          onTypeCode={setTypeCode}
          onFromDate={(v) => {
            setFromDate(v);
            if (halfDay) setToDate(v);
          }}
          onToDate={setToDate}
          onHalfDay={(v) => {
            setHalfDay(v);
            if (v) setToDate(fromDate);
          }}
          onReason={setReason}
          onSubmit={onRequest}
          disabled={!isManager && !selfStaff}
        />
      ) : null}

      {tab === "direct" && isManager ? (
        <LeaveForm
          title={`Direct leave · ${ay}`}
          submitLabel="Grant direct leave"
          hint="Creates an approved leave immediately (no approval queue)."
          roster={roster}
          staffId={staffId}
          staffLocked={false}
          typeCode={typeCode}
          fromDate={fromDate}
          toDate={toDate}
          halfDay={halfDay}
          reason={reason}
          daysPreview={daysPreview}
          leaveTypes={hr.leaveTypes}
          selectedRules={selectedType ? describeLeaveRules(selectedType) : null}
          onStaffId={setStaffId}
          onTypeCode={setTypeCode}
          onFromDate={(v) => {
            setFromDate(v);
            if (halfDay) setToDate(v);
          }}
          onToDate={setToDate}
          onHalfDay={(v) => {
            setHalfDay(v);
            if (v) setToDate(fromDate);
          }}
          onReason={setReason}
          onSubmit={onDirect}
        />
      ) : null}

      {tab === "manage" && isManager ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ApprovalQueue
            title={
              settings.twoLevelApproval && !settings.autoApproveLeaves
                ? `Level 1 approval (${pendingL1.length})`
                : `Pending approval (${pendingL1.length})`
            }
            rows={pendingL1}
            staffLabel={staffLabel}
            approveLabel={
              settings.twoLevelApproval && !settings.autoApproveLeaves
                ? "Approve L1"
                : "Approve"
            }
            onDecide={onDecide}
            empty="No pending requests"
          />
          {settings.twoLevelApproval && !settings.autoApproveLeaves ? (
            <ApprovalQueue
              title={`Level 2 approval (${pendingL2.length})`}
              rows={pendingL2}
              staffLabel={staffLabel}
              approveLabel="Approve L2"
              onDecide={onDecide}
              empty="No Level 2 queue"
              showLevel1
            />
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--muted)]">
              Approve or reject staff leave requests here. Use Direct leave to
              grant leave without a request, or Adjust to change dates / type.
            </div>
          )}
        </div>
      ) : null}

      {tab === "adjust" && isManager ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Select leave to adjust
            </h2>
            {adjustable.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted)]">No adjustable leaves</p>
            ) : (
              <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                {adjustable.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                        adjustId === r.id
                          ? "border-[var(--brand-deep)] bg-[var(--surface-sunken)]"
                          : "border-[var(--border)]"
                      }`}
                      onClick={() => loadAdjust(r.id)}
                    >
                      <div className="font-semibold text-[var(--brand-deep)]">
                        {staffLabel(r.staffId)}
                      </div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {r.typeCode} · {r.fromDate}
                        {r.toDate !== r.fromDate ? ` → ${r.toDate}` : ""} ·{" "}
                        {r.days}d · {r.status}
                        {r.halfDay ? " · half" : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <LeaveForm
            title="Adjust leave"
            submitLabel="Save adjustment"
            hint="Change dates, type, or half-day. Balances update for approved leaves."
            roster={roster}
            staffId={staffId}
            staffLocked
            typeCode={typeCode}
            fromDate={fromDate}
            toDate={toDate}
            halfDay={halfDay}
            reason={reason}
            daysPreview={daysPreview}
            leaveTypes={hr.leaveTypes}
            selectedRules={selectedType ? describeLeaveRules(selectedType) : null}
            onStaffId={setStaffId}
            onTypeCode={setTypeCode}
            onFromDate={(v) => {
              setFromDate(v);
              if (halfDay) setToDate(v);
            }}
            onToDate={setToDate}
            onHalfDay={(v) => {
              setHalfDay(v);
              if (v) setToDate(fromDate);
            }}
            onReason={setReason}
            onSubmit={onAdjust}
            disabled={!adjustId}
          />
        </div>
      ) : null}

      {tab === "halfday" && isManager ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-4 max-w-xl">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Adjust half-day leave
          </h2>
          <p className="text-[11px] text-[var(--muted)]">
            Convert a leave to half-day (0.5 on the from-date) or back to full day.
          </p>
          <form onSubmit={onHalfDayAdjust} className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Leave
              </span>
              <select
                className="field !py-1.5"
                value={halfDayId}
                onChange={(e) => {
                  setHalfDayId(e.target.value);
                  const r = hr.leaveRequests.find((x) => x.id === e.target.value);
                  if (r) setHalfDay(r.halfDay);
                }}
                required
              >
                <option value="">Select…</option>
                {adjustable.map((r) => (
                  <option key={r.id} value={r.id}>
                    {staffLabel(r.staffId)} · {r.typeCode} · {r.fromDate}
                    {r.halfDay ? " (half)" : ""} · {r.status}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--brand-deep)]">
              <input
                type="checkbox"
                checked={halfDay}
                onChange={(e) => setHalfDay(e.target.checked)}
              />
              Half day (0.5)
            </label>
            <button
              type="submit"
              className="rounded-xl bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-bold text-white"
            >
              Save half-day adjustment
            </button>
          </form>
        </div>
      ) : null}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Leave balances · {ay}
            {!isManager && selfStaff ? " (yours)" : ""}
          </h2>
          {isManager ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
                onClick={() => {
                  const years = listSessionYearOptions(masters ?? undefined);
                  const idx = years.findIndex((y) => y.code === ay);
                  const fromAy =
                    idx >= 0 && years[idx + 1]
                      ? years[idx + 1]!.code
                      : years.find((y) => y.code !== ay)?.code;
                  if (!fromAy || !masters) {
                    flash("Need a prior academic year to carry from", true);
                    return;
                  }
                  const res = carryForwardLeaveBalances({
                    fromAy,
                    toAy: ay,
                    staff: masters.staff ?? [],
                  });
                  if (!res.ok) {
                    flash(res.error, true);
                    return;
                  }
                  setHr(res.state);
                  flash(
                    `Carried ${res.daysCarried} day(s) for ${res.staffUpdated} staff (${fromAy} → ${ay})`,
                  );
                }}
              >
                Carry-forward into {ay}
              </button>
            </div>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <ErpTable>
            <ErpTableHead>
              <tr>
                <th className="px-4 py-2">Staff</th>
                {hr.leaveTypes.map((t) => (
                  <th key={t.code} className="px-3 py-2 text-center">
                    {t.code}
                  </th>
                ))}
                <th className="w-10 px-2 py-2" aria-label="Actions" />
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {balances.map(({ staff, byType }) => (
                <tr key={staff.id}>
                  <td className="px-4 py-2 font-medium text-[var(--brand-deep)]">
                    {staff.empCode} · {staff.fullName}
                  </td>
                  {byType.map((t) => (
                    <td key={t.code} className="px-3 py-2 text-center text-xs">
                      <div>
                        <span className="font-semibold">{t.remaining}</span>
                        <span className="text-[var(--muted)]">
                          {" "}
                          / {t.allotted + t.carried}
                        </span>
                      </div>
                      {t.carried > 0 || t.encashed > 0 ? (
                        <div className="text-[10px] text-[var(--muted)]">
                          {t.carried > 0 ? `CF ${t.carried}` : ""}
                          {t.carried > 0 && t.encashed > 0 ? " · " : ""}
                          {t.encashed > 0 ? `enc ${t.encashed}` : ""}
                        </div>
                      ) : null}
                      {isManager && t.paid && t.remaining > 0 ? (
                        <button
                          type="button"
                          className="mt-1 text-[10px] font-semibold text-[var(--brand-mid)] underline"
                          onClick={() => {
                            const daysStr = window.prompt(
                              `Encash how many ${t.code} days for ${staff.empCode}? (max ${t.remaining})`,
                              String(Math.min(1, t.remaining)),
                            );
                            if (!daysStr) return;
                            const res = encashLeave({
                              staffId: staff.id,
                              typeCode: t.code,
                              academicYearCode: ay,
                              days: Number(daysStr),
                              recordedBy: session.fullName,
                            });
                            if (!res.ok) {
                              flash(res.error, true);
                              return;
                            }
                            setHr(res.state);
                            flash(
                              `Encased ${res.encashment.days} ${t.code} day(s) — record payroll settlement separately`,
                            );
                          }}
                        >
                          Encash
                        </button>
                      ) : null}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right">
                    <RowActionMenu row={staff} label="Staff actions" actions={[{ id: "open", label: "Open staff record", onSelect: (x) => { window.location.href = `/staff/${encodeURIComponent(String(x.id))}/edit`; } }]} />
                  </td>
                </tr>
              ))}
              {balances.length === 0 ? (
                <tr>
                  <td
                    colSpan={1 + hr.leaveTypes.length}
                    className="px-4 py-8 text-center text-sm text-[var(--muted)]"
                  >
                    No balances to show
                  </td>
                </tr>
              ) : null}
            </ErpTableBody>
          </ErpTable>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">
            Request history
            {!isManager ? " (yours)" : ""}
          </h2>
          <select
            className="field !w-auto !py-1 text-xs"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "all" | LeaveStatus)
            }
          >
            <option value="all">All</option>
            <option value="pending">Pending (L1)</option>
            <option value="pending_l2">Pending (L2)</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <ErpTable>
            <ErpTableHead>
              <tr>
                <th className="px-4 py-2">Staff</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Dates</th>
                <th className="px-3 py-2">Days</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Origin</th>
                <th className="px-3 py-2">By</th>
                <th className="w-10 px-2 py-2" aria-label="Actions" />
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {history.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">{staffLabel(r.staffId)}</td>
                  <td className="px-3 py-2">{r.typeCode}</td>
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">
                    {r.fromDate}
                    {r.toDate !== r.fromDate ? ` → ${r.toDate}` : ""}
                  </td>
                  <td className="px-3 py-2">{r.days}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-3 py-2 text-xs capitalize text-[var(--muted)]">
                    {r.origin}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">
                    {r.status === "pending"
                      ? r.appliedBy
                      : r.status === "pending_l2"
                        ? r.level1By || r.appliedBy
                        : r.decidedBy || r.appliedBy}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <RowActionMenu row={r} label="Staff actions" actions={[{ id: "open", label: "Open staff record", onSelect: (x) => { window.location.href = `/staff/${encodeURIComponent(String(x.staffId))}/edit`; } }]} />
                  </td>
                </tr>
              ))}
              {history.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-sm text-[var(--muted)]"
                  >
                    No leave requests for this year
                  </td>
                </tr>
              ) : null}
            </ErpTableBody>
          </ErpTable>
        </div>
      </div>
    </div>
  );
}

function LeaveForm({
  title,
  submitLabel,
  hint,
  roster,
  staffId,
  staffLocked,
  typeCode,
  fromDate,
  toDate,
  halfDay,
  reason,
  daysPreview,
  leaveTypes,
  selectedRules,
  onStaffId,
  onTypeCode,
  onFromDate,
  onToDate,
  onHalfDay,
  onReason,
  onSubmit,
  disabled,
}: {
  title: string;
  submitLabel: string;
  hint?: string;
  roster: { id: string; empCode: string; fullName: string }[];
  staffId: string;
  staffLocked: boolean;
  typeCode: LeaveTypeCode;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  reason: string;
  daysPreview: number;
  leaveTypes: { code: string; name: string; paid: boolean }[];
  selectedRules: string | null;
  onStaffId: (v: string) => void;
  onTypeCode: (v: LeaveTypeCode) => void;
  onFromDate: (v: string) => void;
  onToDate: (v: string) => void;
  onHalfDay: (v: boolean) => void;
  onReason: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  disabled?: boolean;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3 max-w-xl"
    >
      <h2 className="text-sm font-bold text-[var(--brand-deep)]">{title}</h2>
      {hint ? (
        <p className="text-[11px] text-[var(--muted)]">{hint}</p>
      ) : null}
      <label className="block text-sm">
        <span className="mb-1 block text-[11px] text-[var(--muted)]">Staff</span>
        <select
          className="field !py-1.5"
          value={staffId}
          onChange={(e) => onStaffId(e.target.value)}
          required
          disabled={staffLocked || disabled}
        >
          <option value="">Select…</option>
          {roster.map((s) => (
            <option key={s.id} value={s.id}>
              {s.empCode} · {s.fullName}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Type</span>
          <select
            className="field !py-1.5"
            value={typeCode}
            onChange={(e) => onTypeCode(e.target.value as LeaveTypeCode)}
            disabled={disabled}
          >
            {leaveTypes.map((t) => (
              <option key={t.code} value={t.code}>
                {t.code} — {t.name}
                {t.paid ? "" : " (unpaid)"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm font-semibold text-[var(--brand-deep)]">
          <input
            type="checkbox"
            checked={halfDay}
            onChange={(e) => onHalfDay(e.target.checked)}
            disabled={disabled}
          />
          Half day (0.5)
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">From</span>
          <input
            type="date"
            className="field !py-1.5"
            value={fromDate}
            onChange={(e) => onFromDate(e.target.value)}
            required
            disabled={disabled}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">To</span>
          <input
            type="date"
            className="field !py-1.5"
            value={toDate}
            onChange={(e) => onToDate(e.target.value)}
            disabled={halfDay || disabled}
            required={!halfDay}
          />
        </label>
      </div>
      <p className="text-[11px] text-[var(--muted)]">
        Duration: <strong>{daysPreview}</strong> day
        {daysPreview === 1 ? "" : "s"}
        {selectedRules ? <> · Rules: {selectedRules}</> : null}
      </p>
      <label className="block text-sm">
        <span className="mb-1 block text-[11px] text-[var(--muted)]">Reason</span>
        <textarea
          className="field !py-1.5 min-h-[72px]"
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          placeholder="Optional note"
          disabled={disabled}
        />
      </label>
      <button
        type="submit"
        disabled={disabled}
        className="rounded-xl bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
      >
        {submitLabel}
      </button>
    </form>
  );
}

function ApprovalQueue({
  title,
  rows,
  staffLabel,
  approveLabel,
  onDecide,
  empty,
  showLevel1,
}: {
  title: string;
  rows: LeaveRequest[];
  staffLabel: (id: string) => string;
  approveLabel: string;
  onDecide: (id: string, decision: "approved" | "rejected") => void;
  empty: string;
  showLevel1?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 className="text-sm font-bold text-[var(--brand-deep)]">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-[var(--border)] px-3 py-2"
            >
              <div className="text-sm font-semibold text-[var(--brand-deep)]">
                {staffLabel(r.staffId)}
              </div>
              <div className="text-[11px] text-[var(--muted)]">
                {r.typeCode} · {r.fromDate}
                {r.toDate !== r.fromDate ? ` → ${r.toDate}` : ""} · {r.days}{" "}
                day{r.days === 1 ? "" : "s"}
                {r.halfDay ? " (half)" : ""}
              </div>
              {showLevel1 && r.level1By ? (
                <p className="mt-1 text-[11px] text-[var(--muted)]">
                  L1 by {r.level1By}
                </p>
              ) : null}
              {r.reason ? (
                <p className="mt-1 text-xs text-[var(--muted)]">{r.reason}</p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-[rgba(21,128,61,0.12)] px-3 py-1 text-xs font-bold text-[var(--success)]"
                  onClick={() => onDecide(r.id, "approved")}
                >
                  {approveLabel}
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-[var(--danger-soft)] px-3 py-1 text-xs font-bold text-[var(--danger)]"
                  onClick={() => onDecide(r.id, "rejected")}
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: LeaveStatus }) {
  const label =
    status === "pending_l2"
      ? "Pending L2"
      : status === "pending"
        ? "Pending"
        : status;
  const cls =
    status === "approved"
      ? "bg-[rgba(21,128,61,0.12)] text-[var(--success)]"
      : status === "rejected"
        ? "bg-[var(--danger-soft)] text-[var(--danger)]"
        : status === "pending_l2"
          ? "bg-[rgba(197,160,40,0.2)] text-[var(--brand-deep)]"
          : "bg-[var(--surface-sunken)] text-[var(--muted)]";
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase ${cls}`}
    >
      {label}
    </span>
  );
}
