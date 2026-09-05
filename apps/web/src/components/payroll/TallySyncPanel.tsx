"use client";
// ratchet-allow: grids_without_row_menu — journal preview and export log — rows are voucher lines

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  currentMonthIso,
  formatInr,
  loadPayroll,
  payrollStatusLabel,
} from "@/lib/payroll";
import {
  buildTallyPreview,
  downloadTallyCsv,
  downloadTallyXml,
  listTallySync,
  markTallySynced,
  tallyFormatLabel,
} from "@/lib/tallySync";
import { monthLabel } from "@/components/payroll/PrintPayslipsPanel";
import { useDemoSession } from "@/components/shell/SessionContext";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import { useModuleStateHydration } from "@/lib/useModuleStateHydration";

export function TallySyncPanel({
  academicYearCode,
}: {
  academicYearCode: string;
}) {
  const session = useDemoSession();
  const [month, setMonth] = useState(currentMonthIso);
  const [tick, setTick] = useState(0);
  // Re-read when the server copy of this module lands (login/refresh hydration).
  useModuleStateHydration(["tally_sync", "salary_account"], () => setTick((t) => t + 1));
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const monthsAvailable = useMemo(() => {
    void tick;
    const set = new Set<string>();
    for (const r of loadPayroll().runs) {
      if (r.academicYearCode !== academicYearCode) continue;
      if (r.status === "posted" || r.status === "paid") set.add(r.month);
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [academicYearCode, tick]);

  useEffect(() => {
    if (monthsAvailable.length && !monthsAvailable.includes(month)) {
      setMonth(monthsAvailable[0]);
    }
  }, [monthsAvailable, month]);

  const preview = useMemo(() => {
    void tick;
    return buildTallyPreview({ month, academicYearCode });
  }, [month, academicYearCode, tick]);

  const history = useMemo(() => {
    void tick;
    return listTallySync(25);
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
    }, 4500);
  }

  function refresh() {
    setTick((t) => t + 1);
  }

  function onCsv() {
    if (!preview.jv) return;
    const r = downloadTallyCsv(preview.jv, session.fullName || "Accounts");
    if (!r.ok) flash(r.error, true);
    else {
      flash(r.message);
      refresh();
    }
  }

  function onXml() {
    if (!preview.jv) return;
    const r = downloadTallyXml(preview.jv, session.fullName || "Accounts");
    if (!r.ok) flash(r.error, true);
    else {
      flash(r.message);
      refresh();
    }
  }

  function onMarkSynced() {
    if (!preview.jv) return;
    if (preview.jv.error || !preview.jv.balanced) {
      flash(preview.jv.error || "Journal not balanced", true);
      return;
    }
    markTallySynced({
      jv: preview.jv,
      format: "manual",
      by: session.fullName || "Accounts",
    });
    flash(`Marked synced · ${preview.jv.voucherNo}`);
    refresh();
  }

  const jv = preview.jv;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
        <h2 className="font-display text-lg font-bold text-[var(--brand-deep)]">
          Tally / accounting sync
        </h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Consolidated Journal Voucher from published payroll — import CSV or
          TallyPrime XML. Ledger names from salary heads (
          <Link
            href="/masters"
            className="font-semibold text-[var(--brand-deep)] underline-offset-2 hover:underline"
          >
            Masters → Salary setup
          </Link>
          ).
        </p>

        {notice ? (
          <p className="mt-2 text-sm font-medium text-[var(--brand-deep)]">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-sm font-medium text-[var(--danger)]">{error}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-[var(--muted)]">
            Month
            <select
              className="field mt-1 !py-2"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              {monthsAvailable.length === 0 ? (
                <option value={month}>{monthLabel(month)} (none yet)</option>
              ) : (
                monthsAvailable.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))
              )}
            </select>
          </label>

          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            onClick={onCsv}
            disabled={!jv?.balanced}
          >
            Download journal CSV
          </button>
          <button
            type="button"
            className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-40"
            onClick={onXml}
            disabled={!jv?.balanced}
          >
            Download Tally XML
          </button>
          <button
            type="button"
            className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-semibold text-[var(--muted)] disabled:opacity-40"
            onClick={onMarkSynced}
            disabled={!jv?.balanced}
          >
            Mark synced
          </button>
          <button
            type="button"
            className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-2 text-xs font-semibold text-[var(--muted)]"
            onClick={refresh}
          >
            Refresh
          </button>
        </div>
      </div>

      {!jv && !preview.run ? (
        <p className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white px-4 py-3 text-sm text-[var(--muted)]">
          No published payroll for {monthLabel(month)}. Publish a run to salary
          account first (approved-only is not enough).
        </p>
      ) : null}

      {preview.run && preview.run.status === "approved" && !jv ? (
        <p className="rounded-xl border border-[rgba(197,160,40,0.35)] bg-[rgba(197,160,40,0.1)] px-4 py-3 text-sm text-[var(--brand-deep)]">
          Run is approved but not published — publish to salary account before
          Tally sync.
        </p>
      ) : null}

      {jv ? (
        <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-[var(--brand-deep)]">
                Voucher <strong>{jv.voucherNo}</strong> ·{" "}
                {payrollStatusLabel(preview.run!.status)} · {jv.staffCount}{" "}
                staff · Date {jv.voucherDate}
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">{jv.narration}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Bank ledger:{" "}
                <strong className="text-[var(--brand-deep)]">
                  {jv.bankLedger}
                </strong>
                {preview.synced ? (
                  <>
                    {" "}
                    · Last sync{" "}
                    <strong className="text-teal-700">
                      {tallyFormatLabel(preview.synced.format)}
                    </strong>{" "}
                    {new Date(preview.synced.exportedAt).toLocaleString()}
                  </>
                ) : (
                  <span className="text-amber-800"> · Not synced yet</span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-xs">
              <div className="rounded-lg border border-[rgba(32,48,80,0.1)] px-3 py-2">
                <span className="text-[var(--muted)]">Debit</span>
                <p className="font-semibold text-[var(--brand-deep)]">
                  {formatInr(jv.debitTotal)}
                </p>
              </div>
              <div className="rounded-lg border border-[rgba(32,48,80,0.1)] px-3 py-2">
                <span className="text-[var(--muted)]">Credit</span>
                <p className="font-semibold text-[var(--brand-deep)]">
                  {formatInr(jv.creditTotal)}
                </p>
              </div>
              <div className="rounded-lg border border-[rgba(32,48,80,0.1)] px-3 py-2">
                <span className="text-[var(--muted)]">Balance</span>
                <p
                  className={`font-semibold ${
                    jv.balanced ? "text-teal-700" : "text-[var(--danger)]"
                  }`}
                >
                  {jv.balanced ? "OK" : `Off ${formatInr(jv.imbalance)}`}
                </p>
              </div>
            </div>
          </div>

          {jv.error ? (
            <p className="mt-3 text-sm font-medium text-[var(--danger)]">{jv.error}</p>
          ) : null}

          <div className="mt-3 overflow-x-auto">
            <ErpTable className="text-xs">
              <ErpTableHead>
                <tr>
                  <th className="py-2 pr-2 font-semibold">Ledger</th>
                  <th className="py-2 pr-2 font-semibold text-right">Debit</th>
                  <th className="py-2 pr-2 font-semibold text-right">Credit</th>
                  <th className="py-2 font-semibold">Source</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {jv.lines.map((line) => (
                  <tr key={`${line.ledger}-${line.debit}-${line.credit}`}>
                    <td className="py-2 pr-2 font-semibold text-[var(--brand-deep)]">
                      {line.ledger}
                    </td>
                    <td className="py-2 pr-2 text-right font-mono">
                      {line.debit ? formatInr(line.debit) : "—"}
                    </td>
                    <td className="py-2 pr-2 text-right font-mono">
                      {line.credit ? formatInr(line.credit) : "—"}
                    </td>
                    <td className="py-2 text-[var(--muted)]">{line.tip}</td>
                  </tr>
                ))}
                {jv.lines.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-6 text-center text-sm text-[var(--muted)]"
                    >
                      No journal lines.
                    </td>
                  </tr>
                ) : null}
              </ErpTableBody>
            </ErpTable>
          </div>
        </div>
      ) : null}

      <ErpTableShell className="p-4" exportAs="tally_journal" exportTitle="Tally journal">
        <h3 className="font-display text-base font-bold text-[var(--brand-deep)]">
          Sync history
        </h3>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          Downloads auto-record. Use Mark synced if you posted manually in
          Tally.
        </p>
        <div className="mt-3 overflow-x-auto">
          <ErpTable className="text-xs">
            <ErpTableHead>
              <tr>
                <th className="py-2 pr-2 font-semibold">When</th>
                <th className="py-2 pr-2 font-semibold">Month</th>
                <th className="py-2 pr-2 font-semibold">Voucher</th>
                <th className="py-2 pr-2 font-semibold">Format</th>
                <th className="py-2 pr-2 font-semibold">Dr / Cr</th>
                <th className="py-2 font-semibold">By</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {history.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-2 text-[var(--muted)]">
                    {new Date(r.exportedAt).toLocaleString()}
                  </td>
                  <td className="py-2 pr-2">{monthLabel(r.month)}</td>
                  <td className="py-2 pr-2 font-semibold text-[var(--brand-deep)]">
                    {r.voucherNo}
                  </td>
                  <td className="py-2 pr-2">{tallyFormatLabel(r.format)}</td>
                  <td className="py-2 pr-2 font-mono">
                    {formatInr(r.debitTotal)} / {formatInr(r.creditTotal)}
                  </td>
                  <td className="py-2">{r.exportedBy}</td>
                </tr>
              ))}
              {history.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-6 text-center text-sm text-[var(--muted)]"
                  >
                    No Tally exports yet.
                  </td>
                </tr>
              ) : null}
            </ErpTableBody>
          </ErpTable>
        </div>
      </ErpTableShell>
    </div>
  );
}
