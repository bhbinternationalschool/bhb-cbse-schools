"use client";

import { useEffect, useMemo, useState } from "react";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  formatInr,
  PAYROLL_PAYMENT_MODES,
  type PayrollPaymentMode,
} from "@/lib/payroll";
import {
  advancesForStaff,
  advanceSourceLabel,
  advanceSummary,
  formatRecoveryDetail,
  issueStaffAdvance,
  loadAdvances,
  outstandingOf,
  outstandingForStaff,
  recordAdvanceReturnToSchool,
  recoveredTotal,
  recoveryMethodLabel,
  voidStaffAdvance,
  type StaffAdvance,
} from "@/lib/staffAdvance";
import { useDemoSession } from "@/components/shell/SessionContext";

export function AdvancesPanel({ readOnly = false }: { readOnly?: boolean }) {
  const session = useDemoSession();
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [advances, setAdvances] = useState<StaffAdvance[]>([]);
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [staffId, setStaffId] = useState("");
  const [amount, setAmount] = useState(0);
  const [givenDate, setGivenDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [mode, setMode] = useState<PayrollPaymentMode>("cash");
  const [note, setNote] = useState("");
  const [showClosed, setShowClosed] = useState(true);

  const [viewStaffId, setViewStaffId] = useState("");
  const [returnStaffId, setReturnStaffId] = useState("");
  const [returnAmount, setReturnAmount] = useState(0);
  const [returnDate, setReturnDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [returnMode, setReturnMode] =
    useState<PayrollPaymentMode>("cash");
  const [returnNote, setReturnNote] = useState("");

  useEffect(() => {
    setMasters(loadMasters());
    setAdvances(loadAdvances().advances);
  }, [tick]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void (async () => {
      const { ensureStaffAdvancesHydrated } = await import(
        "@/lib/staffAdvancesPersistence"
      );
      await ensureStaffAdvancesHydrated();
      setTick((t) => t + 1);
    })();
  }, []);

  const roster = useMemo(
    () =>
      (masters?.staff ?? [])
        .filter((s) => s.status === "active")
        .sort((a, b) => a.empCode.localeCompare(b.empCode)),
    [masters],
  );

  const summary = useMemo(() => advanceSummary(masters), [masters, tick]);

  const visible = useMemo(() => {
    let list = advances;
    if (viewStaffId) {
      list = advancesForStaff(viewStaffId);
    } else if (!showClosed) {
      list = advances.filter((a) => outstandingOf(a) > 0);
    }
    return [...list].sort((a, b) => b.givenDate.localeCompare(a.givenDate));
  }, [advances, showClosed, viewStaffId, tick]);

  const viewDue = viewStaffId ? outstandingForStaff(viewStaffId) : 0;
  const returnDue = returnStaffId ? outstandingForStaff(returnStaffId) : 0;

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

  function refresh() {
    setTick((t) => t + 1);
  }

  function onIssue() {
    if (!masters) return;
    const r = issueStaffAdvance({
      masters,
      staffId,
      amount,
      givenDate,
      paymentMode: mode,
      note,
      createdBy: session.fullName,
      source: "cash",
    });
    if (!r.ok) return flash(r.error, true);
    flash(
      `Advance ${formatInr(r.advance.amount)} issued to ${r.advance.empCode}`,
    );
    setAmount(0);
    setNote("");
    setViewStaffId(staffId);
    refresh();
  }

  function onVoid(id: string) {
    if (!window.confirm("Delete this advance entry? (only if no recoveries)")) {
      return;
    }
    const r = voidStaffAdvance(id);
    if (!r.ok) return flash(r.error, true);
    flash("Advance removed");
    refresh();
  }

  function onReturn() {
    const r = recordAdvanceReturnToSchool({
      staffId: returnStaffId,
      amount: returnAmount,
      returnDate,
      returnMode,
      note: returnNote,
      by: session.fullName,
    });
    if (!r.ok) return flash(r.error, true);
    flash(`Returned ${formatInr(r.applied)} to school`);
    setReturnAmount(0);
    setReturnNote("");
    setViewStaffId(returnStaffId);
    refresh();
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <p className="text-sm font-medium text-[var(--brand-deep)]">{notice}</p>
      ) : null}
      {error ? (
        <p className="text-sm font-medium text-[#b42318]">{error}</p>
      ) : null}

      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="font-display text-lg font-bold text-[var(--brand-deep)]">
          Staff advances
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Issue cash advances here. Payroll outstanding is locked to ledger due.
          Recover via salary deduct (on publish) or record return to school.
          New advance with salary is entered on the payroll draft line.
        </p>
        <p className="mt-2 text-sm text-[var(--brand-deep)]">
          Open {summary.openCount} · Outstanding{" "}
          <strong>{formatInr(summary.outstandingTotal)}</strong>
        </p>
      </div>

      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h3 className="mb-2 text-sm font-bold text-[var(--brand-deep)]">
          Check staff advances
        </h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-[var(--muted)]">
            Staff
            <select
              className="field mt-1 min-w-[240px] !py-2"
              value={viewStaffId}
              onChange={(e) => setViewStaffId(e.target.value)}
            >
              <option value="">All staff</option>
              {roster.map((s) => {
                const due =
                  summary.byStaff.find((x) => x.staffId === s.id)
                    ?.outstanding || 0;
                return (
                  <option key={s.id} value={s.id}>
                    {s.empCode} — {s.fullName}
                    {due > 0 ? ` · due ${formatInr(due)}` : ""}
                  </option>
                );
              })}
            </select>
          </label>
          {viewStaffId ? (
            <p className="pb-2 text-sm font-semibold text-[var(--brand-deep)]">
              Outstanding {formatInr(viewDue)}
            </p>
          ) : null}
        </div>
      </div>

      {readOnly ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          View only — you need <strong>Staff advances only → Edit</strong> to
          issue advances or record returns.
        </p>
      ) : null}

      <div
        className={`grid gap-3 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4 sm:grid-cols-2 lg:grid-cols-3 ${readOnly ? "pointer-events-none opacity-60" : ""}`}
      >
        <p className="sm:col-span-2 lg:col-span-3 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
          Issue advance (cash / direct)
        </p>
        <label className="text-xs font-semibold text-[var(--muted)] sm:col-span-2 lg:col-span-1">
          Staff
          <select
            className="field mt-1 !py-2"
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
          >
            <option value="">Select…</option>
            {roster.map((s) => (
              <option key={s.id} value={s.id}>
                {s.empCode} — {s.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-[var(--muted)]">
          Amount ₹
          <input
            type="number"
            min={0}
            className="field mt-1 !py-2"
            value={amount || ""}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
          />
        </label>
        <label className="text-xs font-semibold text-[var(--muted)]">
          Given date
          <input
            type="date"
            className="field mt-1 !py-2"
            value={givenDate}
            onChange={(e) => setGivenDate(e.target.value)}
          />
        </label>
        <label className="text-xs font-semibold text-[var(--muted)]">
          Mode paid
          <select
            className="field mt-1 !py-2"
            value={mode}
            onChange={(e) => setMode(e.target.value as PayrollPaymentMode)}
          >
            {PAYROLL_PAYMENT_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-[var(--muted)] sm:col-span-2">
          Note
          <input
            className="field mt-1 !py-2"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason / reference"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white"
            onClick={onIssue}
          >
            Issue advance
          </button>
        </div>
      </div>

      <div
        className={`grid gap-3 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4 sm:grid-cols-2 lg:grid-cols-3 ${readOnly ? "pointer-events-none opacity-60" : ""}`}
      >
        <p className="sm:col-span-2 lg:col-span-3 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
          Return to school (cash / UPI / bank)
        </p>
        <label className="text-xs font-semibold text-[var(--muted)]">
          Staff
          <select
            className="field mt-1 !py-2"
            value={returnStaffId}
            onChange={(e) => {
              setReturnStaffId(e.target.value);
              setReturnAmount(0);
            }}
          >
            <option value="">Select…</option>
            {roster.map((s) => {
              const due =
                summary.byStaff.find((x) => x.staffId === s.id)?.outstanding ||
                0;
              if (due <= 0 && !summary.byStaff.some((x) => x.staffId === s.id)) {
                /* still list all for clarity */
              }
              return (
                <option key={s.id} value={s.id}>
                  {s.empCode} — {s.fullName}
                  {due > 0 ? ` · due ${formatInr(due)}` : ""}
                </option>
              );
            })}
          </select>
        </label>
        <label className="text-xs font-semibold text-[var(--muted)]">
          Return amount ₹
          <input
            type="number"
            min={0}
            max={returnDue || undefined}
            className="field mt-1 !py-2"
            value={returnAmount || ""}
            onChange={(e) => setReturnAmount(Number(e.target.value) || 0)}
          />
          {returnStaffId ? (
            <span className="mt-0.5 block text-[10px] font-normal">
              Max {formatInr(returnDue)}
            </span>
          ) : null}
        </label>
        <label className="text-xs font-semibold text-[var(--muted)]">
          Return date
          <input
            type="date"
            className="field mt-1 !py-2"
            value={returnDate}
            onChange={(e) => setReturnDate(e.target.value)}
          />
        </label>
        <label className="text-xs font-semibold text-[var(--muted)]">
          Mode received
          <select
            className="field mt-1 !py-2"
            value={returnMode}
            onChange={(e) =>
              setReturnMode(e.target.value as PayrollPaymentMode)
            }
          >
            {PAYROLL_PAYMENT_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-[var(--muted)] sm:col-span-2">
          Note
          <input
            className="field mt-1 !py-2"
            value={returnNote}
            onChange={(e) => setReturnNote(e.target.value)}
            placeholder="Receipt / reference"
          />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)]"
            disabled={!returnStaffId || returnDue <= 0}
            onClick={() => setReturnAmount(returnDue)}
          >
            Full outstanding
          </button>
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white"
            onClick={onReturn}
          >
            Record return
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Ledger
            {viewStaffId ? " · selected staff" : ""}
          </h3>
          {!viewStaffId ? (
            <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <input
                type="checkbox"
                checked={showClosed}
                onChange={(e) => setShowClosed(e.target.checked)}
              />
              Show closed
            </label>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[rgba(32,48,80,0.1)] text-[var(--muted)]">
                <th className="py-2 pr-2 font-semibold">Staff / advance</th>
                <th className="py-2 pr-2 font-semibold">Given</th>
                <th className="py-2 pr-2 font-semibold">Amount</th>
                <th className="py-2 pr-2 font-semibold">Outstanding</th>
                <th className="py-2 pr-2 font-semibold">
                  Recoveries (salary month / return)
                </th>
                <th className="py-2 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => {
                const bal = outstandingOf(a);
                return (
                  <tr
                    key={a.id}
                    className="border-b border-[rgba(32,48,80,0.06)] align-top"
                  >
                    <td className="py-2 pr-2">
                      <span className="font-semibold text-[var(--brand-deep)]">
                        {a.empCode}
                      </span>
                      <span className="block text-[var(--muted)]">
                        {a.fullName}
                      </span>
                      <span className="block text-[10px] text-[var(--muted)]">
                        {advanceSourceLabel(a.source)}
                        {a.note ? ` · ${a.note}` : ""}
                      </span>
                    </td>
                    <td className="py-2 pr-2">
                      {a.givenDate}
                      <span className="block text-[10px] text-[var(--muted)]">
                        {a.paymentMode}
                      </span>
                    </td>
                    <td className="py-2 pr-2">
                      {formatInr(a.amount)}
                      <span className="block text-[10px] text-[var(--muted)]">
                        recovered {formatInr(recoveredTotal(a))}
                      </span>
                    </td>
                    <td className="py-2 pr-2 font-semibold">
                      {formatInr(bal)}
                      {bal <= 0 ? (
                        <span className="ml-1 text-[10px] text-teal-700">
                          closed
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">
                      {a.recoveries.length === 0 ? (
                        <span className="text-[var(--muted)]">—</span>
                      ) : (
                        <ul className="space-y-1">
                          {a.recoveries.map((r) => (
                            <li key={r.id}>
                              <span className="font-semibold text-[var(--brand-deep)]">
                                {formatInr(r.amount)}
                              </span>
                              <span className="text-[var(--muted)]">
                                {" "}
                                · {recoveryMethodLabel(r.method)}
                              </span>
                              <span className="block text-[10px] text-[var(--muted)]">
                                {formatRecoveryDetail(r)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {!readOnly &&
                      a.recoveries.length === 0 &&
                      a.source !== "with_salary" ? (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-[#b42318]"
                          onClick={() => onVoid(a.id)}
                        >
                          Delete
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-6 text-center text-sm text-[var(--muted)]"
                  >
                    {viewStaffId
                      ? "No advances for this staff."
                      : "No advances yet."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
