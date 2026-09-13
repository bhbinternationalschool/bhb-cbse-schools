"use client";

/**
 * Finding a voucher in the book, and putting an unclassified one on a
 * proper head.
 *
 * WHY THIS REPLACED "RECENT VOUCHERS"
 * That table read the newest fifty by creation time. It answered "what just
 * happened" and could not answer "where is the March import" — 398 old-ERP
 * vouchers posted in one September afternoon sit behind hundreds of fee
 * receipts, so the only way to see them was to read the database. Every
 * filter here exists because somebody had to ask that question.
 *
 * WHY A CORRECTION IS A NEW JOURNAL
 * The book is append-only: a reversal is the record, and nothing rewrites a
 * posted line. Moving a line to another head therefore posts a journal that
 * takes the amount off the wrong head and puts it on the right one. Both stay
 * visible, which is what an auditor expects and what makes the fix reversible
 * in turn. The dialog says so rather than implying the old entry changed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Filter, RotateCcw, Search, X } from "lucide-react";
import { Dialog, DialogPopup } from "@/components/ui/dialog";
import { ErpTable, ErpTableBody, ErpTableHead } from "@/components/ui/erp-roster";
import { RowActionMenu } from "@/components/ui/erp-grid";
import {
  AmendVoucherDialog,
  VoidVoucherDialog,
  type PartyRow,
} from "@/components/accounts/VoucherAmendDialogs";
import {
  childCodesByParent,
  headGaps,
  type ChartAccount,
  type VoucherFacts,
  type VoucherFilter,
} from "@/lib/ledger/voucherFilter";

type ChartRow = {
  code: string;
  name: string;
  kind: string;
  parentCode: string;
  hasChildren: boolean;
  isCash: boolean;
  isBank: boolean;
};

type SearchResult = {
  ok: boolean;
  error?: string;
  rows: VoucherFacts[];
  total: number;
  facets: { voucherTypes: string[]; sourceTypes: string[] };
};

const CARD = "rounded-xl border border-[var(--border)] bg-[var(--card)] p-4";
const FIELD =
  "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-2 py-1.5 text-xs text-[var(--ink)]";
const BTN =
  "inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-bold text-[var(--primary-foreground)] disabled:opacity-40";
const BTN_OUTLINE =
  "inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-bold text-[var(--ink)] hover:bg-[var(--surface-sunken)] disabled:opacity-40";
const LABEL = "text-[11px] font-bold text-[var(--muted)]";

const rupees = (paise: number) =>
  "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PAGE = 100;

async function ledgerApi<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/ledger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return (await res.json()) as T;
}

export function VoucherBrowserPanel({ canEdit }: { canEdit: boolean }) {
  const [chart, setChart] = useState<ChartRow[]>([]);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [fixing, setFixing] = useState<VoucherFacts | null>(null);
  const [amending, setAmending] = useState<VoucherFacts | null>(null);
  const [voiding, setVoiding] = useState<VoucherFacts | null>(null);
  const [parties, setParties] = useState<PartyRow[]>([]);
  const [notice, setNotice] = useState("");

  // The draft is what the operator is typing; `applied` is what was searched.
  // Separating them stops every keystroke hitting a query that reads the book.
  const [draft, setDraft] = useState<VoucherFilter>({ status: "live" });
  const [applied, setApplied] = useState<VoucherFilter>({ status: "live" });

  const chartForFilter: ChartAccount[] = useMemo(
    () =>
      chart.map((a) => ({
        code: a.code,
        name: a.name,
        parentCode: a.parentCode || undefined,
        isCash: a.isCash,
        isBank: a.isBank,
      })),
    [chart],
  );
  const byParent = useMemo(() => childCodesByParent(chartForFilter), [chartForFilter]);

  useEffect(() => {
    void (async () => {
      const [a, p] = await Promise.all([
        ledgerApi<{ ok: boolean; accounts?: ChartRow[] }>({ action: "accounts" }),
        ledgerApi<{ ok: boolean; parties?: PartyRow[] }>({ action: "parties" }),
      ]);
      setChart(a.accounts ?? []);
      setParties(p.parties ?? []);
    })();
  }, []);

  const search = useCallback(
    async (filter: VoucherFilter, offset: number) => {
      setBusy(true);
      setError("");
      try {
        const r = await ledgerApi<SearchResult>({
          action: "search-vouchers",
          filter,
          limit: PAGE,
          offset,
        });
        if (!r.ok) setError(r.error || "Could not read the book");
        setResult(r);
      } catch {
        setError("Could not reach the server");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  useEffect(() => {
    void search(applied, page * PAGE);
  }, [search, applied, page]);

  function run() {
    setPage(0);
    setApplied(draft);
  }
  function clear() {
    const fresh: VoucherFilter = { status: "live" };
    setDraft(fresh);
    setPage(0);
    setApplied(fresh);
  }

  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const gapCount = rows.filter((v) => headGaps(v, chartForFilter, byParent).length > 0).length;

  /** Heads an operator may choose: postable leaves only, income and expenditure first. */
  const pickableHeads = useMemo(
    () => chart.filter((a) => !a.hasChildren && !a.isCash && !a.isBank),
    [chart],
  );

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-bold text-[var(--brand-deep)]">Vouchers</h4>
        <p className="text-[11px] text-[var(--muted)]">
          {busy
            ? "Reading the book…"
            : `${total.toLocaleString("en-IN")} match${total === 1 ? "" : "es"}${
                total > PAGE ? ` · showing ${page * PAGE + 1}–${Math.min((page + 1) * PAGE, total)}` : ""
              }`}
        </p>
      </div>

      {/* ── filters ─────────────────────────────────────────── */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className={`${LABEL} lg:col-span-2`}>
          Search
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted)]" aria-hidden />
            <input
              className={`${FIELD} pl-7`}
              placeholder="Voucher no., narration, head or party"
              value={draft.q ?? ""}
              onChange={(e) => setDraft({ ...draft, q: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") run();
              }}
            />
          </div>
        </label>
        <label className={LABEL}>
          From
          <input
            type="date"
            className={FIELD}
            value={draft.from ?? ""}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label className={LABEL}>
          To
          <input
            type="date"
            className={FIELD}
            value={draft.to ?? ""}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>

        <label className={LABEL}>
          Type
          <select
            className={FIELD}
            value={draft.voucherType ?? ""}
            onChange={(e) => setDraft({ ...draft, voucherType: e.target.value })}
          >
            <option value="">Any type</option>
            {(result?.facets.voucherTypes ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Source
          <select
            className={FIELD}
            value={draft.sourceType ?? ""}
            onChange={(e) => setDraft({ ...draft, sourceType: e.target.value })}
          >
            <option value="">Any source</option>
            {(result?.facets.sourceTypes ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Head
          <select
            className={FIELD}
            value={draft.accountCode ?? ""}
            onChange={(e) => setDraft({ ...draft, accountCode: e.target.value })}
          >
            <option value="">Any head</option>
            {chart.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Status
          <select
            className={FIELD}
            value={draft.status ?? "all"}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as VoucherFilter["status"] })}
          >
            <option value="live">Live only</option>
            <option value="all">Everything</option>
            <option value="reversed">Reversed</option>
            <option value="reversal">Reversals</option>
          </select>
        </label>

        <label className={LABEL}>
          Party
          <input
            className={FIELD}
            placeholder="Any party"
            value={draft.party ?? ""}
            onChange={(e) => setDraft({ ...draft, party: e.target.value })}
          />
        </label>
        <label className={LABEL}>
          Amount at least ₹
          <input
            className={FIELD}
            inputMode="decimal"
            placeholder="0"
            value={draft.minPaise != null ? String(draft.minPaise / 100) : ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                minPaise: e.target.value.trim() ? Math.round(Number(e.target.value) * 100) : undefined,
              })
            }
          />
        </label>
        <div className="flex items-end gap-3 sm:col-span-2">
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--ink)]">
            <input
              type="checkbox"
              checked={!!draft.needsHead}
              onChange={(e) => setDraft({ ...draft, needsHead: e.target.checked })}
            />
            Needs a head
          </label>
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--ink)]">
            <input
              type="checkbox"
              checked={!!draft.needsParty}
              onChange={(e) => setDraft({ ...draft, needsParty: e.target.checked })}
            />
            Needs a party
          </label>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} disabled={busy} onClick={run}>
          <Filter className="size-3.5" aria-hidden /> {busy ? "Searching…" : "Apply filters"}
        </button>
        <button type="button" className={BTN_OUTLINE} onClick={clear}>
          <RotateCcw className="size-3.5" aria-hidden /> Clear
        </button>
        <p className="text-[10px] text-[var(--muted)]">
          “Needs a head” finds lines parked on a catch-all like Other Expenses,
          or on a parent head whose sub-heads exist but were not used. Cash and
          bank lines are never counted — those say where the money sat, not
          what it was for.
        </p>
      </div>

      {error ? (
        <p className="mt-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-2 rounded-lg border border-[var(--success)]/35 bg-[var(--success-soft)] px-3 py-2 text-xs font-semibold text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {gapCount > 0 ? (
        <p className="mt-2 text-[11px] text-[var(--warning)]">
          {gapCount} of the {rows.length} shown {gapCount === 1 ? "has a line" : "have lines"} on a
          head that classifies nothing.
        </p>
      ) : null}

      {/* ── the list ────────────────────────────────────────── */}
      <div className="mt-3 overflow-x-auto">
        <ErpTable minWidth="min-w-[54rem]">
          <ErpTableHead>
            <tr>
              <th className="pb-2 text-left">No.</th>
              <th className="pb-2 text-left">Date</th>
              <th className="pb-2 text-left">Type</th>
              <th className="pb-2 text-left">Narration</th>
              <th className="pb-2 text-left">Heads</th>
              <th className="pb-2 text-right">Amount</th>
              <th className="pb-2 text-left">Source</th>
              <th className="w-10 px-2 py-2" aria-label="Actions" />
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {rows.map((v) => {
              const gaps = headGaps(v, chartForFilter, byParent);
              const amount = Math.max(
                v.lines.reduce((n, l) => n + l.debitPaise, 0),
                v.lines.reduce((n, l) => n + l.creditPaise, 0),
              );
              return (
                <tr key={v.id} className="align-top">
                  <td className="py-1.5 font-mono text-[11px]">{v.voucherNo}</td>
                  <td className="py-1.5 whitespace-nowrap">{v.date}</td>
                  <td className="py-1.5">
                    {v.voucherType}
                    {v.reversed ? (
                      <span className="ml-1 rounded bg-[var(--danger-soft)] px-1 text-[9px] font-bold text-[var(--danger)]">
                        reversed
                      </span>
                    ) : null}
                    {v.isReversal ? (
                      <span className="ml-1 rounded bg-[var(--surface-sunken)] px-1 text-[9px] font-bold text-[var(--muted)]">
                        reversal
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-[var(--muted)]">{v.narration}</td>
                  <td className="py-1.5">
                    {v.lines.map((l, i) => (
                      <div key={i} className="whitespace-nowrap">
                        <span className="font-mono text-[10px]">{l.accountCode}</span>{" "}
                        <span className={gaps.some((g) => g.index === i) ? "text-[var(--warning)]" : ""}>
                          {l.accountName}
                        </span>
                        {l.partyName ? (
                          <span className="text-[var(--muted)]"> · {l.partyName}</span>
                        ) : null}
                      </div>
                    ))}
                    {gaps.length ? (
                      <div className="mt-0.5 text-[10px] text-[var(--warning)]">
                        {gaps[0]!.gap.detail}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{rupees(amount)}</td>
                  <td className="py-1.5 text-[10px] text-[var(--muted)]">{v.sourceType || "manual"}</td>
                  <td className="px-2 py-1.5 text-right">
                    <RowActionMenu
                      row={v}
                      label="Voucher actions"
                      actions={[
                        {
                          id: "head",
                          label: gaps.length ? "Put it on the right head" : "Change the head",
                          onSelect: (x) => setFixing(x),
                          // A reversed voucher is history. Its replacement is
                          // what carries the classification now.
                          hidden: (x) => !canEdit || x.reversed,
                        },
                        {
                          id: "amend",
                          label: "Change it…",
                          onSelect: (x) => setAmending(x),
                          // A reversal is the record of a void; rewriting one
                          // would leave the original explained by nothing.
                          hidden: (x) => !canEdit || x.reversed || x.isReversal,
                        },
                        {
                          id: "void",
                          label: "Void it…",
                          tone: "danger",
                          separatorAbove: true,
                          onSelect: (x) => setVoiding(x),
                          hidden: (x) => !canEdit || x.reversed || x.isReversal,
                        },
                        {
                          id: "copy",
                          label: "Copy voucher number",
                          separatorAbove: true,
                          onSelect: (x) => void navigator.clipboard.writeText(x.voucherNo),
                        },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && !busy ? (
              <tr>
                <td colSpan={8} className="py-6 text-center text-[var(--muted)]">
                  No voucher matches these filters.
                </td>
              </tr>
            ) : null}
          </ErpTableBody>
        </ErpTable>
      </div>

      {total > PAGE ? (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className={BTN_OUTLINE}
            disabled={page === 0 || busy}
            onClick={() => setPage((n) => Math.max(0, n - 1))}
          >
            Previous
          </button>
          <button
            type="button"
            className={BTN_OUTLINE}
            disabled={(page + 1) * PAGE >= total || busy}
            onClick={() => setPage((n) => n + 1)}
          >
            Next
          </button>
          <span className="text-[11px] text-[var(--muted)]">
            Page {page + 1} of {Math.ceil(total / PAGE)}
          </span>
        </div>
      ) : null}

      {amending ? (
        <AmendVoucherDialog
          voucher={amending}
          chart={chart}
          parties={parties}
          onClose={() => setAmending(null)}
          onDone={(msg) => {
            setAmending(null);
            setNotice(msg);
            void search(applied, page * PAGE);
          }}
        />
      ) : null}

      {voiding ? (
        <VoidVoucherDialog
          voucher={voiding}
          onClose={() => setVoiding(null)}
          onDone={(msg) => {
            setVoiding(null);
            setNotice(msg);
            void search(applied, page * PAGE);
          }}
        />
      ) : null}

      {fixing ? (
        <ReclassifyDialog
          voucher={fixing}
          heads={pickableHeads}
          chart={chartForFilter}
          onClose={() => setFixing(null)}
          onPosted={(msg) => {
            setFixing(null);
            setNotice(msg);
            void search(applied, page * PAGE);
          }}
        />
      ) : null}
    </section>
  );
}

/* ═══ Moving one line to another head ══════════════════════ */

function ReclassifyDialog({
  voucher,
  heads,
  chart,
  onClose,
  onPosted,
}: {
  voucher: VoucherFacts;
  heads: ChartRow[];
  chart: ChartAccount[];
  onClose: () => void;
  onPosted: (message: string) => void;
}) {
  const byParent = useMemo(() => childCodesByParent(chart), [chart]);
  const gaps = headGaps(voucher, chart, byParent);
  // Open on the line that needs it; otherwise let the operator choose.
  const [lineIndex, setLineIndex] = useState(gaps[0]?.index ?? -1);
  const [toCode, setToCode] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const line = lineIndex >= 0 ? voucher.lines[lineIndex] : null;
  const target = heads.find((h) => h.code === toCode);

  /**
   * Sub-heads are shown under their parent, so "Refreshment → Milk Expenses"
   * reads as one choice rather than two unrelated codes.
   */
  const grouped = useMemo(() => {
    const parentName = new Map(heads.map((h) => [h.code, h.name]));
    return heads
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((h) => ({
        code: h.code,
        label: h.parentCode && parentName.has(h.parentCode)
          ? `${h.code} · ${parentName.get(h.parentCode)} → ${h.name}`
          : `${h.code} · ${h.name}`,
      }));
  }, [heads]);

  async function post() {
    setBusy(true);
    setError("");
    try {
      const r = await ledgerApi<{ ok: boolean; error?: string; voucherNo?: string }>({
        action: "reclassify-head",
        voucherId: voucher.id,
        lineIndex,
        toCode,
        reason,
      });
      if (!r.ok) {
        setError(r.error || "The book refused the correction");
        return;
      }
      onPosted(
        `Posted ${r.voucherNo} — ${line?.accountName} moved to ${target?.name}. The original entry is unchanged; the journal is the correction.`,
      );
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogPopup className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
          <div>
            <h3 className="text-base font-bold text-[var(--brand-deep)]">Put this on the right head</h3>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {voucher.voucherNo} · {voucher.date} · {voucher.narration}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-[var(--muted)]" aria-label="Close">
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <p className="rounded-lg border border-[var(--info)]/30 bg-[var(--info-soft)] px-3 py-2 text-[11px] text-[var(--info)]">
            This does not edit the entry. The book is append-only, so a journal
            is posted that takes the amount off the old head and puts it on the
            new one — both stay on the record, and the trial balance does not
            move.
          </p>

          <div>
            <p className={LABEL}>Which line</p>
            <div className="mt-1 space-y-1">
              {voucher.lines.map((l, i) => {
                const gap = gaps.find((g) => g.index === i);
                const movable = l.accountCode.startsWith("4") || l.accountCode.startsWith("5");
                return (
                  <label
                    key={i}
                    className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 text-xs ${
                      lineIndex === i
                        ? "border-[var(--primary)] bg-[var(--surface-sunken)]"
                        : "border-[var(--border)]"
                    } ${movable ? "" : "opacity-50"}`}
                  >
                    <input
                      type="radio"
                      name="line"
                      className="mt-0.5"
                      disabled={!movable}
                      checked={lineIndex === i}
                      onChange={() => setLineIndex(i)}
                    />
                    <span className="flex-1">
                      <span className="font-mono text-[10px]">{l.accountCode}</span> {l.accountName}
                      {l.partyName ? <span className="text-[var(--muted)]"> · {l.partyName}</span> : null}
                      <span className="ml-1 font-mono tabular-nums">
                        {l.debitPaise ? `Dr ${rupees(l.debitPaise)}` : `Cr ${rupees(l.creditPaise)}`}
                      </span>
                      {gap ? (
                        <span className="mt-0.5 block text-[10px] text-[var(--warning)]">{gap.gap.detail}</span>
                      ) : null}
                      {!movable ? (
                        <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
                          Where the money sat — not a classification
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <label className={`${LABEL} block`}>
            Move it to
            <select className={FIELD} value={toCode} onChange={(e) => setToCode(e.target.value)}>
              <option value="">Choose a head or sub-head…</option>
              {grouped.map((h) => (
                <option key={h.code} value={h.code}>
                  {h.label}
                </option>
              ))}
            </select>
          </label>

          <label className={`${LABEL} block`}>
            Why
            <input
              className={FIELD}
              placeholder="e.g. diesel for Magic-2, not general office spend"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <span className="mt-0.5 block text-[10px] font-normal text-[var(--muted)]">
              This becomes the journal&apos;s narration — it is what the next
              person reads when they ask why the amount moved.
            </span>
          </label>

          {error ? (
            <p className="flex items-start gap-1.5 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-[11px] text-[var(--danger)]">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button type="button" className={BTN_OUTLINE} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={BTN}
            disabled={busy || lineIndex < 0 || !toCode || !reason.trim()}
            onClick={() => void post()}
          >
            {busy ? "Posting…" : "Post the correction"}
          </button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

export default VoucherBrowserPanel;
