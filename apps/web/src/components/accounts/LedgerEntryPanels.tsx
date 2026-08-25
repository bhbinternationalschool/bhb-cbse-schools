"use client";

/**
 * Accounts → posting at the source (phase B of the redesign).
 *
 * VoucherEntryPanel — journal / payment / receipt / contra entry, posting
 * through `ledger_post`. The presets are the office's daily verbs (record an
 * expense, record money in, move cash to bank); underneath they all fill the
 * same two-sided grid, and nothing posts until debits equal credits.
 *
 * ChequesPanel — the life of a cheque in account 1050 Cheques in Hand:
 * received (Dr) → deposited & cleared (contra to the bank) or bounced
 * (a reversal of the voucher that brought it in). Both outcomes are posted
 * decisions under the actor's name, never silent state flips.
 *
 * House rules: amounts entered in rupees, stored in paise; a bank line must
 * say WHICH bank (the reconciliation depends on it); reversals carry a
 * reason.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FileText, Plus, Trash2, Undo2 } from "lucide-react";
import { formatInr } from "@/lib/fees";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
} from "@/components/ui/erp-roster";

const CARD = "rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4";
const BTN =
  "rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50";
const BTN_OUTLINE =
  "rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-bold text-[var(--brand-deep)] disabled:opacity-50";
const FIELD =
  "w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fyStart(d = new Date()): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-04-01`;
}

/** "1,234.56" → 123456. NaN and negatives come back as 0. */
function paiseFromRupees(v: string): number {
  const n = Number(String(v).replace(/[,\s₹]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

async function ledgerApi<T>(body: Record<string, unknown>): Promise<T & { ok?: boolean; error?: string }> {
  const res = await fetch("/api/ledger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T & { ok?: boolean; error?: string };
}

type CoaAccount = { code: string; name: string; kind: string; isCash: boolean; isBank: boolean };

function useChart(): CoaAccount[] {
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  useEffect(() => {
    void ledgerApi<{ accounts: CoaAccount[] }>({ action: "accounts" }).then((r) => {
      if (r.ok && r.accounts) setAccounts(r.accounts);
    });
  }, []);
  return accounts;
}

const KIND_ORDER = ["asset", "liability", "income", "expense", "equity"];
const KIND_LABEL: Record<string, string> = {
  asset: "Assets",
  liability: "Liabilities",
  income: "Income",
  expense: "Expenses",
  equity: "Corpus & funds",
};

function AccountSelect({
  accounts,
  value,
  onChange,
  disabled,
}: {
  accounts: CoaAccount[];
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}) {
  const grouped = useMemo(() => {
    const g = new Map<string, CoaAccount[]>();
    for (const a of accounts) {
      const k = g.get(a.kind) ?? [];
      k.push(a);
      g.set(a.kind, k);
    }
    return g;
  }, [accounts]);
  return (
    <select className={FIELD} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">Account…</option>
      {KIND_ORDER.filter((k) => grouped.has(k)).map((k) => (
        <optgroup key={k} label={KIND_LABEL[k] ?? k}>
          {grouped.get(k)!.map((a) => (
            <option key={a.code} value={a.code}>
              {a.code} · {a.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/* ═══ Voucher entry ════════════════════════════════════════ */

type EntryLine = {
  accountCode: string;
  debit: string;
  credit: string;
  bankId: string;
};

type VoucherKind = "journal" | "payment" | "receipt" | "contra";

const PRESETS: {
  id: string;
  label: string;
  kind: VoucherKind;
  hint: string;
  lines: () => EntryLine[];
}[] = [
  {
    id: "expense",
    label: "Record an expense",
    kind: "payment",
    hint: "Debit the expense head, credit how it was paid",
    lines: () => [
      { accountCode: "", debit: "", credit: "", bankId: "" },
      { accountCode: "1000", debit: "", credit: "", bankId: "" },
    ],
  },
  {
    id: "receipt",
    label: "Record money in",
    kind: "receipt",
    hint: "Debit cash or bank, credit the income head",
    lines: () => [
      { accountCode: "1000", debit: "", credit: "", bankId: "" },
      { accountCode: "", debit: "", credit: "", bankId: "" },
    ],
  },
  {
    id: "deposit",
    label: "Cash → bank deposit",
    kind: "contra",
    hint: "The day-close hand-over: cash counted, then banked",
    lines: () => [
      { accountCode: "1010", debit: "", credit: "", bankId: "" },
      { accountCode: "1000", debit: "", credit: "", bankId: "" },
    ],
  },
  {
    id: "journal",
    label: "Blank journal",
    kind: "journal",
    hint: "Any balanced entry",
    lines: () => [
      { accountCode: "", debit: "", credit: "", bankId: "" },
      { accountCode: "", debit: "", credit: "", bankId: "" },
    ],
  },
];

export function VoucherEntryPanel({
  banks,
  actor,
  onPosted,
}: {
  banks: { id: string; name: string }[];
  actor: string;
  onPosted?: () => void;
}) {
  const accounts = useChart();
  const [kind, setKind] = useState<VoucherKind>("payment");
  const [date, setDate] = useState(todayIso());
  const [narration, setNarration] = useState("");
  const [partyName, setPartyName] = useState("");
  const [instrumentMode, setInstrumentMode] = useState("");
  const [instrumentRef, setInstrumentRef] = useState("");
  const [lines, setLines] = useState<EntryLine[]>(PRESETS[0].lines());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const byCode = useMemo(() => new Map(accounts.map((a) => [a.code, a])), [accounts]);

  const totals = useMemo(() => {
    const dr = lines.reduce((n, l) => n + paiseFromRupees(l.debit), 0);
    const cr = lines.reduce((n, l) => n + paiseFromRupees(l.credit), 0);
    return { dr, cr, diff: dr - cr };
  }, [lines]);

  const applyPreset = (presetId: string) => {
    const p = PRESETS.find((x) => x.id === presetId);
    if (!p) return;
    setKind(p.kind);
    setLines(p.lines());
    setNotice(null);
  };

  const setLine = (i: number, patch: Partial<EntryLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const missingBank = lines.some(
    (l) =>
      byCode.get(l.accountCode)?.isBank &&
      banks.length > 0 &&
      !l.bankId &&
      (paiseFromRupees(l.debit) > 0 || paiseFromRupees(l.credit) > 0),
  );

  const postable =
    totals.dr > 0 &&
    totals.dr === totals.cr &&
    lines.filter((l) => l.accountCode && (paiseFromRupees(l.debit) > 0 || paiseFromRupees(l.credit) > 0)).length >= 2 &&
    !missingBank;

  const post = async () => {
    if (!postable || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const party = partyName.trim()
        ? {
            kind: "other" as const,
            externalId: `manual:${partyName.trim().toLowerCase().replace(/\s+/g, "-")}`,
            name: partyName.trim(),
          }
        : undefined;
      const instrument =
        instrumentMode || instrumentRef
          ? { mode: instrumentMode || undefined, ref: instrumentRef || undefined, date }
          : undefined;

      const res = await ledgerApi<{ voucherNo?: string }>({
        action: "post",
        voucher: {
          voucherType: kind,
          date,
          narration: narration.trim(),
          createdBy: actor,
          lines: lines
            .filter((l) => l.accountCode && (paiseFromRupees(l.debit) > 0 || paiseFromRupees(l.credit) > 0))
            .map((l) => {
              const acc = byCode.get(l.accountCode);
              return {
                accountCode: l.accountCode,
                debitPaise: paiseFromRupees(l.debit),
                creditPaise: paiseFromRupees(l.credit),
                ...(acc?.isBank && l.bankId
                  ? { subledgerKind: "bank_account", subledgerId: l.bankId }
                  : {}),
                ...(party ? { party } : {}),
                ...(instrument && (acc?.isCash || acc?.isBank) ? { instrument } : {}),
              };
            }),
        },
      });
      if (!res.ok) {
        setNotice({ tone: "bad", text: res.error || "The book refused this entry" });
        return;
      }
      setNotice({ tone: "ok", text: `Posted as ${res.voucherNo}` });
      setNarration("");
      setPartyName("");
      setInstrumentMode("");
      setInstrumentRef("");
      setLines(PRESETS.find((p) => p.kind === kind)?.lines() ?? PRESETS[3].lines());
      onPosted?.();
    } catch {
      setNotice({ tone: "bad", text: "Could not reach the server" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-1.5 text-sm font-bold text-[var(--brand-deep)]">
            <FileText className="size-4" aria-hidden /> New voucher
          </h4>
          <p className="text-[11px] text-[var(--muted)]">
            Posts straight into the server book. Nothing posts until debits
            equal credits, and a posted voucher can only be reversed, never
            edited.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={BTN_OUTLINE}
              title={p.hint}
              onClick={() => applyPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-bold text-[var(--muted)]">
          Type
          <select className={FIELD} value={kind} onChange={(e) => setKind(e.target.value as VoucherKind)}>
            <option value="payment">Payment</option>
            <option value="receipt">Receipt</option>
            <option value="contra">Contra</option>
            <option value="journal">Journal</option>
          </select>
        </label>
        <label className="text-[11px] font-bold text-[var(--muted)]">
          Date
          <input type="date" className={FIELD} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="min-w-[14rem] flex-1 text-[11px] font-bold text-[var(--muted)]">
          Narration
          <input
            className={FIELD}
            placeholder="what this entry records"
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
          />
        </label>
        <label className="text-[11px] font-bold text-[var(--muted)]">
          Party (optional)
          <input
            className={FIELD}
            placeholder="who was paid / who paid"
            value={partyName}
            onChange={(e) => setPartyName(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-bold text-[var(--muted)]">
          Instrument
          <select className={FIELD} value={instrumentMode} onChange={(e) => setInstrumentMode(e.target.value)}>
            <option value="">—</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="bank">Bank transfer</option>
            <option value="neft">NEFT</option>
            <option value="rtgs">RTGS</option>
            <option value="cheque">Cheque</option>
          </select>
        </label>
        <label className="text-[11px] font-bold text-[var(--muted)]">
          Reference
          <input
            className={FIELD}
            placeholder="UTR / cheque no."
            value={instrumentRef}
            onChange={(e) => setInstrumentRef(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-3 space-y-2">
        {lines.map((l, i) => {
          const acc = byCode.get(l.accountCode);
          return (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[16rem] flex-1">
                <AccountSelect
                  accounts={accounts}
                  value={l.accountCode}
                  onChange={(code) => setLine(i, { accountCode: code })}
                />
              </div>
              {acc?.isBank && banks.length > 0 ? (
                <select
                  className={`${FIELD} max-w-[12rem]`}
                  value={l.bankId}
                  onChange={(e) => setLine(i, { bankId: e.target.value })}
                >
                  <option value="">Which bank…</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <input
                className={`${FIELD} max-w-[8rem] text-right`}
                placeholder="Debit ₹"
                inputMode="decimal"
                value={l.debit}
                onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
              />
              <input
                className={`${FIELD} max-w-[8rem] text-right`}
                placeholder="Credit ₹"
                inputMode="decimal"
                value={l.credit}
                onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
              />
              <button
                type="button"
                className={BTN_OUTLINE}
                aria-label="Remove line"
                disabled={lines.length <= 2}
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className={BTN_OUTLINE}
          onClick={() => setLines((ls) => [...ls, { accountCode: "", debit: "", credit: "", bankId: "" }])}
        >
          <Plus className="size-3.5" aria-hidden /> Add line
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
        <p className="text-xs tabular-nums">
          Dr <strong>{formatInr(totals.dr)}</strong> · Cr <strong>{formatInr(totals.cr)}</strong>
          {totals.diff !== 0 ? (
            <span className="ml-2 font-bold text-[var(--danger)]">
              off by {formatInr(Math.abs(totals.diff))}
            </span>
          ) : totals.dr > 0 ? (
            <span className="ml-2 font-bold text-[var(--success)]">balanced</span>
          ) : null}
          {missingBank ? (
            <span className="ml-2 font-bold text-[var(--warning)]">
              say which bank — the reconciliation depends on it
            </span>
          ) : null}
        </p>
        <button type="button" className={BTN} disabled={!postable || busy} onClick={() => void post()}>
          <Check className="size-3.5" aria-hidden /> {busy ? "Posting…" : "Post voucher"}
        </button>
      </div>

      {notice ? (
        <p
          className={`mt-2 rounded-lg border px-3 py-1.5 text-xs ${
            notice.tone === "ok"
              ? "border-[var(--success)]/30 bg-[var(--success-soft)] text-[var(--success)]"
              : "border-[var(--danger)]/30 bg-[var(--danger-soft)] text-[var(--danger)]"
          }`}
        >
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}

/* ═══ Cheques in hand ══════════════════════════════════════ */

type StatementRow = {
  date: string;
  voucherNo: string;
  narration: string;
  partyName: string;
  instrumentRef: string;
  debitPaise: number;
  creditPaise: number;
};

type OpenCheque = {
  ref: string;
  receivedOn: string;
  voucherNo: string;
  partyName: string;
  narration: string;
  openPaise: number;
};

export function ChequesPanel({
  banks,
  actor,
  refreshKey,
}: {
  banks: { id: string; name: string }[];
  actor: string;
  refreshKey?: number;
}) {
  const [rows, setRows] = useState<StatementRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [clearing, setClearing] = useState<{ ref: string; bankId: string; date: string } | null>(null);

  const load = useCallback(async () => {
    setError("");
    const res = await ledgerApi<{ rows: StatementRow[] }>({
      action: "account-statement",
      code: "1050",
      from: fyStart(),
      to: todayIso(),
    });
    if (!res.ok) {
      setError(res.error || "Could not read Cheques in Hand");
      setRows(null);
      return;
    }
    setRows(res.rows ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // A cheque is "in hand" while its reference has been debited into 1050 and
  // not yet fully credited out (cleared or bounced). Grouping by reference is
  // exact because the fee counter and the entry form both stamp it.
  const open: OpenCheque[] = useMemo(() => {
    const byRef = new Map<string, OpenCheque>();
    for (const r of rows ?? []) {
      const ref = r.instrumentRef || `(no ref) ${r.voucherNo}`;
      const cur =
        byRef.get(ref) ??
        ({ ref, receivedOn: r.date, voucherNo: r.voucherNo, partyName: r.partyName, narration: r.narration, openPaise: 0 } as OpenCheque);
      if (r.debitPaise > 0) {
        cur.receivedOn = r.date;
        cur.voucherNo = r.voucherNo;
        if (r.partyName) cur.partyName = r.partyName;
        if (r.narration) cur.narration = r.narration;
      }
      cur.openPaise += r.debitPaise - r.creditPaise;
      byRef.set(ref, cur);
    }
    return [...byRef.values()].filter((c) => c.openPaise > 0);
  }, [rows]);

  const clear = async () => {
    if (!clearing || busy) return;
    const cheque = open.find((c) => c.ref === clearing.ref);
    if (!cheque) return;
    if (banks.length > 0 && !clearing.bankId) {
      setNotice("Say which bank the cheque was deposited into");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const res = await ledgerApi<{ voucherNo?: string }>({
        action: "post",
        voucher: {
          voucherType: "contra",
          date: clearing.date,
          narration: `Cheque ${cheque.ref} cleared${cheque.partyName ? ` — ${cheque.partyName}` : ""}`,
          createdBy: actor,
          lines: [
            {
              accountCode: "1010",
              debitPaise: cheque.openPaise,
              creditPaise: 0,
              ...(clearing.bankId
                ? { subledgerKind: "bank_account", subledgerId: clearing.bankId }
                : {}),
              instrument: { mode: "cheque", ref: cheque.ref, date: clearing.date },
            },
            {
              accountCode: "1050",
              debitPaise: 0,
              creditPaise: cheque.openPaise,
              instrument: { mode: "cheque", ref: cheque.ref, date: clearing.date },
            },
          ],
        },
      });
      setNotice(
        res.ok
          ? `Cheque ${cheque.ref} cleared into the bank — ${res.voucherNo}`
          : res.error || "The book refused the clearing",
      );
      if (res.ok) {
        setClearing(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const bounce = async (cheque: OpenCheque) => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const found = await ledgerApi<{ voucher?: { id: string } }>({
        action: "find-voucher",
        voucherNo: cheque.voucherNo,
      });
      if (!found.ok || !found.voucher) {
        setNotice(found.error || `Could not find voucher ${cheque.voucherNo}`);
        return;
      }
      const res = await ledgerApi<{ voucherNo?: string }>({
        action: "reverse",
        voucherId: found.voucher.id,
        reason: `Cheque ${cheque.ref} bounced`,
      });
      setNotice(
        res.ok
          ? `Bounce recorded — ${cheque.voucherNo} reversed. Whatever it settled is owed again.`
          : res.error || "The book refused the reversal",
      );
      if (res.ok) await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-[var(--brand-deep)]">Cheques in hand</h4>
          <p className="text-[11px] text-[var(--muted)]">
            Account 1050 — received but not yet banked. Clearing posts a
            contra into the bank; a bounce reverses the voucher that brought
            the cheque in.
          </p>
        </div>
        <button type="button" className={BTN_OUTLINE} disabled={busy} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error ? (
        <p className="mt-2 rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--accent)] px-3 py-1.5 text-xs text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      {rows && open.length === 0 ? (
        <p className="mt-2 py-2 text-sm text-[var(--muted)]">
          No cheques in hand. A fee cheque lands here when it is received;
          this list is its home until it clears or bounces.
        </p>
      ) : null}

      {open.length > 0 ? (
        <div className="mt-2 overflow-x-auto">
          <ErpTable minWidth="min-w-[40rem]">
            <ErpTableHead>
              <tr>
                <th className="pb-2 text-left">Cheque</th>
                <th className="pb-2 text-left">Received</th>
                <th className="pb-2 text-left">From</th>
                <th className="pb-2 text-right">Amount</th>
                <th className="pb-2 text-right">Action</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {open.map((c) => (
                <tr key={c.ref}>
                  <td className="py-2 font-mono text-xs">{c.ref}</td>
                  <td className="py-2">{c.receivedOn}</td>
                  <td className="py-2 text-xs">{c.partyName || c.narration || "—"}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {formatInr(c.openPaise)}
                  </td>
                  <td className="py-2 text-right">
                    {clearing?.ref === c.ref ? (
                      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        {banks.length > 0 ? (
                          <select
                            className={`${FIELD} max-w-[10rem]`}
                            value={clearing.bankId}
                            onChange={(e) => setClearing({ ...clearing, bankId: e.target.value })}
                          >
                            <option value="">Into which bank…</option>
                            {banks.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <input
                          type="date"
                          className={`${FIELD} max-w-[9rem]`}
                          value={clearing.date}
                          onChange={(e) => setClearing({ ...clearing, date: e.target.value })}
                        />
                        <button type="button" className={BTN_OUTLINE} disabled={busy} onClick={() => void clear()}>
                          <Check className="size-3.5" aria-hidden /> Confirm
                        </button>
                        <button
                          type="button"
                          className={BTN_OUTLINE}
                          disabled={busy}
                          onClick={() => setClearing(null)}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex gap-1.5">
                        <button
                          type="button"
                          className={BTN_OUTLINE}
                          disabled={busy}
                          onClick={() => setClearing({ ref: c.ref, bankId: banks[0]?.id ?? "", date: todayIso() })}
                        >
                          Cleared
                        </button>
                        <button
                          type="button"
                          className={BTN_OUTLINE}
                          disabled={busy}
                          onClick={() => void bounce(c)}
                        >
                          <Undo2 className="size-3.5" aria-hidden /> Bounced
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </div>
      ) : null}
    </section>
  );
}

/* ═══ The notice legacy panels wear ════════════════════════ */

/**
 * Phase B closes the browser book to NEW entries in spirit; phase C removes
 * it. Until then, the legacy forms stay usable but say plainly where entries
 * should go — a silent dual-book period is how two versions of the truth
 * happen.
 */
export function LegacyBookNotice({ tab }: { tab: string }) {
  return (
    <p className="mt-4 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]">
      This section writes to the browser-local book, which is being retired.
      New entries belong in <strong>Vouchers</strong> — they post to the
      server book that the reports and the CA pack read. Anything entered
      here will need re-entry there{tab ? ` (${tab})` : ""}.
    </p>
  );
}
