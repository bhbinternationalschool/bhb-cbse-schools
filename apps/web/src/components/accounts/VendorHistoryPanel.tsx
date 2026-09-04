"use client";

/**
 * A vendor's history — what we bought, what we owe, and how old the debt is.
 *
 * Deliberately shows TWO numbers rather than one "balance". An expense
 * voucher tags the vendor on both the expense debit and, when unpaid, the
 * payable credit, so a single blended total reads a settled cash purchase as
 * money owed. That mistake has already reached this screen once. Turnover and
 * outstanding are different questions and are answered separately.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, RefreshCcw } from "lucide-react";
import { formatInr } from "@/lib/fees";
import type { VendorStatement } from "@/lib/ledger/vendorHistory";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";

const CARD = "rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4";
const FIELD =
  "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

type VendorRow = {
  partyKey: string;
  name: string;
  outstandingPaise: number;
  lastActivityOn: string;
};

async function ledgerApi<T>(
  body: Record<string, unknown>,
): Promise<T & { ok?: boolean; error?: string }> {
  const res = await fetch("/api/ledger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T & { ok?: boolean; error?: string };
}

function ageTone(days: number): string {
  if (days >= 90) return "text-[var(--danger)]";
  if (days >= 30) return "text-amber-600";
  return "text-[var(--muted)]";
}

export function VendorHistoryPanel() {
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState("");
  const [statement, setStatement] = useState<VendorStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    void ledgerApi<{ vendors: VendorRow[] }>({ action: "vendor-accounts" })
      .then((r) => {
        if (r.ok && r.vendors) setVendors(r.vendors);
        else setError(r.error || "Could not read the vendor list");
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    if (!picked) {
      setStatement(null);
      return;
    }
    setError("");
    void ledgerApi<{ statement: VendorStatement }>({
      action: "vendor-statement",
      partyKey: picked,
    }).then((r) => {
      if (r.ok && r.statement) setStatement(r.statement);
      else {
        setStatement(null);
        setError(r.error || "Could not read that vendor's history");
      }
    });
  }, [picked]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle
      ? vendors.filter((v) => v.name.toLowerCase().includes(needle))
      : vendors;
  }, [vendors, q]);

  const totalOwed = vendors.reduce(
    (n, v) => n + Math.max(0, v.outstandingPaise),
    0,
  );

  return (
    <section className={`${CARD} mt-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-[var(--brand-deep)]">
            Vendor history
          </h4>
          <p className="text-[11px] text-[var(--muted)]">
            Every vendor the expense book knows. Outstanding is what is still
            owed on bills; purchased is everything ever bought from them.
          </p>
        </div>
        <button
          type="button"
          className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-bold"
          onClick={load}
          disabled={loading}
        >
          <RefreshCcw className="size-3" aria-hidden />
          {loading ? "Reading…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 md:grid-cols-[18rem_1fr]">
        <div>
          <label className="text-[11px] font-bold text-[var(--muted)]">
            <span className="flex items-center gap-1">
              <Search className="size-3" aria-hidden /> Find a vendor
            </span>
            <input
              className={FIELD}
              placeholder="name"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            {vendors.length} vendor(s) · {formatInr(totalOwed)} owed in total
          </p>
          <ul className="mt-2 max-h-[22rem] space-y-1 overflow-y-auto">
            {shown.map((v) => (
              <li key={v.partyKey}>
                <button
                  type="button"
                  onClick={() => setPicked(v.partyKey)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
                    picked === v.partyKey
                      ? "bg-[var(--brand-deep)]/10 font-bold"
                      : "hover:bg-[var(--surface-2)]"
                  }`}
                >
                  <span className="truncate">{v.name}</span>
                  <span
                    className={`shrink-0 tabular-nums ${
                      v.outstandingPaise > 0
                        ? "font-bold text-[var(--danger)]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    {v.outstandingPaise > 0 ? formatInr(v.outstandingPaise) : "settled"}
                  </span>
                </button>
              </li>
            ))}
            {shown.length === 0 ? (
              <li className="px-2 py-3 text-[11px] text-[var(--muted)]">
                {vendors.length
                  ? "No vendor by that name."
                  : "No vendors yet — they are created the first time an expense names one."}
              </li>
            ) : null}
          </ul>
        </div>

        <div>
          {!statement ? (
            <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted)]">
              Choose a vendor to see every bill and payment.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-3 rounded-xl bg-[var(--surface-sunken)] p-3">
                <Stat label="Outstanding" value={formatInr(statement.outstandingPaise)} strong />
                <Stat label="Billed" value={formatInr(statement.billedPaise)} />
                <Stat label="Paid" value={formatInr(statement.paidPaise)} />
                <Stat label="Purchased" value={formatInr(statement.purchasedPaise)} />
                {statement.oldestDueDays > 0 ? (
                  <div>
                    <p className="text-[10px] font-bold uppercase text-[var(--muted)]">
                      Oldest unpaid
                    </p>
                    <p className={`text-sm font-bold ${ageTone(statement.oldestDueDays)}`}>
                      {statement.oldestDueDays} days
                    </p>
                  </div>
                ) : null}
              </div>

              <ErpTableShell className="mt-3 overflow-x-auto" density="compact">
                <ErpTable minWidth="min-w-[42rem]" className="text-xs">
                  <ErpTableHead>
                    <tr>
                      <th className="py-1 pr-2">Date</th>
                      <th className="py-1 pr-2">Voucher</th>
                      <th className="py-1 pr-2">Account</th>
                      <th className="py-1 pr-2">What</th>
                      <th className="py-1 pr-2 text-right">Billed</th>
                      <th className="py-1 pr-2 text-right">Paid</th>
                      <th className="py-1 text-right">Owed after</th>
                    </tr>
                  </ErpTableHead>
                  <ErpTableBody hoverable>
                    {statement.rows.map((r, i) => (
                      <tr key={`${r.voucherNo}-${i}`}>
                        <td className="py-1 pr-2 tabular-nums">{r.date}</td>
                        <td className="py-1 pr-2">{r.voucherNo}</td>
                        <td className="py-1 pr-2 text-[var(--muted)]">
                          {r.accountName}
                        </td>
                        <td className="py-1 pr-2">
                          {r.narration}
                          {r.instrumentRef ? (
                            <span className="ml-1 text-[var(--muted)]">
                              ({r.instrumentRef})
                            </span>
                          ) : null}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">
                          {r.isPayable && r.creditPaise
                            ? formatInr(r.creditPaise)
                            : ""}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">
                          {r.isPayable && r.debitPaise ? formatInr(r.debitPaise) : ""}
                        </td>
                        <td className="py-1 text-right font-bold tabular-nums">
                          {r.isPayable ? formatInr(r.runningDuePaise) : ""}
                        </td>
                      </tr>
                    ))}
                    {statement.rows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-4 text-center text-[var(--muted)]">
                          Nothing booked against this vendor yet.
                        </td>
                      </tr>
                    ) : null}
                  </ErpTableBody>
                </ErpTable>
              </ErpTableShell>
              <p className="mt-2 text-[10px] text-[var(--muted)]">
                Rows without a Billed or Paid figure are the expense side of a
                voucher — what was bought, not what is owed. Reversed vouchers
                are left out entirely.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase text-[var(--muted)]">{label}</p>
      <p
        className={`text-sm tabular-nums ${
          strong ? "font-bold text-[var(--brand-deep)]" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
