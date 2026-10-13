"use client";
/* ratchet-allow: raw_table — the <table>s here are inside the HTML string written into a print popup, not JSX; the on-screen lists use ErpTable */
/* ratchet-allow: grids_without_row_menu — report output, not an operational list: totals of days already posted, grouped by tender. Rows drill down (a head opens its vouchers, a voucher opens its detail, a day opens that day) but carry no actions; correcting an entry means reversing its voucher in Vouchers. */

/**
 * The day sheet the counter hands to the principal.
 *
 * A day of money — or a short range, up to a quarter — split by the account
 * it moved through (cash, each bank) and under each, what it was for.
 * Collections on the left of the page, expenses on the right, totals, a
 * per-day breakdown for a range, and a signature block.
 *
 * Cancelled entries — a reversed voucher and its reversal — are on neither
 * side. The 13 Oct 2026 clean-up dated each reversal on its original's day,
 * so a removed salary payment showed as an expense AND, through its
 * reversal, as a collection. They are counted, and listed apart on request.
 *
 * It shows movements and never a balance. What the school holds, and what it has
 * earned and spent across the session, sit behind `accounts_position`; this
 * panel deliberately asks for none of it, so the counter can run and print it
 * without being shown the school's position.
 */

import { PRINT_LETTERHEAD_CSS, printLetterheadHtml, printWhenImagesReady } from "@/lib/printLetterheadHtml";
import { useCallback, useEffect, useState } from "react";
import {
  pickedDays,
  sideForDay,
  toggleAllDays,
  type DaySheet,
  type DaySheetCancelled,
  type DaySheetDay,
  type DaySheetEntry,
  type DaySheetSide as Side,
} from "@/lib/ledger/daySheet";
import {
  VoucherDetailDialog,
  VoucherListDialog,
  rowOpenProps,
} from "@/components/accounts/VoucherDetailDialog";
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

const BTN_QUICK =
  "rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-50";

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayIso(): string {
  return localIso(new Date());
}

/** Today / Yesterday / This week (from Monday) / This month — the counter's usual asks. */
function quickRange(kind: "today" | "yesterday" | "week" | "month"): { from: string; to: string } {
  const now = new Date();
  if (kind === "today") return { from: localIso(now), to: localIso(now) };
  if (kind === "yesterday") {
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return { from: localIso(y), to: localIso(y) };
  }
  if (kind === "week") {
    const back = (now.getDay() + 6) % 7; // Monday = 0
    const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    return { from: localIso(mon), to: localIso(now) };
  }
  return { from: localIso(new Date(now.getFullYear(), now.getMonth(), 1)), to: localIso(now) };
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

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** "13 October 2026", or "1 May – 31 May 2026" for a range. */
function rangeLabel(from: string, to: string): string {
  if (from === to) return longDate(from);
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${from} – ${to}`;
  const sameYear = a.getFullYear() === b.getFullYear();
  const left = a.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${left} – ${b.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

export function DaySheetPanel({ onError, actorName }: AccountsPanelProps) {
  const [from, setFrom] = useState(todayIso);
  const [to, setTo] = useState(todayIso);
  const [sheet, setSheet] = useState<DaySheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  // Drill-down: a head opens its vouchers; a cancelled row opens its voucher.
  const [list, setList] = useState<{ title: string; subtitle: string; entries: DaySheetEntry[] } | null>(null);
  const [openVoucher, setOpenVoucher] = useState<string | null>(null);
  // Days ticked for "Print selected days", and whether the range summary
  // prints in front of them.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [withSummary, setWithSummary] = useState(false);

  const load = useCallback(
    async (f: string, t: string) => {
      setLoading(true);
      try {
        const res = await fetch("/api/ledger", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "day-sheet", from: f, to: t }),
        });
        const json = (await res.json()) as DaySheet;
        setSheet(json);
        // A refused range (too long, To before From) is said on the sheet
        // itself; only a failed read is worth the error banner.
        if (!json.ok && json.error && !/days|before the From|yyyy-mm-dd/.test(json.error)) {
          onError(json.error);
        }
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
    void load(from, to);
    setPicked(new Set());
  }, [from, to, load]);

  function openPrint(title: string, bodies: string[]) {
    const w = window.open("", "_blank", "width=900,height=1100");
    if (!w) {
      onError("The browser blocked the print window — allow pop-ups for this site.");
      return;
    }
    w.document.write(printableDocument(title, bodies));
    w.document.close();
    printWhenImagesReady(w);
  }

  function print() {
    if (!sheet?.ok) return;
    openPrint(`Day sheet ${rangeLabel(sheet.from, sheet.to)}`, [
      printableSheetBody(sheet, actorName, showCancelled),
    ]);
  }

  /** One sheet per ticked day, cut from the range already read. */
  function printSelectedDays() {
    if (!sheet?.ok) return;
    const dates = pickedDays(sheet.days, picked);
    if (dates.length === 0) return;
    const bodies = dates.map((d) =>
      printableSheetBody(
        {
          from: d,
          to: d,
          collections: sideForDay(sheet.collections, d),
          expenses: sideForDay(sheet.expenses, d),
          days: [],
          cancelled: sheet.cancelled.filter((c) => c.date === d),
          truncated: sheet.truncated,
        },
        actorName,
        showCancelled,
      ),
    );
    if (withSummary) bodies.unshift(printableSheetBody(sheet, actorName, showCancelled));
    openPrint(`Day sheets ${rangeLabel(dates[0]!, dates[dates.length - 1]!)}`, bodies);
  }

  function openHead(side: string, tender: string, head: { name: string; entries: DaySheetEntry[] }) {
    if (!sheet?.ok) return;
    setList({
      title: `${head.name} — ${side.toLowerCase()} through ${tender}`,
      subtitle: rangeLabel(sheet.from, sheet.to),
      entries: head.entries,
    });
  }

  const net = sheet?.ok ? sheet.collections.totalPaise - sheet.expenses.totalPaise : 0;
  const cancelled = sheet?.ok ? (sheet.cancelled ?? []) : [];
  const isRange = !!sheet?.ok && sheet.from !== sheet.to;

  return (
    <div className="mt-4 space-y-4">
      <div className={`${CARD} text-sm text-[var(--muted)]`}>
        A day of money — or a range of up to 92 days — split by the account it
        moved through and by what it was for. Print it for the principal to
        sign and keep with the day&rsquo;s records. It carries no cash or bank
        balance. Cancelled entries (a reversed voucher and its reversal) are
        left out of both sides.
      </div>

      <div className={`${CARD} flex flex-wrap items-end gap-3`}>
        <div>
          <label className="block text-xs font-semibold text-[var(--muted)]">From</label>
          <input
            type="date"
            className={`${FIELD} mt-1 w-44`}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[var(--muted)]">To</label>
          <input
            type="date"
            className={`${FIELD} mt-1 w-44`}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["today", "Today"],
              ["yesterday", "Yesterday"],
              ["week", "This week"],
              ["month", "This month"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={BTN_QUICK}
              onClick={() => {
                const r = quickRange(k);
                setFrom(r.from);
                setTo(r.to);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className={BTN} disabled={!sheet?.ok || loading} onClick={print}>
          Print for signature
        </button>
      </div>

      {loading ? (
        <div className={`${CARD} text-sm text-[var(--muted)]`}>Reading the day…</div>
      ) : !sheet?.ok ? (
        <div className={`${CARD} text-sm text-[var(--muted)]`}>
          {sheet?.error ?? "Could not read the sheet."}
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
            <SideCard title="Collections" side={sheet.collections} onOpenHead={openHead} />
            <SideCard title="Expenses" side={sheet.expenses} onOpenHead={openHead} />
          </div>

          <div className={`${CARD} flex flex-wrap items-baseline justify-between gap-2`}>
            <span className="text-sm font-semibold text-[var(--brand-deep)]">
              Net for {rangeLabel(sheet.from, sheet.to)}
            </span>
            <span className="text-sm">
              {inr(sheet.collections.totalPaise)} in − {inr(sheet.expenses.totalPaise)} out ={" "}
              <strong className="text-[var(--brand-deep)]">{inr(net)}</strong>
            </span>
          </div>

          {isRange ? (
            <div className={CARD}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--brand-deep)]">Day by day</span>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                    <input
                      type="checkbox"
                      checked={withSummary}
                      onChange={(e) => setWithSummary(e.target.checked)}
                    />
                    Print range summary too
                  </label>
                  <button
                    type="button"
                    className={BTN_QUICK}
                    disabled={picked.size === 0}
                    onClick={printSelectedDays}
                  >
                    Print selected days{picked.size ? ` (${picked.size})` : ""}
                  </button>
                </div>
              </div>
              {sheet.days.length === 0 ? (
                <div className="mt-3 text-sm text-[var(--muted)]">Nothing recorded in this range.</div>
              ) : (
                <div className="mt-3">
                  <ErpTableShell><div className="overflow-x-auto"><ErpTable minWidth="min-w-[320px]">
                    <ErpTableHead>
                      <tr className="text-[11px] text-[var(--muted)]">
                        <th className="w-8 px-3 py-2 text-left font-medium">
                          <input
                            type="checkbox"
                            aria-label="Select every day"
                            checked={sheet.days.length > 0 && sheet.days.every((d) => picked.has(d.date))}
                            onChange={() => setPicked(toggleAllDays(sheet.days, picked))}
                          />
                        </th>
                        <th className="px-3 py-2 text-left font-medium">Date</th>
                        <th className="px-3 py-2 text-right font-medium">Collections</th>
                        <th className="px-3 py-2 text-right font-medium">Expenses</th>
                      </tr>
                    </ErpTableHead>
                    <ErpTableBody>
                      {sheet.days.map((d) => (
                        <tr
                          key={d.date}
                          {...rowOpenProps(() => {
                            setFrom(d.date);
                            setTo(d.date);
                          }, `Open the sheet for ${shortDate(d.date)}`)}
                        >
                          {/* The tick is its own control: ticking is not opening the day. */}
                          <td
                            className="px-3 py-2"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              aria-label={`Print ${shortDate(d.date)}`}
                              checked={picked.has(d.date)}
                              onChange={() =>
                                setPicked((p) => {
                                  const n = new Set(p);
                                  if (n.has(d.date)) n.delete(d.date);
                                  else n.add(d.date);
                                  return n;
                                })
                              }
                            />
                          </td>
                          <td className="px-3 py-2 text-sm">{shortDate(d.date)}</td>
                          <td className="px-3 py-2 text-right text-sm">{inr(d.inPaise)}</td>
                          <td className="px-3 py-2 text-right text-sm">{inr(d.outPaise)}</td>
                        </tr>
                      ))}
                    </ErpTableBody>
                  </ErpTable></div></ErpTableShell>
                </div>
              )}
            </div>
          ) : null}

          {cancelled.length > 0 ? (
            <div className={CARD}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-[var(--muted)]">
                  {cancelled.length} cancelled {cancelled.length === 1 ? "entry" : "entries"} hidden
                  — reversed vouchers and their reversals, in neither total above.
                </span>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-deep)]">
                  <input
                    type="checkbox"
                    checked={showCancelled}
                    onChange={(e) => setShowCancelled(e.target.checked)}
                  />
                  Show cancelled entries
                </label>
              </div>
              {showCancelled ? (
                <div className="mt-3">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                    Cancelled — not money that moved
                  </p>
                  <ErpTableShell><div className="overflow-x-auto"><ErpTable minWidth="min-w-[40rem]">
                    <ErpTableHead>
                      <tr className="text-[11px] text-[var(--muted)]">
                        <th className="px-3 py-2 text-left font-medium">Date</th>
                        <th className="px-3 py-2 text-left font-medium">Voucher</th>
                        <th className="px-3 py-2 text-left font-medium">Narration</th>
                        <th className="px-3 py-2 text-left font-medium">Reason</th>
                        <th className="px-3 py-2 text-right font-medium">In</th>
                        <th className="px-3 py-2 text-right font-medium">Out</th>
                      </tr>
                    </ErpTableHead>
                    <ErpTableBody>
                      {cancelled.map((c) => (
                        <tr key={c.voucherNo} {...rowOpenProps(() => setOpenVoucher(c.voucherNo), `Open voucher ${c.voucherNo}`)}>
                          <td className="px-3 py-2 text-[13px]">{shortDate(c.date)}</td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {c.voucherNo}
                            <span className="block font-sans text-[11px] text-[var(--muted)]">
                              {c.role === "reversal"
                                ? `reverses ${c.pairedNo || "—"}`
                                : `reversed by ${c.pairedNo || "—"}`}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[13px] text-[var(--muted)]">
                            {c.role === "reversal" ? "Reversal" : c.narration || "—"}
                          </td>
                          <td className="px-3 py-2 text-[13px]">{c.reason || "—"}</td>
                          <td className="px-3 py-2 text-right text-[13px]">{c.inPaise ? inr(c.inPaise) : "—"}</td>
                          <td className="px-3 py-2 text-right text-[13px]">{c.outPaise ? inr(c.outPaise) : "—"}</td>
                        </tr>
                      ))}
                    </ErpTableBody>
                  </ErpTable></div></ErpTableShell>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {list ? (
        <VoucherListDialog
          title={list.title}
          subtitle={list.subtitle}
          entries={list.entries}
          onClose={() => setList(null)}
        />
      ) : null}
      {openVoucher ? (
        <VoucherDetailDialog target={{ voucherNo: openVoucher }} onClose={() => setOpenVoucher(null)} />
      ) : null}
    </div>
  );
}

function SideCard({
  title,
  side,
  onOpenHead,
}: {
  title: string;
  side: Side;
  onOpenHead: (side: string, tender: string, head: { name: string; entries: DaySheetEntry[] }) => void;
}) {
  return (
    <div className={CARD}>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-[var(--brand-deep)]">{title}</span>
        <span className="text-sm font-semibold">{inr(side.totalPaise)}</span>
      </div>
      {side.tenders.length === 0 ? (
        <div className="mt-3 text-sm text-[var(--muted)]">Nothing recorded.</div>
      ) : (
        <div className="mt-3">
          <ErpTableShell><div className="overflow-x-auto"><ErpTable minWidth="min-w-[320px]">
            <ErpTableHead>
              <tr className="text-[11px] text-[var(--muted)]">
                <th className="px-3 py-2 text-left font-medium">Tender / head</th>
                <th className="px-3 py-2 text-right font-medium">Entries</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {side.tenders.map((t) => {
                const open = rowOpenProps(
                  () => onOpenHead(title, t.name, { name: "All heads", entries: t.heads.flatMap((h) => h.entries) }),
                  `Open every ${title.toLowerCase()} entry through ${t.name}`,
                );
                return [
                <tr key={t.code} {...open} className={`${open.className} bg-[var(--muted-bg,transparent)]`}>
                  <td className="px-3 py-2 text-sm font-semibold text-[var(--brand-deep)]">
                    {t.name}
                  </td>
                  <td className="px-3 py-2 text-right text-sm">{t.count}</td>
                  <td className="px-3 py-2 text-right text-sm font-semibold">{inr(t.paise)}</td>
                </tr>,
                ...t.heads.map((h) => (
                  <tr
                    key={`${t.code}:${h.code}`}
                    {...rowOpenProps(() => onOpenHead(title, t.name, h), `Open the ${h.name} entries through ${t.name}`)}
                  >
                    <td className="px-3 py-2 pl-7 text-[13px] text-[var(--muted)]">{h.name}</td>
                    <td className="px-3 py-2 text-right text-[13px] text-[var(--muted)]">
                      {h.count}
                    </td>
                    <td className="px-3 py-2 text-right text-[13px]">{inr(h.paise)}</td>
                  </tr>
                )),
                ];
              })}
            </ErpTableBody>
          </ErpTable></div></ErpTableShell>
        </div>
      )}
    </div>
  );
}

/** What one printed sheet covers: the whole range, or one day cut from it. */
type PrintPart = {
  from: string;
  to: string;
  collections: Side;
  expenses: Side;
  days: DaySheetDay[];
  cancelled: DaySheetCancelled[];
  truncated: boolean;
};

/** One sheet of A4: collections, expenses, totals, signatures. */
function printableSheetBody(part: PrintPart, actorName: string, withCancelled: boolean): string {
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

  const net = part.collections.totalPaise - part.expenses.totalPaise;
  const isRange = part.from !== part.to;
  const label = rangeLabel(part.from, part.to);
  const days = isRange
    ? `<h2 style="margin-top:16px">Day by day</h2><table>` +
      (part.days.length === 0
        ? `<tr><td colspan="3" class="muted">Nothing recorded</td></tr>`
        : `<tr class="tender"><td>Date</td><td class="amt">Collections</td><td class="amt">Expenses</td></tr>` +
          part.days
            .map(
              (d) =>
                `<tr><td>${esc(shortDate(d.date))}</td><td class="amt">${inr(d.inPaise)}</td><td class="amt">${inr(d.outPaise)}</td></tr>`,
            )
            .join("")) +
      `</table>`
    : "";
  // Cancelled entries are never in the totals. They print only when the
  // screen is showing them, as their own clearly labelled list.
  const n = part.cancelled.length;
  const cancelled =
    n === 0
      ? ""
      : withCancelled
        ? `<h2 style="margin-top:16px">Cancelled entries — not money that moved (in neither total)</h2><table>` +
          part.cancelled
            .map(
              (c) =>
                `<tr><td>${esc(shortDate(c.date))}</td><td>${esc(c.voucherNo)}<br><span class="muted">${
                  c.role === "reversal" ? `reverses ${esc(c.pairedNo || "—")}` : `reversed by ${esc(c.pairedNo || "—")}`
                }</span></td><td>${esc(c.role === "reversal" ? "Reversal" : c.narration)}</td><td>${esc(c.reason)}</td><td class="amt">${inr(Math.max(c.inPaise, c.outPaise))}</td></tr>`,
            )
            .join("") +
          `</table>`
        : `<div class="sub">${n} cancelled entr${n === 1 ? "y" : "ies"} (reversed vouchers and their reversals) left out of both sides.</div>`;
  return `<section class="sheet">
${printLetterheadHtml()}
<h1>${isRange ? "Collection &amp; expense sheet" : "Daily collection &amp; expense sheet"}</h1>
<div class="sub">${esc(label)} · prepared by ${esc(actorName || "—")} · printed ${esc(new Date().toLocaleString("en-IN"))}</div>
${part.truncated ? `<div class="warn">INCOMPLETE — the sheet could not read every entry. Do not sign.</div>` : ""}
<div class="cols">
  <div class="col">
    <h2>Collections — by tender</h2>
    <table>${rows(part.collections)}</table>
    <div class="tot"><span>Total collections</span><span>${inr(part.collections.totalPaise)}</span></div>
  </div>
  <div class="col">
    <h2>Expenses — by tender</h2>
    <table>${rows(part.expenses)}</table>
    <div class="tot"><span>Total expenses</span><span>${inr(part.expenses.totalPaise)}</span></div>
  </div>
</div>
<div class="net"><span>Net movement for ${isRange ? "the period" : "the day"}</span><span>${inr(net)}</span></div>
${days}
${cancelled}
<div class="sign">
  <div>Prepared by (counter)</div>
  <div>Checked by</div>
  <div>Principal — signature &amp; date</div>
</div>
</section>`;
}

/** One print job: each part on its own page, letterhead and signatures on each. */
function printableDocument(title: string, bodies: string[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; font-size: 12px; }
  .sheet + .sheet { break-before: page; page-break-before: always; }
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
  ${PRINT_LETTERHEAD_CSS}
</style></head><body>
${bodies.join("\n")}
</body></html>`;
}
