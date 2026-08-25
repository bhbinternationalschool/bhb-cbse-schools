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

type CoaAccount = {
  code: string;
  name: string;
  kind: string;
  parentCode?: string;
  hasChildren?: boolean;
  isCash: boolean;
  isBank: boolean;
};

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
  // A category that has sub-heads is a heading: it is never offered — its
  // sub-heads are, grouped under the category's name so the clerk picks
  // "Utilities → Electricity", not a flat code from a long list.
  const { grouped, expenseGroups } = useMemo(() => {
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const g = new Map<string, CoaAccount[]>();
    const eg: { label: string; children: CoaAccount[] }[] = [];
    for (const a of accounts) {
      if (a.hasChildren) continue;
      const parent = a.parentCode ? byCode.get(a.parentCode) : undefined;
      if (a.kind === "expense" && parent && parent.hasChildren) {
        const label = `${parent.name}`;
        const bucket = eg.find((x) => x.label === label);
        if (bucket) bucket.children.push(a);
        else eg.push({ label, children: [a] });
        continue;
      }
      const k = g.get(a.kind) ?? [];
      k.push(a);
      g.set(a.kind, k);
    }
    return { grouped: g, expenseGroups: eg };
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
      {expenseGroups.map((x) => (
        <optgroup key={x.label} label={`Expenses — ${x.label}`}>
          {x.children.map((a) => (
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
  /** Party classification the preset implies; "other" unless it matters. */
  partyKind?: "trustee" | "staff" | "other";
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
    id: "loan-in",
    label: "Owner loan received",
    kind: "receipt",
    hint: "Money a trustee lends the school: debit cash/bank, credit 2100 under their name",
    partyKind: "trustee",
    lines: () => [
      { accountCode: "1000", debit: "", credit: "", bankId: "" },
      { accountCode: "2100", debit: "", credit: "", bankId: "" },
    ],
  },
  {
    id: "loan-out",
    label: "Owner loan repaid",
    kind: "payment",
    hint: "Repaying a trustee: debit 2100 under their name, credit cash/bank",
    partyKind: "trustee",
    lines: () => [
      { accountCode: "2100", debit: "", credit: "", bankId: "" },
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
  const [partyKind, setPartyKind] = useState<"trustee" | "staff" | "other">("other");
  const [instrumentMode, setInstrumentMode] = useState("");
  const [instrumentRef, setInstrumentRef] = useState("");
  const [lines, setLines] = useState<EntryLine[]>(PRESETS[0].lines());
  // The "spent on" tag — Bus-1, Hostel, a specific event. One per voucher,
  // stamped onto every line, so "what did Bus-1 cost us" is one report away.
  const [centres, setCentres] = useState<{ code: string; name: string }[]>([]);
  const [spentOn, setSpentOn] = useState("");
  useEffect(() => {
    void ledgerApi<{ centres: { code: string; name: string }[] }>({
      action: "cost-centres",
    }).then((r) => {
      if (r.ok && r.centres) setCentres(r.centres);
    });
  }, []);
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
    setPartyKind(p.partyKind ?? "other");
    setNotice(null);
  };

  const setLine = (i: number, patch: Partial<EntryLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  // 2100 is a control account: a loan without a lender is not a fact the
  // book can hold — the trustee's name is what makes it a sub-ledger.
  const missingParty =
    !partyName.trim() &&
    lines.some(
      (l) => l.accountCode === "2100" && (paiseFromRupees(l.debit) > 0 || paiseFromRupees(l.credit) > 0),
    );

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
    !missingBank &&
    !missingParty;

  const post = async () => {
    if (!postable || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const party = partyName.trim()
        ? {
            kind: partyKind,
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
                ...(spentOn ? { costCentreCode: spentOn } : {}),
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
        <label className="text-[11px] font-bold text-[var(--muted)]">
          Spent on (optional)
          <select
            className={FIELD}
            value={spentOn}
            onChange={(e) => setSpentOn(e.target.value)}
          >
            <option value="">No tag</option>
            {centres.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
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
          {missingParty ? (
            <span className="ml-2 font-bold text-[var(--warning)]">
              a loan needs the trustee&rsquo;s name in Party
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
/* ═══ Expense heads: category → sub-heads ══════════════════ */

/**
 * The expense chart the office actually thinks in: a CATEGORY (Utilities)
 * holding SUB-HEADS (Electricity, Diesel…). Lives in `ledger_accounts`
 * itself — the same structure the entry form offers and every statement
 * rolls up — not in a separate master that could drift from the book.
 */
export function ExpenseHeadsPanel() {
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [newCat, setNewCat] = useState("");
  /** Which category has its "add sub-head" input open, and its draft name. */
  const [subFor, setSubFor] = useState("");
  const [subName, setSubName] = useState("");
  const [renaming, setRenaming] = useState("");
  const [renameTo, setRenameTo] = useState("");

  const load = useCallback(() => {
    void ledgerApi<{ accounts: CoaAccount[] }>({ action: "accounts" }).then((r) => {
      if (r.ok && r.accounts) setAccounts(r.accounts);
    });
  }, []);
  useEffect(load, [load]);

  const categories = useMemo(
    () =>
      accounts
        .filter((a) => a.kind === "expense" && a.parentCode === "5")
        .map((c) => ({
          ...c,
          children: accounts.filter((a) => a.parentCode === c.code),
        })),
    [accounts],
  );

  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      const r = await ledgerApi<{ code?: string }>(body);
      if (r.ok) {
        setNotice(done + (r.code ? ` (${r.code})` : ""));
        setNewCat("");
        setSubFor("");
        setSubName("");
        setRenaming("");
        load();
      } else {
        setError(r.error || "Could not save");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">Expense heads</h3>
          <p className="text-xs text-[var(--muted)]">
            One category, many sub-heads. Entry forms offer the sub-heads;
            reports roll them up under the category.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className={FIELD}
            style={{ width: 220 }}
            placeholder="New category, e.g. Utilities"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
          />
          <button
            type="button"
            className={BTN}
            disabled={busy || !newCat.trim()}
            onClick={() => void run({ action: "save-expense-head", name: newCat.trim() }, "Category added")}
          >
            Add
          </button>
        </div>
      </div>

      {notice ? (
        <p className="mt-2 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-700">{notice}</p>
      ) : null}
      {error ? (
        <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-700">{error}</p>
      ) : null}

      <div className="mt-3 space-y-2">
        {categories.map((c) => (
          <div key={c.code} className="rounded-xl border border-[var(--border)] p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {renaming === c.code ? (
                  <>
                    <input
                      className={FIELD}
                      style={{ width: 200 }}
                      value={renameTo}
                      onChange={(e) => setRenameTo(e.target.value)}
                    />
                    <button
                      type="button"
                      className={BTN_OUTLINE}
                      disabled={busy || !renameTo.trim()}
                      onClick={() =>
                        void run(
                          { action: "save-expense-head", code: c.code, name: renameTo.trim() },
                          "Renamed",
                        )
                      }
                    >
                      Save
                    </button>
                    <button type="button" className={BTN_OUTLINE} onClick={() => setRenaming("")}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-semibold text-[var(--brand-deep)]">
                      {c.name}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--muted)]">{c.code}</span>
                    {c.children.length === 0 ? (
                      <span className="text-[11px] text-[var(--muted)]">
                        · posts directly until it has sub-heads
                      </span>
                    ) : null}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={BTN_OUTLINE}
                  onClick={() => {
                    setRenaming(c.code);
                    setRenameTo(c.name);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className={BTN_OUTLINE}
                  onClick={() => {
                    setSubFor(subFor === c.code ? "" : c.code);
                    setSubName("");
                  }}
                >
                  + Sub-head
                </button>
                {c.children.length === 0 ? (
                  <button
                    type="button"
                    className={BTN_OUTLINE}
                    disabled={busy}
                    onClick={() =>
                      void run({ action: "remove-expense-head", code: c.code }, "Removed")
                    }
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>

            {subFor === c.code ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  className={FIELD}
                  style={{ width: 220 }}
                  placeholder={`New sub-head under ${c.name}`}
                  value={subName}
                  onChange={(e) => setSubName(e.target.value)}
                />
                <button
                  type="button"
                  className={BTN}
                  disabled={busy || !subName.trim()}
                  onClick={() =>
                    void run(
                      { action: "save-expense-head", name: subName.trim(), parentCode: c.code },
                      "Sub-head added",
                    )
                  }
                >
                  Add
                </button>
              </div>
            ) : null}

            {c.children.length > 0 ? (
              <ul className="mt-2 space-y-1 border-l-2 border-[var(--border)] pl-3">
                {c.children.map((s) => (
                  <li key={s.code} className="flex flex-wrap items-center justify-between gap-2">
                    {renaming === s.code ? (
                      <span className="flex items-center gap-2">
                        <input
                          className={FIELD}
                          style={{ width: 200 }}
                          value={renameTo}
                          onChange={(e) => setRenameTo(e.target.value)}
                        />
                        <button
                          type="button"
                          className={BTN_OUTLINE}
                          disabled={busy || !renameTo.trim()}
                          onClick={() =>
                            void run(
                              { action: "save-expense-head", code: s.code, name: renameTo.trim() },
                              "Renamed",
                            )
                          }
                        >
                          Save
                        </button>
                        <button type="button" className={BTN_OUTLINE} onClick={() => setRenaming("")}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="text-sm">
                        {s.name}{" "}
                        <span className="font-mono text-[11px] text-[var(--muted)]">{s.code}</span>
                      </span>
                    )}
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        className={BTN_OUTLINE}
                        onClick={() => {
                          setRenaming(s.code);
                          setRenameTo(s.name);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className={BTN_OUTLINE}
                        disabled={busy}
                        onClick={() =>
                          void run({ action: "remove-expense-head", code: s.code }, "Removed")
                        }
                      >
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-[var(--muted)]">
        A head that already has entries cannot be removed — rename it instead,
        the history follows the name. System heads (store purchases, cost of
        goods, concessions) stay as they are.
      </p>
    </section>
  );
}

/* ═══ Spent-on tags (cost centres) ═════════════════════════ */

/**
 * The second axis of an expense: WHAT it was (the head) × what it was FOR
 * (the tag) — Bus-1, Hostel, Annual Function. Tags are ledger cost centres;
 * every voucher can carry one, and the report below answers "what did Bus-1
 * cost us, split by fuel / EMI / service" without inventing new heads per
 * vehicle.
 */
export function SpendTagsPanel() {
  const [centres, setCentres] = useState<{ code: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [newTag, setNewTag] = useState("");
  const [renaming, setRenaming] = useState("");
  const [renameTo, setRenameTo] = useState("");

  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayIso());
  const [rows, setRows] = useState<
    {
      centreCode: string;
      centreName: string;
      accountCode: string;
      accountName: string;
      amountPaise: number;
    }[]
  >([]);
  const [reportBusy, setReportBusy] = useState(false);

  const load = useCallback(() => {
    void ledgerApi<{ centres: { code: string; name: string }[] }>({
      action: "cost-centres",
    }).then((r) => {
      if (r.ok && r.centres) setCentres(r.centres);
    });
  }, []);
  useEffect(load, [load]);

  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError("");
    try {
      const r = await ledgerApi<{ code?: string }>(body);
      if (r.ok) {
        setNotice(done);
        setNewTag("");
        setRenaming("");
        load();
      } else {
        setError(r.error || "Could not save");
      }
    } finally {
      setBusy(false);
    }
  }

  async function loadReport() {
    setReportBusy(true);
    try {
      const r = await ledgerApi<{ rows: typeof rows }>({
        action: "spend-by-centre",
        fromDate: from,
        toDate: to,
      });
      if (r.ok && r.rows) setRows(r.rows);
    } finally {
      setReportBusy(false);
    }
  }

  const byCentre = useMemo(() => {
    const g = new Map<string, { name: string; rows: typeof rows; total: number }>();
    for (const r of rows) {
      const cur = g.get(r.centreCode) ?? { name: r.centreName, rows: [], total: 0 };
      cur.rows.push(r);
      cur.total += r.amountPaise;
      g.set(r.centreCode, cur);
    }
    return [...g.entries()];
  }, [rows]);

  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Spent-on tags
          </h3>
          <p className="text-xs text-[var(--muted)]">
            Bus-1, Hostel, Annual Function… Pick a tag while entering a
            voucher, and its whole cost — fuel, EMI, service, anything —
            gathers under it here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className={FIELD}
            style={{ width: 200 }}
            placeholder="New tag, e.g. Bus-1"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
          />
          <button
            type="button"
            className={BTN}
            disabled={busy || !newTag.trim()}
            onClick={() => void run({ action: "save-cost-centre", name: newTag.trim() }, "Tag added")}
          >
            Add
          </button>
        </div>
      </div>

      {notice ? (
        <p className="mt-2 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-700">{notice}</p>
      ) : null}
      {error ? (
        <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-700">{error}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {centres.map((c) => (
          <span
            key={c.code}
            className="flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1 text-xs"
          >
            {renaming === c.code ? (
              <>
                <input
                  className="w-28 rounded border border-[var(--border)] px-1.5 py-0.5 text-xs"
                  value={renameTo}
                  onChange={(e) => setRenameTo(e.target.value)}
                />
                <button
                  type="button"
                  className="font-semibold"
                  disabled={busy || !renameTo.trim()}
                  onClick={() =>
                    void run(
                      { action: "save-cost-centre", code: c.code, name: renameTo.trim() },
                      "Renamed",
                    )
                  }
                >
                  ✓
                </button>
                <button type="button" onClick={() => setRenaming("")}>✕</button>
              </>
            ) : (
              <>
                <span className="font-medium">{c.name}</span>
                <button
                  type="button"
                  className="text-[var(--muted)] hover:text-[var(--brand-deep)]"
                  title="Rename"
                  onClick={() => {
                    setRenaming(c.code);
                    setRenameTo(c.name);
                  }}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="text-[var(--muted)] hover:text-red-600"
                  title="Remove (only if unused)"
                  disabled={busy}
                  onClick={() => void run({ action: "remove-cost-centre", code: c.code }, "Removed")}
                >
                  ✕
                </button>
              </>
            )}
          </span>
        ))}
      </div>

      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <div className="flex flex-wrap items-end gap-2">
          <p className="mr-2 text-xs font-bold text-[var(--brand-deep)]">
            Where the money went, by tag
          </p>
          <label className="text-[11px] text-[var(--muted)]">
            From
            <input type="date" className={FIELD} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-[11px] text-[var(--muted)]">
            To
            <input type="date" className={FIELD} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="button" className={BTN_OUTLINE} disabled={reportBusy} onClick={() => void loadReport()}>
            {reportBusy ? "Loading…" : "Show"}
          </button>
        </div>
        {byCentre.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Nothing tagged in this range yet — tags apply from the voucher
            entry&rsquo;s &ldquo;Spent on&rdquo; picker.
          </p>
        ) : (
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            {byCentre.map(([code, g]) => (
              <div key={code} className="rounded-xl border border-[var(--border)] p-2.5">
                <div className="flex justify-between text-sm font-semibold text-[var(--brand-deep)]">
                  <span>{g.name}</span>
                  <span className="tabular-nums">{formatInr(g.total)}</span>
                </div>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {g.rows.map((r) => (
                    <li key={r.accountCode} className="flex justify-between">
                      <span>{r.accountName}</span>
                      <span className="tabular-nums">{formatInr(r.amountPaise)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

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
