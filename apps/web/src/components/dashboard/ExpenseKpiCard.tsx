"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatInr } from "@/lib/masters";
import { field } from "@/components/ui/erp-ui";
import { expenseRange, type ExpensePreset } from "@/lib/expenseRange";

/**
 * Expenses on the home dashboard — today, this week, this month, or any
 * date range (director, 7 Oct 2026: "make a kpi on dashboard by
 * today/weekly/monthly and date range for expenses").
 *
 * Read from the server book (Ledger v2 income & expenditure — the same
 * figures as Accounts → Book reports), never from the accounts desk, which
 * holds fee receipts only. Expenses count on their voucher date: a posted
 * payroll run is booked on the last day of its month, whenever the salary is
 * actually paid.
 */

type Line = { code: string; name: string; amountPaise: number };
type Section = { title: string; lines: Line[]; totalPaise: number };
type Report = { totalExpenditurePaise: number; expenditure: Section[] };

const PRESETS: { id: ExpensePreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "range", label: "Date range" },
];

function dateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function ExpenseKpiCard() {
  const [preset, setPreset] = useState<ExpensePreset>("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const range = useMemo(() => expenseRange(preset, new Date(), from, to), [preset, from, to]);

  useEffect(() => {
    if (!range) return;
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch("/api/ledger", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "income-expenditure", from: range.from, to: range.to }),
        });
        const body = (await res.json().catch(() => null)) as
          | { ok?: boolean; report?: Report; error?: string }
          | null;
        if (!active) return;
        if (!res.ok || !body?.ok || !body.report) {
          setReport(null);
          setError(body?.error || "Could not read the expenses from the book.");
          return;
        }
        setReport(body.report);
      } catch {
        if (active) {
          setReport(null);
          setError("Could not read the expenses from the book.");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [range]);

  const heads = useMemo(() => {
    if (!report) return [];
    return report.expenditure
      .flatMap((s) => s.lines)
      .filter((l) => l.amountPaise !== 0)
      .sort((a, b) => b.amountPaise - a.amountPaise);
  }, [report]);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-[var(--shadow-1)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-[var(--brand-deep)]">Expenses</h2>
        <div className="inline-flex overflow-hidden rounded-lg border border-[var(--border)] text-sm" role="group" aria-label="Period">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              aria-pressed={preset === p.id}
              className={`px-3 py-1.5 font-semibold ${preset === p.id ? "bg-[var(--brand)] text-white" : "bg-[var(--card)] text-[var(--brand-deep)]"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {preset === "range" ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
          <label>
            <span className="mb-1 block text-[11px] text-[var(--muted)]">From</span>
            <input type="date" className={`${field} !py-1.5`} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-[11px] text-[var(--muted)]">To</span>
            <input type="date" className={`${field} !py-1.5`} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      ) : null}

      {!range ? (
        <p className="mt-4 text-sm text-[var(--muted)]">Choose a from and to date.</p>
      ) : (
        <>
          <p className="mt-3 text-[12px] text-[var(--muted)]">
            {range.from === range.to ? dateLabel(range.from) : `${dateLabel(range.from)} – ${dateLabel(range.to)}`}
          </p>
          <p className="mt-1 text-3xl font-bold text-[var(--brand-deep)]">
            {loading && !report ? "…" : error ? "—" : formatInr(report?.totalExpenditurePaise ?? 0)}
          </p>
          {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
          {!error && report ? (
            heads.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted)]">No expenses booked in this period.</p>
            ) : (
              <ul className="mt-3 divide-y divide-[var(--border)] text-sm">
                {heads.slice(0, 6).map((h) => (
                  <li key={h.code} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="truncate">{h.name}</span>
                    <span className="font-semibold tabular-nums">{formatInr(h.amountPaise)}</span>
                  </li>
                ))}
                {heads.length > 6 ? (
                  <li className="py-1.5 text-[12px] text-[var(--muted)]">
                    + {heads.length - 6} more head{heads.length - 6 === 1 ? "" : "s"}
                  </li>
                ) : null}
              </ul>
            )
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--muted)]">
            <span>Salary is booked on the last day of its month when the payroll run is posted.</span>
            <Link href="/accounts?tab=bookreports" className="font-semibold text-[var(--brand)] hover:underline">
              Open in Accounts →
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
