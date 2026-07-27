"use client";

import { useEffect, useMemo, useState } from "react";
import {
  canApproveSalaryHoldAsSuperAdmin,
  describeHoldPolicy,
  holdStatusLabel,
  loadSalaryHold,
  markSettlementPaid,
  normalizeSalaryHoldSettings,
  openExitSettlement,
  saveSalaryHold,
  superAdminReleaseHolds,
  type ExitSettlement,
  type JuneSalaryHold,
  type SalaryHoldSettings,
} from "@/lib/salaryHold";
import { loadMasters, type MastersState } from "@/lib/masters";
import { formatInr, loadPayroll } from "@/lib/payroll";
import { useDemoSession } from "@/components/shell/SessionContext";

export function JuneHoldPanel() {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [holds, setHolds] = useState<JuneSalaryHold[]>([]);
  const [settlements, setSettlements] = useState<ExitSettlement[]>([]);
  const [settings, setSettings] = useState<SalaryHoldSettings>(
    normalizeSalaryHoldSettings(null),
  );
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [staffId, setStaffId] = useState("");
  const [noticeDate, setNoticeDate] = useState("");
  const [leavingDate, setLeavingDate] = useState("");
  const [runningMonth, setRunningMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  useEffect(() => {
    setMasters(loadMasters());
    const h = loadSalaryHold();
    setHolds(h.holds);
    setSettlements(h.settlements);
    setSettings(normalizeSalaryHoldSettings(h.settings));
  }, [tick]);

  const teaching = useMemo(
    () =>
      (masters?.staff ?? [])
        .filter((s) => s.status === "active" && s.stream === "teaching")
        .sort((a, b) => a.empCode.localeCompare(b.empCode)),
    [masters],
  );

  const isSuper = canApproveSalaryHoldAsSuperAdmin(session);

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

  function saveSettings() {
    const state = loadSalaryHold();
    saveSalaryHold({
      ...state,
      settings: normalizeSalaryHoldSettings(settings),
    });
    flash("June hold policy saved");
    setTick((n) => n + 1);
  }

  function estimateRunningMonth(): number {
    const payroll = loadPayroll();
    const run = payroll.runs.find(
      (r) =>
        r.month === runningMonth &&
        (r.status === "approved" || r.status === "paid" || r.status === "draft"),
    );
    const line = run?.lines.find((l) => l.staffId === staffId);
    return line?.netPay ?? 0;
  }

  function createSettlement() {
    const staff = masters?.staff.find((s) => s.id === staffId);
    if (!staff) {
      flash("Select teaching staff", true);
      return;
    }
    const result = openExitSettlement({
      staff,
      noticeDate,
      leavingDate,
      runningMonth,
      runningMonthAmount: estimateRunningMonth(),
      createdBy: session.fullName,
    });
    if (!result.ok) {
      flash(result.error, true);
      return;
    }
    flash(
      result.settlement.noticeOk
        ? "Settlement created — June hold released (notice OK)"
        : "Settlement created — June hold awaiting Super Admin",
    );
    setTick((n) => n + 1);
  }

  const openHolds = holds.filter(
    (h) =>
      h.status === "held" ||
      h.status === "pending_super_admin" ||
      h.status === "forfeited_incomplete_year",
  );

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] px-4 py-3 text-sm text-[var(--muted)]">
        {describeHoldPolicy(settings)}. Non-teaching staff are never held.
        Rebuild / approve a June payroll to post hold rows.
      </p>
      {notice ? (
        <p className="text-sm font-medium text-[var(--brand-deep)]">{notice}</p>
      ) : null}
      {error ? (
        <p className="text-sm font-medium text-[#b42318]">{error}</p>
      ) : null}

      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Hold policy
        </h2>
        <div className="mt-3 grid max-w-3xl gap-2 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-[11px] sm:col-span-3">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) =>
                setSettings({ ...settings, enabled: e.target.checked })
              }
            />
            Enable June / summer hold for teaching
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            Hold month (1–12)
            <input
              className="field mt-1 !py-1.5"
              type="number"
              min={1}
              max={12}
              value={settings.holdMonth}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  holdMonth: Number(e.target.value) || 6,
                })
              }
            />
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            Min years for June draw
            <input
              className="field mt-1 !py-1.5"
              type="number"
              min={0}
              max={5}
              value={settings.minServiceYearsForJuneDraw}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  minServiceYearsForJuneDraw: Number(e.target.value) || 1,
                })
              }
            />
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            Min notice months
            <input
              className="field mt-1 !py-1.5"
              type="number"
              min={1}
              max={6}
              value={settings.resignationNoticeMonthsMin}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  resignationNoticeMonthsMin: Number(e.target.value) || 2,
                })
              }
            />
          </label>
        </div>
        <button
          type="button"
          className="mt-3 rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
          onClick={saveSettings}
        >
          Save hold policy
        </button>
      </div>

      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Resignation settlement
        </h2>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          If notice ≥ {settings.resignationNoticeMonthsMin} months before
          leaving: running month + drawable June hold released. Otherwise June
          hold needs Super Admin.
        </p>
        <div className="mt-3 grid max-w-3xl gap-2 sm:grid-cols-2">
          <select
            className="field !py-1.5 sm:col-span-2"
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
          >
            <option value="">Teaching staff</option>
            {teaching.map((s) => (
              <option key={s.id} value={s.id}>
                {s.empCode} — {s.fullName}
              </option>
            ))}
          </select>
          <label className="text-[11px] text-[var(--muted)]">
            Intimation / notice date
            <input
              className="field mt-1 !py-1.5"
              type="date"
              value={noticeDate}
              onChange={(e) => setNoticeDate(e.target.value)}
            />
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            Leaving date
            <input
              className="field mt-1 !py-1.5"
              type="date"
              value={leavingDate}
              onChange={(e) => setLeavingDate(e.target.value)}
            />
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            Running salary month
            <input
              className="field mt-1 !py-1.5"
              type="month"
              value={runningMonth}
              onChange={(e) => setRunningMonth(e.target.value)}
            />
          </label>
          <div className="text-[11px] text-[var(--muted)]">
            Estimated running net
            <div className="mt-1 font-semibold text-[var(--brand-deep)]">
              {formatInr(estimateRunningMonth())}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="mt-3 rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-xs font-semibold text-white"
          onClick={createSettlement}
        >
          Create settlement
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
        <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-3 text-sm font-semibold text-[var(--brand-deep)]">
          Open June holds ({openHolds.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-[rgba(32,48,80,0.1)] text-[11px] text-[var(--muted)]">
                <th className="px-3 py-2 font-medium">Staff</th>
                <th className="px-3 py-2 font-medium">Month</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {openHolds.map((h) => (
                <tr
                  key={h.id}
                  className="border-b border-[rgba(32,48,80,0.06)]"
                >
                  <td className="px-3 py-2">
                    <div className="font-semibold text-[var(--brand-deep)]">
                      {h.fullName}
                    </div>
                    <div className="text-[10px] text-[var(--muted)]">
                      {h.empCode}
                    </div>
                  </td>
                  <td className="px-3 py-2">{h.month}</td>
                  <td className="px-3 py-2">{formatInr(h.amount)}</td>
                  <td className="px-3 py-2 text-[11px]">
                    {holdStatusLabel(h.status)}
                  </td>
                </tr>
              ))}
              {openHolds.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-6 text-center text-sm text-[var(--muted)]"
                  >
                    No open holds — approve a June teaching payroll to create
                    them.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
        <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-3 text-sm font-semibold text-[var(--brand-deep)]">
          Settlements
        </div>
        <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
          {settlements.map((s) => (
            <li key={s.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-[var(--brand-deep)]">
                    {s.fullName}{" "}
                    <span className="text-[10px] font-medium text-[var(--muted)]">
                      {s.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--muted)]">
                    Notice {s.noticeDate} → leave {s.leavingDate} (
                    {s.noticeMonths} mo
                    {s.noticeOk ? ", OK" : ", short"}) · Running{" "}
                    {formatInr(s.runningMonthAmount)} · June release{" "}
                    {formatInr(s.juneHoldReleaseAmount)} · Total{" "}
                    {formatInr(s.totalPayable)}
                  </p>
                  <p className="text-[10px] text-[var(--muted)]">{s.note}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {s.status === "pending_super_admin" && isSuper ? (
                    <button
                      type="button"
                      className="rounded-lg bg-[#15803d] px-2.5 py-1 text-[11px] font-semibold text-white"
                      onClick={() => {
                        const r = superAdminReleaseHolds({
                          settlementId: s.id,
                          by: session.fullName,
                        });
                        if (!r.ok) flash(r.error, true);
                        else {
                          flash("Super Admin released June hold");
                          setTick((n) => n + 1);
                        }
                      }}
                    >
                      Super Admin approve
                    </button>
                  ) : null}
                  {s.status === "approved" ? (
                    <button
                      type="button"
                      className="rounded-lg bg-[var(--brand-deep)] px-2.5 py-1 text-[11px] font-semibold text-white"
                      onClick={() => {
                        const r = markSettlementPaid(s.id, session.fullName);
                        if (!r.ok) flash(r.error, true);
                        else {
                          flash("Settlement marked paid");
                          setTick((n) => n + 1);
                        }
                      }}
                    >
                      Mark paid
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
          {settlements.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-[var(--muted)]">
              No exit settlements yet.
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
