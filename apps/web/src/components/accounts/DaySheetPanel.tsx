"use client";
/* ratchet-allow: raw_table — the <table>s here are inside the HTML string written into a print popup, not JSX; the on-screen lists use ErpTable */
/* ratchet-allow: grids_without_row_menu — report output, not an operational list: these are the totals of a day already posted, grouped by tender. There is no row to act on; correcting one means reversing its voucher in Vouchers. */

/**
 * The day sheet the counter hands to the principal.
 *
 * One day of money, split by the account it moved through — cash, each bank —
 * and under each, what it was for. Collections on the left of the page,
 * expenses on the right, totals and a signature block, on one sheet.
 *
 * It shows a day and never a balance. What the school holds, and what it has
 * earned and spent across the session, sit behind `accounts_position`; this
 * panel deliberately asks for none of it, so the counter can run and print it
 * without being shown the school's position.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import type { AccountsPanelProps } from "@/components/accounts/AccountsPanels";

const CARD = "rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4";
const FIELD = "w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm";
const BTN =
  "rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50";

type Head = { code: string; name: string; paise: number; count: number };
type Tender = { code: string; name: string; paise: number; count: number; heads: Head[] };
type Side = { totalPaise: number; count: number; tenders: Tender[] };
type DaySheet = {
  ok: boolean;
  error?: string;
  date: string;
  collections: Side;
  expenses: Side;
  truncated: boolean;
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function inr(p: number): string {
  return `₹${(Math.round(p) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

export function DaySheetPanel({ onError, actorName }: AccountsPanelProps) {
  const [date, setDate] = useState(todayIso);
  const [sheet, setSheet] = useState<DaySheet | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (d: string) => {
      setLoading(true);
      try {
        const res = await fetch("/api/ledger", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "day-sheet", date: d }),
        });
        const json = (await res.json()) as DaySheet;
        setSheet(json);
        if (!json.ok && json.error) onError(json.error);
      } catch {
        setSheet(null);
        onError("Could not read the day — try again.");
      } finally {
        setLoading(false);
      }
    },
    [onError],
  );

  useEffect(() => {
    void load(date);
  }, [date, load]);

  function print() {
    if (!sheet?.ok) return;
    const w = window.open("", "_blank", "width=900,height=1100");
    if (!w) {
      onError("The browser blocked the print window — allow pop-ups for this site.");
      return;
    }
    w.document.write(printableDaySheet(sheet, actorName));
    w.document.close();
    w.focus();
    w.print();
  }

  const net = sheet?.ok ? sheet.collections.totalPaise - sheet.expenses.totalPaise : 0;

  return (
    <div className="mt-4 space-y-4">
      <div className={`${CARD} text-sm text-[var(--muted)]`}>
        One day of money, split by the account it moved through and by what it
        was for. Print it for the principal to sign and keep with the day&rsquo;s
        records. This sheet shows a single day only — it carries no cash or bank
        balance and no session totals.
      </div>

      <div className={`${CARD} flex flex-wrap items-end gap-3`}>
        <div>
          <label className="block text-xs font-semibold text-[var(--muted)]">Date</label>
          <input
            type="date"
            className={`${FIELD} mt-1 w-48`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <button type="button" className={BTN} disabled={!sheet?.ok || loading} onClick={print}>
          Print for signature
        </button>
      </div>

      {loading ? (
        <div className={`${CARD} text-sm text-[var(--muted)]`}>Reading the day…</div>
      ) : !sheet?.ok ? (
        <div className={`${CARD} text-sm text-[var(--muted)]`}>
          {sheet?.error ?? "Could not read the day."}
        </div>
      ) : (
        <>
          {sheet.truncated ? (
            <div className={`${CARD} text-sm font-medium text-[var(--warning)]`}>
              This day has more entries than the sheet reads in one pass, so the
              totals below may be short. Do not sign this one — tell the office.
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <SideCard title="Collections" side={sheet.collections} />
            <SideCard title="Expenses" side={sheet.expenses} />
          </div>

          <div className={`${CARD} flex flex-wrap items-baseline justify-between gap-2`}>
            <span className="text-sm font-semibold text-[var(--brand-deep)]">
              Net for {longDate(sheet.date)}
            </span>
            <span className="text-sm">
              {inr(sheet.collections.totalPaise)} in − {inr(sheet.expenses.totalPaise)} out ={" "}
              <strong className="text-[var(--brand-deep)]">{inr(net)}</strong>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function SideCard({ title, side }: { title: string; side: Side }) {
  return (
    <div className={CARD}>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-[var(--brand-deep)]">{title}</span>
        <span className="text-sm font-semibold">{inr(side.totalPaise)}</span>
      </div>
      {side.tenders.length === 0 ? (
        <div className="mt-3 text-sm text-[var(--muted)]">Nothing recorded for this day.</div>
      ) : (
        <div className="mt-3">
          <ErpTableShell><ErpTable minWidth="min-w-[320px]">
            <ErpTableHead>
              <tr className="text-[11px] text-[var(--muted)]">
                <th className="px-3 py-2 text-left font-medium">Tender / head</th>
                <th className="px-3 py-2 text-right font-medium">Entries</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {side.tenders.map((t) => [
                <tr key={t.code} className="bg-[var(--muted-bg,transparent)]">
                  <td className="px-3 py-2 text-sm font-semibold text-[var(--brand-deep)]">
                    {t.name}
                  </td>
                  <td className="px-3 py-2 text-right text-sm">{t.count}</td>
                  <td className="px-3 py-2 text-right text-sm font-semibold">{inr(t.paise)}</td>
                </tr>,
                ...t.heads.map((h) => (
                  <tr key={`${t.code}:${h.code}`}>
                    <td className="px-3 py-2 pl-7 text-[13px] text-[var(--muted)]">{h.name}</td>
                    <td className="px-3 py-2 text-right text-[13px] text-[var(--muted)]">
                      {h.count}
                    </td>
                    <td className="px-3 py-2 text-right text-[13px]">{inr(h.paise)}</td>
                  </tr>
                )),
              ])}
            </ErpTableBody>
          </ErpTable></ErpTableShell>
        </div>
      )}
    </div>
  );
}

/** One sheet of A4: collections, expenses, totals, signatures. */
function printableDaySheet(sheet: DaySheet, actorName: string): string {
  const rows = (side: Side) =>
    side.tenders.length === 0
      ? `<tr><td colspan="2" class="muted">Nothing recorded</td></tr>`
      : side.tenders
          .map(
            (t) =>
              `<tr class="tender"><td>${esc(t.name)}</td><td class="amt">${inr(t.paise)}</td></tr>` +
              t.heads
                .map(
                  (h) =>
                    `<tr><td class="head">${esc(h.name)}</td><td class="amt head">${inr(h.paise)}</td></tr>`,
                )
                .join(""),
          )
          .join("");

  const net = sheet.collections.totalPaise - sheet.expenses.totalPaise;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Day sheet ${esc(sheet.date)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; font-size: 12px; }
  h1 { font-size: 16px; margin: 0; }
  .sub { font-size: 11px; color: #555; margin: 2px 0 14px; }
  .cols { display: flex; gap: 18px; align-items: flex-start; }
  .col { flex: 1; }
  h2 { font-size: 12px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
  .amt { text-align: right; white-space: nowrap; }
  .tender td { font-weight: 600; border-bottom: 1px solid #bbb; padding-top: 7px; }
  .head { padding-left: 14px; color: #444; font-weight: 400; }
  .muted { color: #777; }
  .tot { margin-top: 8px; border-top: 2px solid #111; padding-top: 5px; display: flex; justify-content: space-between; font-weight: 700; }
  .net { margin-top: 16px; border: 1px solid #111; padding: 7px 10px; display: flex; justify-content: space-between; font-weight: 700; }
  .sign { margin-top: 34px; display: flex; gap: 34px; }
  .sign div { flex: 1; border-top: 1px solid #111; padding-top: 5px; font-size: 11px; }
  .warn { margin-top: 10px; border: 1px solid #111; padding: 6px 9px; font-weight: 700; }
</style></head><body>
<h1>Daily collection &amp; expense sheet</h1>
<div class="sub">BHB International School · ${esc(longDate(sheet.date))} · prepared by ${esc(actorName || "—")} · printed ${esc(new Date().toLocaleString("en-IN"))}</div>
${sheet.truncated ? `<div class="warn">INCOMPLETE — this day has more entries than the sheet read. Do not sign.</div>` : ""}
<div class="cols">
  <div class="col">
    <h2>Collections — by tender</h2>
    <table>${rows(sheet.collections)}</table>
    <div class="tot"><span>Total collections</span><span>${inr(sheet.collections.totalPaise)}</span></div>
  </div>
  <div class="col">
    <h2>Expenses — by tender</h2>
    <table>${rows(sheet.expenses)}</table>
    <div class="tot"><span>Total expenses</span><span>${inr(sheet.expenses.totalPaise)}</span></div>
  </div>
</div>
<div class="net"><span>Net movement for the day</span><span>${inr(net)}</span></div>
<div class="sign">
  <div>Prepared by (counter)</div>
  <div>Checked by</div>
  <div>Principal — signature &amp; date</div>
</div>
</body></html>`;
}
