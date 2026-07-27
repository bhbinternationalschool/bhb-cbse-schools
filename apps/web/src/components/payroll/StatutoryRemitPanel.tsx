"use client";

import { useEffect, useState } from "react";
import {
  downloadTextFile,
  formatInr,
} from "@/lib/payroll";
import {
  loadStatutoryRemit,
  markRemitDeposited,
  remitStatusLabel,
  statutoryRemitCsv,
  type StatutoryRemitBatch,
} from "@/lib/statutoryRemit";
import { useDemoSession } from "@/components/shell/SessionContext";

export function StatutoryRemitPanel() {
  const session = useDemoSession();
  const [batches, setBatches] = useState<StatutoryRemitBatch[]>([]);
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [challan, setChallan] = useState("");

  useEffect(() => {
    setBatches(loadStatutoryRemit().batches);
  }, [tick]);

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

  const pending = batches.filter((b) => b.status === "pending_deposit");
  const done = batches.filter((b) => b.status === "deposited");

  return (
    <div className="space-y-4">
      <p className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] px-4 py-3 text-sm text-[var(--muted)]">
        Staff on <strong className="text-[var(--brand-deep)]">PF</strong> /
        <strong className="text-[var(--brand-deep)]"> ESIC</strong> (Assign
        staff cover): employee share is deducted from salary and{" "}
        <strong className="text-[var(--brand-deep)]">
          deposited to Government
        </strong>{" "}
        with the employer share (EPFO / ESIC). Not paid to staff. Batches are
        created when a payroll run is approved.
      </p>
      {notice ? (
        <p className="text-sm font-medium text-[var(--brand-deep)]">{notice}</p>
      ) : null}
      {error ? (
        <p className="text-sm font-medium text-[#b42318]">{error}</p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
        <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-3 text-sm font-semibold text-[var(--brand-deep)]">
          Pending govt deposit ({pending.length})
        </div>
        <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
          {pending.map((b) => (
            <li key={b.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-[var(--brand-deep)]">
                    {b.month} · {b.lines.length} staff
                  </div>
                  <p className="text-[11px] text-[var(--muted)]">
                    PF {formatInr(b.pfTotal)} · ESIC {formatInr(b.esicTotal)} ·
                    Total {formatInr(b.grandTotal)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-1 text-[11px] font-semibold"
                    onClick={() => setOpenId(openId === b.id ? null : b.id)}
                  >
                    {openId === b.id ? "Hide" : "View"}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[rgba(32,48,80,0.18)] px-2.5 py-1 text-[11px] font-semibold"
                    onClick={() => {
                      downloadTextFile(
                        `govt_pf_esic_${b.month}.csv`,
                        statutoryRemitCsv(b),
                      );
                      flash("Govt remittance CSV downloaded");
                    }}
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-[#15803d] px-2.5 py-1 text-[11px] font-semibold text-white"
                    onClick={() => {
                      const r = markRemitDeposited({
                        batchId: b.id,
                        by: session.fullName,
                        challanNote: challan,
                      });
                      if (!r.ok) flash(r.error, true);
                      else {
                        flash("Marked deposited to Government");
                        setChallan("");
                        setTick((n) => n + 1);
                      }
                    }}
                  >
                    Mark deposited
                  </button>
                </div>
              </div>
              {openId === b.id ? (
                <div className="mt-3 overflow-x-auto rounded-lg border border-[rgba(32,48,80,0.1)]">
                  <table className="w-full min-w-[560px] text-left text-[11px]">
                    <thead>
                      <tr className="border-b border-[rgba(32,48,80,0.08)] text-[var(--muted)]">
                        <th className="px-2 py-1.5 font-medium">Staff</th>
                        <th className="px-2 py-1.5 font-medium">Cover</th>
                        <th className="px-2 py-1.5 font-medium">PF EE</th>
                        <th className="px-2 py-1.5 font-medium">PF ER</th>
                        <th className="px-2 py-1.5 font-medium">ESIC EE</th>
                        <th className="px-2 py-1.5 font-medium">ESIC ER</th>
                        <th className="px-2 py-1.5 font-medium">Govt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.lines.map((l) => (
                        <tr
                          key={l.staffId}
                          className="border-b border-[rgba(32,48,80,0.05)]"
                        >
                          <td className="px-2 py-1.5">
                            {l.fullName}
                            <div className="text-[var(--muted)]">
                              {l.empCode}
                            </div>
                          </td>
                          <td className="px-2 py-1.5">{l.statutoryCover}</td>
                          <td className="px-2 py-1.5">
                            {formatInr(l.pfEmployee)}
                          </td>
                          <td className="px-2 py-1.5">
                            {formatInr(l.pfEmployer)}
                          </td>
                          <td className="px-2 py-1.5">
                            {formatInr(l.esicEmployee)}
                          </td>
                          <td className="px-2 py-1.5">
                            {formatInr(l.esicEmployer)}
                          </td>
                          <td className="px-2 py-1.5 font-semibold">
                            {formatInr(
                              l.pfEmployee +
                                l.pfEmployer +
                                l.esicEmployee +
                                l.esicEmployer,
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </li>
          ))}
          {pending.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-[var(--muted)]">
              No pending deposits — approve a payroll run with PF/ESIC staff.
            </li>
          ) : null}
        </ul>
        {pending.length > 0 ? (
          <div className="border-t border-[rgba(32,48,80,0.08)] px-4 py-3">
            <label className="text-[11px] text-[var(--muted)]">
              Challan / UTR note (optional, applied on next Mark deposited)
              <input
                className="field mt-1 !py-1.5"
                placeholder="EPFO / ESIC challan no."
                value={challan}
                onChange={(e) => setChallan(e.target.value)}
              />
            </label>
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white">
        <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-3 text-sm font-semibold text-[var(--brand-deep)]">
          Deposited history ({done.length})
        </div>
        <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
          {done.map((b) => (
            <li key={b.id} className="px-4 py-3 text-sm">
              <div className="font-semibold text-[var(--brand-deep)]">
                {b.month} · {remitStatusLabel(b.status)} ·{" "}
                {formatInr(b.grandTotal)}
              </div>
              <p className="text-[11px] text-[var(--muted)]">
                By {b.depositedBy}
                {b.challanNote ? ` · ${b.challanNote}` : ""} · PF{" "}
                {formatInr(b.pfTotal)} · ESIC {formatInr(b.esicTotal)}
              </p>
            </li>
          ))}
          {done.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-[var(--muted)]">
              No deposited batches yet.
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
