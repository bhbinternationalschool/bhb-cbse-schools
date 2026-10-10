"use client";
// ratchet-allow: grids_without_row_menu — an editable line editor inside a
// dialog, not a list of records; each row IS the form.

/**
 * Voiding a voucher, and rewriting one.
 *
 * Both screens say the same uncomfortable thing out loud: nothing is edited
 * and nothing is deleted. `ledger_vouchers` and `ledger_lines` carry a
 * BEFORE UPDATE OR DELETE trigger that raises "append-only: correct a
 * posting with ledger_reverse(), never update it". So a void is a mirror
 * posting, and a change is a fresh posting followed by a void of the old one
 * — in that order, because if the void went first and the replacement failed
 * the book would be short a voucher, and `ledger_reverse` refuses to reverse
 * a reversal, so that void could not be taken back.
 *
 * That is worth showing rather than hiding behind the word "Edit", because
 * the book will afterwards contain three vouchers where the operator thinks
 * they changed one — and the first time they meet that in a statement should
 * not be a surprise.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Trash2, X } from "lucide-react";
import { Dialog, DialogPopup } from "@/components/ui/dialog";
import type { VoucherFacts } from "@/lib/ledger/voucherFilter";
import { linesFromVoucher, type AmendLine } from "@/lib/ledger/voucherAmend";

export type ChartRow = {
  code: string;
  name: string;
  parentCode: string;
  hasChildren: boolean;
  isCash: boolean;
  isBank: boolean;
};
export type PartyRow = { kind: string; externalId: string; name: string };

const FIELD =
  "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-2 py-1.5 text-xs text-[var(--ink)]";
const BTN =
  "inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-bold text-[var(--primary-foreground)] disabled:opacity-40";
const BTN_DANGER =
  "inline-flex items-center gap-1.5 rounded-lg bg-[var(--danger)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40";
const BTN_OUTLINE =
  "inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-bold text-[var(--ink)] hover:bg-[var(--surface-sunken)] disabled:opacity-40";
const LABEL = "text-[11px] font-bold text-[var(--muted)]";

const rupees = (paise: number) =>
  "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Rupees typed by a person → whole paise, or null when it is not a number. */
function toPaise(text: string): number | null {
  const t = text.trim();
  if (!t) return 0;
  if (!/^\d*\.?\d{0,2}$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

async function ledgerApi<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/ledger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return (await res.json()) as T;
}

function Shell({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogPopup className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
          <div>
            <h3 className="text-base font-bold text-[var(--brand-deep)]">{title}</h3>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="text-[var(--muted)]" aria-label="Close">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="space-y-3 p-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">{footer}</div>
      </DialogPopup>
    </Dialog>
  );
}

/* ═══ Void ═════════════════════════════════════════════════ */

export function VoidVoucherDialog({
  voucher,
  onClose,
  onDone,
}: {
  voucher: VoucherFacts;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const amount = Math.max(
    voucher.lines.reduce((n, l) => n + l.debitPaise, 0),
    voucher.lines.reduce((n, l) => n + l.creditPaise, 0),
  );

  async function go() {
    setBusy(true);
    setError("");
    try {
      const r = await ledgerApi<{ ok: boolean; error?: string; voucherNo?: string; alreadyVoided?: boolean }>({
        action: "void-voucher",
        voucherId: voucher.id,
        reason,
      });
      if (!r.ok) {
        setError(r.error || "The book refused the void");
        return;
      }
      onDone(
        r.alreadyVoided
          ? `${voucher.voucherNo} was already voided by ${r.voucherNo} — nothing was posted twice.`
          : `${voucher.voucherNo} voided by ${r.voucherNo}. Every balance has moved with it.`,
      );
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title="Void this voucher"
      subtitle={`${voucher.voucherNo} · ${voucher.date} · ${rupees(amount)}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BTN_OUTLINE} onClick={onClose}>
            Keep it
          </button>
          <button type="button" className={BTN_DANGER} disabled={busy || reason.trim().length < 4} onClick={() => void go()}>
            {busy ? "Voiding…" : "Void it"}
          </button>
        </>
      }
    >
      <p className="rounded-lg border border-[var(--info)]/30 bg-[var(--info-soft)] px-3 py-2 text-[11px] text-[var(--info)]">
        Voiding posts the mirror of this voucher. The original stays in the
        book and the reversal sits beside it — that pair IS the void, and it is
        what an auditor expects to find. Nothing is deleted, because the
        database refuses to delete a posted line.
      </p>
      <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-[11px] text-[var(--muted)]">
        <strong className="text-[var(--ink)]">Everything adjusts by itself.</strong> The
        trial balance, every account statement, the party sub-ledger and the
        server book&apos;s own position are all derived from the lines, so the
        mirror moves all of them at once. There is nothing else to correct
        afterwards.
      </p>

      <div className="rounded-lg border border-[var(--border)] p-2">
        <p className={LABEL}>What will be reversed</p>
        {voucher.lines.map((l, i) => (
          <div key={i} className="mt-1 flex justify-between gap-3 text-xs">
            <span>
              <span className="font-mono text-[10px]">{l.accountCode}</span> {l.accountName}
              {l.partyName ? <span className="text-[var(--muted)]"> · {l.partyName}</span> : null}
            </span>
            <span className="whitespace-nowrap font-mono tabular-nums">
              {l.debitPaise ? `Dr ${rupees(l.debitPaise)}` : `Cr ${rupees(l.creditPaise)}`}
            </span>
          </div>
        ))}
      </div>

      <label className={`${LABEL} block`}>
        Why
        <input
          className={FIELD}
          placeholder="e.g. duplicate of receipt 530 — the import ran twice"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <span className="mt-0.5 block text-[10px] font-normal text-[var(--muted)]">
          This is what the reversal will say. It is the only explanation
          anybody reading the book next year will have.
        </span>
      </label>

      {error ? (
        <p className="flex items-start gap-1.5 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-[11px] text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </Shell>
  );
}

/* ═══ Modify ═══════════════════════════════════════════════ */

export function AmendVoucherDialog({
  voucher,
  chart,
  parties,
  onClose,
  onDone,
}: {
  voucher: VoucherFacts;
  chart: ChartRow[];
  parties: PartyRow[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [lines, setLines] = useState<AmendLine[]>(() => linesFromVoucher(voucher));
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState(voucher.narration);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /** Postable leaves only; a parent with sub-heads is a heading, not a head. */
  const heads = useMemo(
    () =>
      chart
        .filter((a) => !a.hasChildren)
        .map((a) => {
          const parent = chart.find((p) => p.code === a.parentCode);
          return {
            code: a.code,
            label:
              parent && parent.code.length > 1
                ? `${a.code} · ${parent.name} → ${a.name}`
                : `${a.code} · ${a.name}`,
          };
        }),
    [chart],
  );

  const debit = lines.reduce((n, l) => n + l.debitPaise, 0);
  const credit = lines.reduce((n, l) => n + l.creditPaise, 0);
  const balanced = debit === credit && debit > 0;

  function setLine(i: number, patch: Partial<AmendLine>) {
    setLines((prev) => prev.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  }

  async function go() {
    setBusy(true);
    setError("");
    try {
      const r = await ledgerApi<{ ok: boolean; error?: string; voidedAs?: string; postedAs?: string }>({
        action: "amend-voucher",
        voucherId: voucher.id,
        lines,
        date,
        narration,
        reason,
      });
      if (!r.ok) {
        setError(r.error || "The book refused the change");
        return;
      }
      onDone(
        `${voucher.voucherNo} voided by ${r.voidedAs} and replaced by ${r.postedAs}. Every balance has moved with it.`,
      );
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title="Change this voucher"
      subtitle={`${voucher.voucherNo} · posted ${voucher.date} · ${voucher.narration}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={BTN_OUTLINE} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={BTN}
            disabled={busy || !balanced || reason.trim().length < 4}
            onClick={() => void go()}
          >
            {busy ? "Posting…" : "Repost and void"}
          </button>
        </>
      }
    >
      <p className="rounded-lg border border-[var(--info)]/30 bg-[var(--info-soft)] px-3 py-2 text-[11px] text-[var(--info)]">
        The book cannot be edited, so the corrected voucher is posted first
        and {voucher.voucherNo} is then voided. Afterwards the book holds three
        entries — the original, its reversal and the replacement — and the
        balances reflect only the last one. If the void were to fail, the
        replacement is withdrawn again, so a half-done change cannot leave the
        book short a voucher.
      </p>

      {/* lines */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className={LABEL}>The voucher as it should have been</p>
          <button
            type="button"
            className={`${BTN_OUTLINE} !px-2 !py-1`}
            onClick={() => setLines((p) => [...p, { accountCode: "", debitPaise: 0, creditPaise: 0, party: null }])}
          >
            <Plus className="size-3" aria-hidden /> Line
          </button>
        </div>

        {lines.map((l, i) => (
          <div key={i} className="rounded-lg border border-[var(--border)] p-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={LABEL}>
                Head / sub-head
                <select
                  className={FIELD}
                  value={l.accountCode}
                  onChange={(e) => setLine(i, { accountCode: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {heads.map((h) => (
                    <option key={h.code} value={h.code}>
                      {h.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL}>
                Party (sub-head)
                <select
                  className={FIELD}
                  value={l.party ? `${l.party.kind}:${l.party.externalId}` : ""}
                  onChange={(e) => {
                    const key = e.target.value;
                    if (!key) return setLine(i, { party: null });
                    const p = parties.find((x) => `${x.kind}:${x.externalId}` === key);
                    setLine(i, { party: p ? { kind: p.kind, externalId: p.externalId, name: p.name } : null });
                  }}
                >
                  <option value="">Nobody in particular</option>
                  {parties.map((p) => (
                    <option key={`${p.kind}:${p.externalId}`} value={`${p.kind}:${p.externalId}`}>
                      {p.name} ({p.kind})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <label className={LABEL}>
                Debit ₹
                <input
                  className={FIELD}
                  inputMode="decimal"
                  value={l.debitPaise ? String(l.debitPaise / 100) : ""}
                  onChange={(e) => {
                    const p = toPaise(e.target.value);
                    if (p === null) return;
                    setLine(i, { debitPaise: p, creditPaise: p > 0 ? 0 : l.creditPaise });
                  }}
                />
              </label>
              <label className={LABEL}>
                Credit ₹
                <input
                  className={FIELD}
                  inputMode="decimal"
                  value={l.creditPaise ? String(l.creditPaise / 100) : ""}
                  onChange={(e) => {
                    const p = toPaise(e.target.value);
                    if (p === null) return;
                    setLine(i, { creditPaise: p, debitPaise: p > 0 ? 0 : l.debitPaise });
                  }}
                />
              </label>
              <div className="flex items-end justify-end">
                <button
                  type="button"
                  className={`${BTN_OUTLINE} !px-2 !py-1 !text-[var(--danger)]`}
                  disabled={lines.length <= 2}
                  title={lines.length <= 2 ? "A voucher needs at least two lines" : "Remove this line"}
                  onClick={() => setLines((p) => p.filter((_, n) => n !== i))}
                >
                  <Trash2 className="size-3" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        ))}

        <p
          className={`text-[11px] font-bold ${
            balanced ? "text-[var(--success)]" : "text-[var(--danger)]"
          }`}
        >
          Debits {rupees(debit)} · credits {rupees(credit)}
          {balanced ? " · balanced" : ` · out by ${rupees(Math.abs(debit - credit))}`}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className={LABEL}>
          Date of the replacement
          <input type="date" className={FIELD} value={date} onChange={(e) => setDate(e.target.value)} />
          <span className="mt-0.5 block text-[10px] font-normal text-[var(--muted)]">
            Today by default. A closed or locked period will refuse it.
          </span>
        </label>
        <label className={LABEL}>
          Narration
          <input className={FIELD} value={narration} onChange={(e) => setNarration(e.target.value)} />
        </label>
      </div>

      <label className={`${LABEL} block`}>
        Why
        <input
          className={FIELD}
          placeholder="e.g. the head and the payee were both wrong on the import"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <span className="mt-0.5 block text-[10px] font-normal text-[var(--muted)]">
          Recorded on both the void and the replacement, so either one read
          alone still explains itself.
        </span>
      </label>

      {error ? (
        <p className="flex items-start gap-1.5 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-[11px] text-[var(--danger)]">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}
    </Shell>
  );
}
