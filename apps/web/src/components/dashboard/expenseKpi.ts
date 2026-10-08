"use client";

import { useEffect, useState } from "react";
import type { DashboardKpi } from "@/components/dashboard/ModuleDashboard";
import { formatInr } from "@/lib/masters";
import { expenseRange, type ExpensePreset } from "@/lib/expenseRange";

/**
 * The Expenses tile in the home dashboard's "Finance & store" section — the
 * same tile as every other KPI there (director, 8 Oct 2026: "should be shown
 * on finance & store and same size as all other card"). Value: this month;
 * underneath: today, this week, last week. Tap → the month's expense heads,
 * with Accounts → Book reports for any other date range.
 *
 * Read from the server book (Ledger v2 income & expenditure — the same
 * figures as Accounts → Book reports), never from the accounts desk. An
 * expense counts on its voucher date; a posted payroll run is booked on the
 * last day of its month.
 */

type Line = { code: string; name: string; amountPaise: number };
type Section = { title: string; lines: Line[]; totalPaise: number };
type Report = { totalExpenditurePaise: number; expenditure: Section[] };

const PERIODS: { id: Exclude<ExpensePreset, "range">; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "lastweek", label: "Last week" },
  { id: "month", label: "This month" },
];

async function readReport(from: string, to: string): Promise<Report | null> {
  try {
    const res = await fetch("/api/ledger", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "income-expenditure", from, to }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; report?: Report } | null;
    return res.ok && body?.ok && body.report ? body.report : null;
  } catch {
    return null;
  }
}

function dateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** The Expenses KPI, or null when the viewer may not see it. */
export function useExpenseKpi(allowed: boolean): DashboardKpi | null {
  const [reports, setReports] = useState<Record<string, Report | null> | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    const now = new Date();
    void Promise.all(
      PERIODS.map(async (p) => {
        const r = expenseRange(p.id, now)!;
        return [p.id, await readReport(r.from, r.to)] as const;
      }),
    ).then((pairs) => {
      if (live) setReports(Object.fromEntries(pairs));
    });
    return () => {
      live = false;
    };
  }, [allowed]);

  if (!allowed) return null;
  const month = reports?.month ?? null;
  const fig = (id: string) => {
    if (!reports) return "…";
    const r = reports[id];
    // Unreadable is not zero.
    return r ? formatInr(r.totalExpenditurePaise) : "—";
  };
  const range = expenseRange("month", new Date())!;
  const heads = (month?.expenditure ?? [])
    .flatMap((s) => s.lines)
    .filter((l) => l.amountPaise !== 0)
    .sort((a, b) => b.amountPaise - a.amountPaise);

  return {
    id: "expenses",
    label: "Expenses · this month",
    value: fig("month"),
    breakdown: PERIODS.filter((p) => p.id !== "month").map((p) => ({ label: p.label, value: fig(p.id) })),
    hint: reports && !month ? "Server book unavailable" : "From the books · tap for heads",
    tone: "rose",
    href: "/accounts?tab=bookreports",
    detailTitle: `Expenses ${dateLabel(range.from)} – ${dateLabel(range.to)} by head (other dates: Accounts → Book reports)`,
    detailColumns: [
      { key: "head", label: "Head" },
      { key: "amount", label: "Amount", align: "right" },
    ],
    detailRows: heads.map((h) => ({ id: h.code, head: h.name, amount: formatInr(h.amountPaise) })),
  };
}
