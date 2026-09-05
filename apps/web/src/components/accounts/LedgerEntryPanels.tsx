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
  enumerateExpenseDays,
  expenseTotalPaise,
} from "@/lib/expenseSpread";
import {
  buildFuelRefill,
  checkFuelLine,
  fuelAmountPaise,
  fuelNarration,
  isFuelAccount,
} from "@/lib/fuelExpenseLine";
import {
  loadTransport,
  recordFuelRefill,
  vehicleFuelOptions,
  type FleetVehicle,
} from "@/lib/transport";
import {
  allocateExpensePayment,
  buildExpenseVoucherLines,
} from "@/lib/expenseVoucherDraft";
import { currentAcademicYearCode, loadMasters } from "@/lib/masters";
import { isPublishedHoliday } from "@/lib/foundationMasters";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
} from "@/components/ui/erp-roster";
import { RowActionMenu } from "@/components/ui/erp-grid";

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
  /** Set when this account IS one desk bank, so the form need not ask again. */
  bankAccountId?: string;
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
      // A per-bank account carries its own bank; only the generic ones,
      // which no longer appear in the picker, could still be unanswered.
      !byCode.get(l.accountCode)?.bankAccountId &&
      banks.length > 0 &&
      !l.bankId &&
      (paiseFromRupees(l.debit) > 0 || paiseFromRupees(l.credit) > 0),
  );

  /**
   * The instrument has to agree with the account the money moved through.
   *
   * The Instrument dropdown is metadata beside the lines, not part of them,
   * so "UPI" could be recorded against Cash in Hand and "Cash" against a
   * bank — the voucher then says the money moved a way it did not, and the
   * bank reconciliation looks for an entry that is not in the bank.
   *
   * The bank itself is never ambiguous here: 1010 is not selectable, only
   * the per-bank accounts under it, so choosing the account IS choosing the
   * bank. What was missing is that nothing checked the two agreed.
   */
  const BANK_INSTRUMENTS = new Set(["upi", "bank", "neft", "rtgs", "cheque"]);
  const moneyLines = lines.filter(
    (l) =>
      (byCode.get(l.accountCode)?.isBank || byCode.get(l.accountCode)?.isCash) &&
      (paiseFromRupees(l.debit) > 0 || paiseFromRupees(l.credit) > 0),
  );
  const instrumentWantsBank = BANK_INSTRUMENTS.has(instrumentMode);
  const instrumentMismatch =
    moneyLines.length > 0 &&
    ((instrumentWantsBank &&
      !moneyLines.some((l) => byCode.get(l.accountCode)?.isBank)) ||
      (instrumentMode === "cash" &&
        !moneyLines.some((l) => byCode.get(l.accountCode)?.isCash)));

  const postable =
    totals.dr > 0 &&
    totals.dr === totals.cr &&
    lines.filter((l) => l.accountCode && (paiseFromRupees(l.debit) > 0 || paiseFromRupees(l.credit) > 0)).length >= 2 &&
    !missingBank &&
    !missingParty &&
    !instrumentMismatch;

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
            <FileText className="size-4" aria-hidden /> Internal accounting
          </h4>
          <p className="text-[11px] text-[var(--muted)]">
            Transfers, adjustments and corrections — the entries that are not
            day-to-day spending. For expenses use the two forms above, which
            write the debits and credits for you. Nothing posts until debits
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
                  onChange={(code) =>
                    setLine(i, {
                      accountCode: code,
                      // A per-bank account IS the bank — answer the question
                      // rather than asking it again. Cleared when moving to an
                      // account that names no bank, so a stale id cannot ride
                      // along on the next line.
                      bankId: byCode.get(code)?.bankAccountId ?? "",
                    })
                  }
                />
              </div>
              {acc?.isBank && !acc.bankAccountId && banks.length > 0 ? (
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
          {instrumentMismatch ? (
            <span className="ml-2 font-bold text-[var(--warning)]">
              {instrumentWantsBank
                ? "pick the bank account the money moved through — a bank instrument cannot settle to cash"
                : "cash does not move through a bank account — pick Cash in Hand, or change the instrument"}
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
                      <RowActionMenu
                        row={c}
                        label={`Actions for cheque ${c.ref}`}
                        actions={[
                          {
                            id: "clear",
                            label: "Mark cleared (into a bank)",
                            icon: <Check />,
                            disabled: () => busy,
                            onSelect: (x) => setClearing({ ref: x.ref, bankId: banks[0]?.id ?? "", date: todayIso() }),
                          },
                          {
                            id: "bounce",
                            label: "Mark bounced",
                            icon: <Undo2 />,
                            tone: "danger",
                            separatorAbove: true,
                            disabled: () => busy,
                            onSelect: (x) => void bounce(x),
                          },
                        ]}
                      />
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
/* ═══ Quick expense ════════════════════════════════════════ */

const QUICK_PAY_MODES = [
  { id: "cash", label: "Cash" },
  { id: "upi", label: "UPI" },
  { id: "bank", label: "Bank transfer" },
  { id: "cheque", label: "Cheque" },
] as const;

/**
 * The office's expense entry: head → sub-head → tag, amount, paid by, done.
 * Builds the balanced two-sided voucher behind the curtain (Dr the expense
 * sub-head, Cr cash or the bank) and posts through the same `ledger_post` as
 * the full voucher screen — same numbering, same rails: nothing posts
 * unbalanced, non-cash refuses without its transaction ID, and a posted
 * entry can only be reversed, never edited.
 */
export function QuickExpensePanel({
  banks,
  actor,
  onPosted,
}: {
  banks: { id: string; name: string }[];
  actor: string;
  onPosted?: () => void;
}) {
  const accounts = useChart();
  const [centres, setCentres] = useState<{ code: string; name: string }[]>([]);
  useEffect(() => {
    void ledgerApi<{ centres: { code: string; name: string }[] }>({
      action: "cost-centres",
    }).then((r) => {
      if (r.ok && r.centres) setCentres(r.centres);
    });
  }, []);

  const [category, setCategory] = useState("");
  const [subHead, setSubHead] = useState("");
  const [amount, setAmount] = useState("");
  const [payMode, setPayMode] = useState<(typeof QUICK_PAY_MODES)[number]["id"]>("cash");
  const [bankId, setBankId] = useState("");
  const [ref, setRef] = useState("");
  const [date, setDate] = useState(todayIso());
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  /** Bill a daily rate across the days picked between `date` and `toDate`. */
  const [spread, setSpread] = useState(false);
  const [toDate, setToDate] = useState(todayIso());
  /**
   * The days actually ticked. Null means "not touched yet", so the plan's
   * own default (every working day) stands; once the office clicks a day this
   * holds their choice and is not silently overwritten.
   */
  const [picked, setPicked] = useState<Set<string> | null>(null);

  // Heads = expense categories; a category with sub-heads opens the second
  // select, one without posts directly.
  // The store's automation owns these — COGS, write-offs, store purchases,
  // concessions. Money never goes to them by hand, so the quick form does
  // not offer them; the full voucher screen still can when a correction
  // genuinely needs it.
  const SYSTEM_HEADS = useMemo(() => new Set(["5060", "5065", "5066", "5100"]), []);
  const heads = useMemo(
    () =>
      accounts.filter(
        (a) =>
          a.kind === "expense" &&
          a.parentCode === "5" &&
          !SYSTEM_HEADS.has(a.code),
      ),
    [accounts, SYSTEM_HEADS],
  );
  const subHeads = useMemo(
    () => accounts.filter((a) => a.parentCode === category),
    [accounts, category],
  );
  const chosenHead = useMemo(() => {
    const cat = accounts.find((a) => a.code === category);
    if (!cat) return undefined;
    if (cat.hasChildren) return accounts.find((a) => a.code === subHead);
    return cat;
  }, [accounts, category, subHead]);

  const amountPaise = paiseFromRupees(amount);
  const needsBank = payMode !== "cash";

  /**
   * The days this amount actually lands on.
   *
   * The office buys milk every school day and settles it weekly. Entered by
   * hand that is seven vouchers, so it went in as one lump on one date —
   * which reads as a week's milk bought on a Tuesday and hides the day the
   * school was shut. The school's own holiday calendar decides which days
   * are billable, so a Sunday or a gazetted holiday drops out by itself.
   */
  const plan = useMemo(() => {
    if (!spread) return null;
    const masters = loadMasters();
    // The holiday list is per academic year, and the library default is a
    // past one — ask about the running session.
    const ay = currentAcademicYearCode(masters);
    return enumerateExpenseDays({
      from: date,
      to: toDate,
      holidayReason: (d: string) =>
        isPublishedHoliday(masters, d, ay)?.title ?? null,
    });
  }, [spread, date, toDate]);

  // Which days are billed: the office's picks once they have clicked, the
  // working days until then.
  const selectedDates = useMemo(() => {
    if (!plan || !plan.ok) return [] as string[];
    if (picked) return plan.days.filter((d) => picked.has(d.date)).map((d) => d.date);
    return plan.days.filter((d) => d.selectedByDefault).map((d) => d.date);
  }, [plan, picked]);

  const spreadTotalPaise = expenseTotalPaise(amountPaise, selectedDates);

  /**
   * The calendar, month by month.
   *
   * A whole month is the common case — milk for September — and a range that
   * crosses a month boundary was otherwise an unbroken run of numbers with
   * two 1sts in it and nothing to say which was which. Each month gets its
   * own caption and its own leading blanks, so it reads like a calendar.
   */
  const months = useMemo(() => {
    if (!plan || !plan.ok) return [];
    const out: { key: string; label: string; days: typeof plan.days }[] = [];
    for (const d of plan.days) {
      const key = d.date.slice(0, 7);
      const last = out[out.length - 1];
      if (last && last.key === key) last.days.push(d);
      else
        out.push({
          key,
          label: new Date(`${d.date}T12:00:00`).toLocaleDateString("en-IN", {
            month: "long",
            year: "numeric",
          }),
          days: [d],
        });
    }
    return out;
  }, [plan]);

  /** Set the range to one whole calendar month, from its own month input. */
  const pickWholeMonth = (yyyymm: string) => {
    if (!/^\d{4}-\d{2}$/.test(yyyymm)) return;
    const [y, m] = yyyymm.split("-").map(Number);
    // Day 0 of the NEXT month is the last day of this one, so February and
    // leap years need no special case.
    const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
    setDate(`${yyyymm}-01`);
    setToDate(`${yyyymm}-${String(lastDay).padStart(2, "0")}`);
    setPicked(null);
  };

  /** Bulk helpers — a month of milk is 26 clicks otherwise. */
  const selectAllWorking = () => setPicked(null);
  const selectEveryDay = () => {
    if (!plan || !plan.ok) return;
    setPicked(new Set(plan.days.map((d) => d.date)));
  };
  const selectNone = () => setPicked(new Set());

  const toggleDay = (iso: string) => {
    if (!plan || !plan.ok) return;
    const base =
      picked ??
      new Set(plan.days.filter((d) => d.selectedByDefault).map((d) => d.date));
    const next = new Set(base);
    if (next.has(iso)) next.delete(iso);
    else next.add(iso);
    setPicked(next);
  };

  const canPost =
    !!chosenHead &&
    amountPaise > 0 &&
    !!date &&
    (!spread || ((plan?.ok ?? false) && selectedDates.length > 0)) &&
    (!needsBank || (!!bankId && ref.trim() !== ""));

  async function post() {
    if (!canPost || !chosenHead) return;
    setBusy(true);
    setNotice(null);
    try {
      const tagName = centres.find((c) => c.code === tag)?.name ?? "";
      const payLine =
        payMode === "cash"
          ? { accountCode: "1000" }
          : {
              accountCode: "1010",
              subledgerKind: "bank_account",
              subledgerId: bankId,
              instrument: { mode: payMode, ref: ref.trim(), date },
            };
      // One voucher per day when spreading, one on `date` otherwise. Each day
      // is posted separately so a refusal on one — a locked period, say —
      // does not silently take the rest of the week with it.
      const days =
        plan && plan.ok
          ? selectedDates.map((d) => ({ date: d, amountPaise }))
          : [{ date, amountPaise }];

      let posted = 0;
      let lastNo = "";
      let firstError = "";
      for (const day of days) {
        const res = await ledgerApi<{ voucherNo?: string }>({
          action: "post",
          voucher: {
            voucherType: "payment",
            date: day.date,
            narration:
              (note.trim() ||
                `${chosenHead.name}${tagName ? ` — ${tagName}` : ""}`) +
              (days.length > 1 ? ` · ${day.date}` : ""),
            createdBy: actor,
            lines: [
              {
                accountCode: chosenHead.code,
                debitPaise: day.amountPaise,
                creditPaise: 0,
                ...(tag ? { costCentreCode: tag } : {}),
              },
              {
                ...payLine,
                ...(payMode !== "cash"
                  ? { instrument: { mode: payMode, ref: ref.trim(), date: day.date } }
                  : {}),
                debitPaise: 0,
                creditPaise: day.amountPaise,
                ...(tag ? { costCentreCode: tag } : {}),
              },
            ],
          },
        });
        if (res.ok) {
          posted += 1;
          lastNo = res.voucherNo ?? lastNo;
        } else if (!firstError) {
          firstError = res.error || "The book refused this entry";
        }
      }

      const res = {
        ok: posted > 0,
        voucherNo: lastNo,
        error: firstError,
      };
      if (res.ok) {
        const totalPosted = amountPaise * posted;
        setNotice({
          tone: "ok",
          text:
            days.length > 1
              ? `${posted} voucher(s) — ${formatInr(totalPosted)} ${chosenHead.name}${tagName ? ` (${tagName})` : ""}` +
                (firstError ? ` · 1 or more refused: ${firstError}` : "")
              : `${res.voucherNo || "Posted"} — ${formatInr(amountPaise)} ${chosenHead.name}${tagName ? ` (${tagName})` : ""}`,
        });
        // Head, date, tag and paid-by stay put for the next entry in the
        // pile; only what must differ per entry clears.
        setAmount("");
        setRef("");
        setNote("");
        onPosted?.();
      } else {
        setNotice({ tone: "bad", text: res.error || "The book refused this entry" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={CARD}>
      <h4 className="text-sm font-bold text-[var(--brand-deep)]">Quick expense</h4>
      <p className="text-[11px] text-[var(--muted)]">
        Head, amount, paid by — the balanced voucher is written for you. For
        anything unusual, the full voucher screen below still does everything.
      </p>

      {/* The repeating daily expense — milk, newspapers — is the one the
          office most often shortcuts into a single lump on one date. */}
      <label className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[var(--brand-deep)]">
        <input
          type="checkbox"
          checked={spread}
          onChange={(e) => {
            setSpread(e.target.checked);
            // Default to the WHOLE month the date sits in. A month is the
            // common case, and starting at today–today meant the month picker
            // did nothing when the office chose the month it was already in —
            // the input already read that month, so nothing changed and the
            // range stayed one day.
            if (e.target.checked) pickWholeMonth(date.slice(0, 7));
          }}
        />
        Bill a daily rate over a range — a week of milk in one go
        {spread ? (
          <span className="font-normal text-[var(--muted)]">
            · the amount above is the rate for ONE day
          </span>
        ) : null}
      </label>

      {spread ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] font-bold text-[var(--muted)]">
              Up to
              <input
                type="date"
                className={FIELD}
                value={toDate}
                min={date}
                onChange={(e) => {
                  setToDate(e.target.value);
                  // The old picks belonged to the old range.
                  setPicked(null);
                }}
              />
            </label>
            {/* A whole month is the common case — milk for September — and
                setting the 1st and the 30th by hand every time, remembering
                which months have 30, is the sort of thing a computer should
                do. */}
            <label className="text-[11px] font-bold text-[var(--muted)]">
              Or a whole month
              <input
                type="month"
                className={FIELD}
                value={date.slice(0, 7)}
                onChange={(e) => pickWholeMonth(e.target.value)}
              />
            </label>
            <p className="flex-1 rounded-lg bg-[var(--surface-sunken)] px-3 py-1.5 text-[11px]">
              {!plan ? null : !plan.ok ? (
                <span className="font-semibold text-[var(--warning)]">
                  {plan.error}
                </span>
              ) : (
                <span className="font-bold text-[var(--brand-deep)]">
                  {selectedDates.length} day(s) × {formatInr(amountPaise)} ={" "}
                  {formatInr(spreadTotalPaise)}
                  {plan.holidayCount > 0 ? (
                    <span className="font-normal text-[var(--muted)]">
                      {" "}
                      · {plan.holidayCount} holiday(s) in range, left out
                    </span>
                  ) : null}
                </span>
              )}
            </p>
          </div>

          {/* Click the days.
              Holidays are marked and unticked but NOT locked: the school opens
              the odd Sunday, and locking would mean editing the school
              calendar just to book a day of milk. Days outside the range are
              simply not offered. */}
          {plan && plan.ok ? (
            <div className="rounded-xl border border-[var(--border)] p-2">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px]">
                <span className="font-bold text-[var(--muted)]">Tick</span>
                <button
                  type="button"
                  className="rounded-lg bg-[var(--surface-sunken)] px-2 py-1 font-semibold"
                  onClick={selectAllWorking}
                >
                  Working days
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-[var(--surface-sunken)] px-2 py-1 font-semibold"
                  onClick={selectEveryDay}
                >
                  Every day
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-[var(--surface-sunken)] px-2 py-1 font-semibold"
                  onClick={selectNone}
                >
                  None
                </button>
              </div>

              {months.map((month) => (
                <div key={month.key} className="mb-2 last:mb-0">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[var(--brand-deep)]">
                    {month.label}
                  </p>
                  <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[9px] font-bold uppercase text-[var(--muted)]">
                    {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                      <span key={d}>{d}</span>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {/* Blanks so each month's first day sits under its weekday. */}
                    {Array.from({ length: month.days[0]?.weekday ?? 0 }).map((_, i) => (
                      <span key={`pad-${month.key}-${i}`} />
                    ))}
                    {month.days.map((d) => {
                      const on = selectedDates.includes(d.date);
                      const holiday = d.holidayReason !== null;
                      return (
                        <button
                          key={d.date}
                          type="button"
                          title={
                            holiday
                              ? `${d.date} — ${d.holidayReason} (tick it if the school worked)`
                              : d.date
                          }
                          onClick={() => toggleDay(d.date)}
                          className={`rounded-lg px-1 py-1.5 text-[11px] font-bold transition ${
                            on
                              ? "bg-[var(--brand-deep)] text-white"
                              : holiday
                                ? "bg-[var(--warning-soft)] text-[var(--warning)] line-through"
                                : "bg-[var(--surface-sunken)] text-[var(--muted)]"
                          }`}
                        >
                          {Number(d.date.slice(8, 10))}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Struck days are school holidays and are not billed — click one
                to include it if the school worked that day.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p
          className={`mt-2 rounded-lg px-3 py-1.5 text-xs ${
            notice.tone === "ok"
              ? "bg-emerald-500/10 text-emerald-700"
              : "bg-red-500/10 text-red-700"
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-bold text-[var(--muted)]">
          Head
          <select
            className={FIELD}
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setSubHead("");
            }}
          >
            <option value="">Choose…</option>
            {heads.map((h) => (
              <option key={h.code} value={h.code}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        {subHeads.length > 0 ? (
          <label className="text-[11px] font-bold text-[var(--muted)]">
            Sub-head
            <select
              className={FIELD}
              value={subHead}
              onChange={(e) => setSubHead(e.target.value)}
            >
              <option value="">Choose…</option>
              {subHeads.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="text-[11px] font-bold text-[var(--muted)]">
          Spent on
          <select className={FIELD} value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">No tag</option>
            {centres.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-bold text-[var(--muted)]">
          {spread ? "Rate per day (₹)" : "Amount (₹)"}
          <input
            className={FIELD}
            style={{ width: 110 }}
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="text-[11px] font-bold text-[var(--muted)]">
          Date
          <input type="date" className={FIELD} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="text-[11px] font-bold text-[var(--muted)]">
          Paid by
          <div className="mt-1 flex gap-1">
            {QUICK_PAY_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setPayMode(m.id)}
                className={
                  payMode === m.id
                    ? "rounded-lg bg-[var(--primary)] px-2.5 py-1.5 text-xs font-semibold text-[var(--primary-foreground)]"
                    : "rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs"
                }
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {needsBank ? (
          <>
            <label className="text-[11px] font-bold text-[var(--muted)]">
              Which bank
              <select className={FIELD} value={bankId} onChange={(e) => setBankId(e.target.value)}>
                <option value="">Choose…</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-bold text-[var(--muted)]">
              Transaction ID
              <input
                className={FIELD}
                style={{ width: 160 }}
                placeholder="UTR / cheque no."
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              />
            </label>
          </>
        ) : null}
        <label className="min-w-[12rem] flex-1 text-[11px] font-bold text-[var(--muted)]">
          Note (optional)
          <input
            className={FIELD}
            placeholder="what this was for"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button type="button" className={BTN} disabled={busy || !canPost} onClick={() => void post()}>
          {busy ? "Posting…" : "Save expense"}
        </button>
      </div>
      {needsBank && (!bankId || !ref.trim()) ? (
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          A payment that is not cash needs its bank and transaction ID before
          it can post — that is what ties it to the bank statement later.
        </p>
      ) : null}
    </section>
  );
}

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

/* ═══ Multi-line expense voucher ═══════════════════════════ */

/**
 * One trip to the market, one voucher.
 *
 * A printer cartridge and a tank of CNG are two heads, two vendors and often
 * one payment that covers only part of it. Quick expense above handles the
 * single-head case in three fields; this is for the pile.
 *
 * Thin on purpose: every rupee decision — how a part payment splits, where
 * tax goes, which vendor is owed what — lives in expenseVoucherDraft and is
 * tested there.
 */
export function MultiLineExpensePanel({
  banks,
  actor,
  onPosted,
}: {
  banks: { id: string; name: string }[];
  actor: string;
  onPosted?: () => void;
}) {
  const accounts = useChart();
  const [centres, setCentres] = useState<{ code: string; name: string }[]>([]);
  /**
   * The tag each head was last booked to.
   *
   * Fuel is always Transport, the printer is always School — typing it every
   * time is how tags stop being used at all. Read from the book rather than
   * remembered in this browser, so it is the same on whichever machine the
   * office is sitting at, and it is a SUGGESTION: it fills an untouched row
   * and never overrides a choice already made.
   */
  const [recentTags, setRecentTags] = useState<Record<string, string>>({});
  useEffect(() => {
    void ledgerApi<{ centres: { code: string; name: string }[] }>({
      action: "cost-centres",
    }).then((r) => {
      if (r.ok && r.centres) setCentres(r.centres);
    });
    void ledgerApi<{ tags: Record<string, string> }>({
      action: "recent-tags",
    }).then((r) => {
      if (r.ok && r.tags) setRecentTags(r.tags);
    });
  }, []);

  type Row = {
    id: string;
    head: string;
    subHead: string;
    vendorName: string;
    tag: string;
    description: string;
    amount: string;
    tax: string;
    /** True once a person picks the tag, so a suggestion never overwrites it. */
    tagTouched: boolean;
    /** Present only on a fuel head: the fill behind the amount. */
    vehicleId: string;
    fuelType: string;
    fuelUnit: string;
    fuelRate: string;
    fuelQty: string;
    odometer: string;
  };
  const blankRow = (): Row => ({
    id: `r${Math.random().toString(36).slice(2, 8)}`,
    head: "",
    subHead: "",
    vendorName: "",
    tag: "",
    description: "",
    amount: "",
    tax: "",
    tagTouched: false,
    vehicleId: "",
    fuelType: "",
    fuelUnit: "",
    fuelRate: "",
    fuelQty: "",
    odometer: "",
  });

  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const [payMode, setPayMode] = useState("cash");
  const [bankId, setBankId] = useState("");
  const [ref, setRef] = useState("");
  /** Blank means "pay it all"; a figure means a part payment. */
  const [payNow, setPayNow] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  // Same rule as Quick expense: the store's automation owns these codes, so
  // money never goes to them by hand.
  const SYSTEM_HEADS = useMemo(() => new Set(["5060", "5065", "5066", "5100"]), []);
  const heads = useMemo(
    () =>
      accounts.filter(
        (a) => a.kind === "expense" && a.parentCode === "5" && !SYSTEM_HEADS.has(a.code),
      ),
    [accounts, SYSTEM_HEADS],
  );
  const subHeadsOf = (head: string) => accounts.filter((a) => a.parentCode === head);
  const accountOf = (r: Row) => {
    const head = accounts.find((a) => a.code === r.head);
    if (!head) return undefined;
    return head.hasChildren ? accounts.find((a) => a.code === r.subHead) : head;
  };

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  /**
   * The fleet, read from the Transport desk rather than the chart.
   *
   * Vehicles are not sub-heads: the fleet changes when one is sold, and a
   * chart of accounts that grows an account per number plate is a chart
   * nobody can read. The vehicle is recorded on the line and in Transport's
   * own fuel log, which is where per-vehicle mileage already lives.
   */
  const [fleet, setFleet] = useState<FleetVehicle[]>([]);
  useEffect(() => {
    try {
      const t = loadTransport();
      setFleet(t.vehicles ?? []);
    } catch {
      // Transport not opened in this browser yet — the fuel strip simply does
      // not appear, and the expense can still be booked as a plain amount.
      setFleet([]);
    }
  }, []);

  const isFuelRow = (r: Row) => {
    const a = accountOf(r);
    return !!a && isFuelAccount({ code: a.code, name: a.name });
  };
  const vehicleOf = (r: Row) => fleet.find((v) => v.id === r.vehicleId);
  const fuelsOf = (r: Row) => {
    const v = vehicleOf(r);
    return v ? vehicleFuelOptions(v) : [];
  };
  /** On a fuel row the amount is rate × quantity, never a typed figure. */
  const rowAmountPaise = (r: Row) =>
    isFuelRow(r)
      ? fuelAmountPaise(paiseFromRupees(r.fuelRate), Number(r.fuelQty) || 0)
      : paiseFromRupees(r.amount);

  /**
   * The tag this head was last booked to, offered only into an untouched row.
   * Returns nothing when the row already has a tag someone chose, when the
   * head has no history, or when the remembered centre no longer exists.
   */
  function suggestTag(row: Row, head: string, subHead?: string): Partial<Row> {
    if (row.tagTouched) return {};
    const code = subHead || (accounts.find((a) => a.code === head)?.hasChildren ? "" : head);
    if (!code) return {};
    const remembered = recentTags[code];
    if (!remembered || !centres.some((c) => c.code === remembered)) return {};
    return { tag: remembered };
  }

  const draftLines = useMemo(
    () =>
      rows.map((r) => ({
        id: r.id,
        accountCode: accountOf(r)?.code ?? "",
        tag: r.tag,
        vendorName: r.vendorName,
        description: isFuelRow(r)
          ? fuelNarration({
              vehicleNo: vehicleOf(r)?.registrationNo ?? "",
              pick: {
                fuelType: r.fuelType,
                unit: r.fuelUnit,
                qty: Number(r.fuelQty) || 0,
                ratePaisePerUnit: paiseFromRupees(r.fuelRate),
                odometerKm: Number(r.odometer) || 0,
              },
            }) + (r.description.trim() ? ` · ${r.description.trim()}` : "")
          : r.description,
        amountPaise: rowAmountPaise(r),
        taxPaise: paiseFromRupees(r.tax),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, accounts, fleet],
  );

  const grandTotal = draftLines.reduce(
    (n, l) => n + Math.max(0, l.amountPaise) + Math.max(0, l.taxPaise),
    0,
  );
  // An empty box means the whole voucher is being paid, which is the common
  // case; typing a figure makes it a part payment.
  const paidPaise = payNow.trim() === "" ? grandTotal : paiseFromRupees(payNow);
  const totals = useMemo(
    () => allocateExpensePayment(draftLines, paidPaise),
    [draftLines, paidPaise],
  );

  /**
   * Every fuel row's own checks, surfaced before the voucher can be posted.
   *
   * A fuel line that will not produce a valid refill must not post at all: the
   * money would be in the book with no litres against it, and nobody would
   * ever notice the mileage record was missing.
   */
  const fuelIssues = useMemo(() => {
    const problems: string[] = [];
    const warnings: string[] = [];
    for (const r of rows) {
      if (!isFuelRow(r)) continue;
      const v = vehicleOf(r);
      const res = checkFuelLine({
        pick: {
          vehicleId: r.vehicleId,
          fuelType: r.fuelType,
          unit: r.fuelUnit,
          ratePaisePerUnit: paiseFromRupees(r.fuelRate),
          qty: Number(r.fuelQty) || 0,
          odometerKm: Number(r.odometer) || 0,
        },
        allowedFuels: fuelsOf(r),
        lastOdometerKm: v?.odometerKm,
      });
      problems.push(...res.problems);
      warnings.push(...res.warnings);
    }
    return { problems, warnings };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, accounts, fleet]);

  const needsBank = payMode !== "cash";
  const canPost =
    totals.grandTotalPaise > 0 &&
    draftLines.every((l) => !l.accountCode === !(l.amountPaise + l.taxPaise) || l.accountCode) &&
    rows.every((r) => {
      const t = rowAmountPaise(r) + paiseFromRupees(r.tax);
      return t === 0 || !!accountOf(r);
    }) &&
    (totals.paidPaise === 0 || !needsBank || (!!bankId && ref.trim() !== "")) &&
    fuelIssues.problems.length === 0;

  async function post() {
    if (!canPost || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const bankAccount = accounts.find(
        (a) => a.isBank && a.bankAccountId === bankId,
      );
      const lines = buildExpenseVoucherLines({
        totals,
        gstInputCode: "1080",
        payableCode: "2000",
        payment:
          payMode === "cash"
            ? { kind: "cash", accountCode: "1000" }
            : {
                kind: "bank",
                // Prefer the per-bank account when the chart has one; 1010 is
                // the generic fallback the quick form also uses.
                accountCode: bankAccount?.code ?? "1010",
                bankId,
                mode: payMode,
                ref: ref.trim(),
                date,
              },
      });
      const res = await ledgerApi<{ voucherNo?: string }>({
        action: "post",
        voucher: {
          voucherType: "payment",
          date,
          narration: note.trim() || `Expenses — ${totals.lines.length} item(s)`,
          createdBy: actor,
          lines,
        },
      });
      if (res.ok) {
        // The book has the money; Transport gets the litres. Written only
        // AFTER the voucher posts, so a refused voucher cannot leave a fuel
        // log behind claiming a fill that was never paid for. If a refill is
        // rejected here the voucher still stands — it is real money — and the
        // failure is said out loud rather than swallowed, because a silent
        // miss is a mileage figure that is quietly wrong from then on.
        const fuelRows = rows.filter((r) => isFuelRow(r));
        const refillErrors: string[] = [];
        for (const r of fuelRows) {
          try {
            const out = recordFuelRefill(
              buildFuelRefill({
                pick: {
                  vehicleId: r.vehicleId,
                  fuelType: r.fuelType,
                  unit: r.fuelUnit,
                  ratePaisePerUnit: paiseFromRupees(r.fuelRate),
                  qty: Number(r.fuelQty) || 0,
                  odometerKm: Number(r.odometer) || 0,
                },
                vendorName: r.vendorName,
                billNo: ref.trim(),
                filledAt: `${date}T12:00:00.000Z`,
                paidInFull: totals.duePaise === 0,
              }),
            );
            if (!out.ok) {
              refillErrors.push(
                `${vehicleOf(r)?.registrationNo ?? "vehicle"}: ${out.error}`,
              );
            }
          } catch (e) {
            refillErrors.push(
              `${vehicleOf(r)?.registrationNo ?? "vehicle"}: ${
                e instanceof Error ? e.message : "could not record the fill"
              }`,
            );
          }
        }

        setNotice({
          tone: refillErrors.length ? "bad" : "ok",
          text:
            `${res.voucherNo ?? "Posted"} — ${formatInr(totals.grandTotalPaise)}` +
            (totals.duePaise > 0
              ? ` · ${formatInr(totals.duePaise)} left owing`
              : " · paid in full") +
            (fuelRows.length && !refillErrors.length
              ? ` · ${fuelRows.length} fill(s) logged in Transport`
              : "") +
            (refillErrors.length
              ? ` · POSTED, but the fuel log was NOT written (${refillErrors.join("; ")}) — record it in Transport by hand`
              : ""),
        });
        setRows([blankRow()]);
        setNote("");
        setRef("");
        setPayNow("");
        onPosted?.();
      } else {
        setNotice({ tone: "bad", text: res.error || "The book refused this voucher" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={CARD}>
      <h4 className="text-sm font-bold text-[var(--brand-deep)]">
        Expense voucher — several heads at once
      </h4>
      <p className="text-[11px] text-[var(--muted)]">
        One trip, one voucher: a head and sub-head per line, with its own
        vendor and tag. Pay all of it or part — whatever is left stays owing to
        the vendor it belongs to.
      </p>

      {notice ? (
        <p
          className={`mt-2 rounded-lg px-3 py-1.5 text-xs ${
            notice.tone === "ok"
              ? "bg-emerald-500/10 text-emerald-700"
              : "bg-red-500/10 text-red-700"
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-[11px] font-bold text-[var(--muted)]">
          Date
          <input
            type="date"
            className={FIELD}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="min-w-[14rem] flex-1 text-[11px] font-bold text-[var(--muted)]">
          Note
          <input
            className={FIELD}
            placeholder="what this trip was for"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-3 space-y-2">
        {rows.map((r) => {
          const subs = subHeadsOf(r.head);
          const fuelRow = isFuelRow(r);
          const fuels = fuelsOf(r);
          const rowTotal = rowAmountPaise(r) + paiseFromRupees(r.tax);
          return (
            <div
              key={r.id}
              className="rounded-xl border border-[var(--border)] p-2"
            >
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[10rem] flex-1 text-[10px] font-bold text-[var(--muted)]">
                  Head
                  <select
                    className={FIELD}
                    value={r.head}
                    onChange={(e) =>
                      setRow(r.id, {
                        head: e.target.value,
                        subHead: "",
                        ...suggestTag(r, e.target.value),
                      })
                    }
                  >
                    <option value="">Choose…</option>
                    {heads.map((h) => (
                      <option key={h.code} value={h.code}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </label>
                {subs.length > 0 ? (
                  <label className="min-w-[10rem] flex-1 text-[10px] font-bold text-[var(--muted)]">
                    Sub-head
                    <select
                      className={FIELD}
                      value={r.subHead}
                      onChange={(e) =>
                        setRow(r.id, {
                          subHead: e.target.value,
                          ...suggestTag(r, r.head, e.target.value),
                        })
                      }
                    >
                      <option value="">Choose…</option>
                      {subs.map((sh) => (
                        <option key={sh.code} value={sh.code}>
                          {sh.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="min-w-[9rem] flex-1 text-[10px] font-bold text-[var(--muted)]">
                  Vendor
                  <input
                    className={FIELD}
                    placeholder="who was paid"
                    value={r.vendorName}
                    onChange={(e) => setRow(r.id, { vendorName: e.target.value })}
                  />
                </label>
                <label className="text-[10px] font-bold text-[var(--muted)]">
                  Tag
                  <select
                    className={FIELD}
                    value={r.tag}
                    onChange={(e) =>
                      setRow(r.id, { tag: e.target.value, tagTouched: true })
                    }
                  >
                    <option value="">No tag</option>
                    {centres.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="min-w-[12rem] flex-1 text-[10px] font-bold text-[var(--muted)]">
                  Description
                  <input
                    className={FIELD}
                    placeholder="e.g. printer cartridge"
                    value={r.description}
                    onChange={(e) => setRow(r.id, { description: e.target.value })}
                  />
                </label>
                {fuelRow ? (
                  <span className="text-[10px] font-bold text-[var(--muted)]">
                    Amount ₹
                    <span
                      className={`${FIELD} block max-w-[7rem] bg-[var(--surface-2)] text-right tabular-nums`}
                      title="Rate × quantity — enter those below"
                    >
                      {(rowAmountPaise(r) / 100).toFixed(2)}
                    </span>
                  </span>
                ) : (
                  <label className="text-[10px] font-bold text-[var(--muted)]">
                    Amount ₹
                    <input
                      className={`${FIELD} max-w-[7rem] text-right`}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={r.amount}
                      onChange={(e) => setRow(r.id, { amount: e.target.value })}
                    />
                  </label>
                )}
                <label className="text-[10px] font-bold text-[var(--muted)]">
                  Tax ₹
                  <input
                    className={`${FIELD} max-w-[6rem] text-right`}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={r.tax}
                    onChange={(e) => setRow(r.id, { tax: e.target.value })}
                  />
                </label>
                <span className="min-w-[6rem] text-right text-[11px] font-bold tabular-nums text-[var(--brand-deep)]">
                  {formatInr(rowTotal)}
                </span>
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-[var(--danger)] disabled:opacity-30"
                  disabled={rows.length === 1}
                  onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                  aria-label="Remove line"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>

              {/* Only on a fuel head, and only when Transport has a fleet to
                  choose from — every other expense stays a plain amount. */}
              {fuelRow ? (
                fleet.length === 0 ? (
                  <p className="mt-2 rounded-lg bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700">
                    This is a fuel head, but no vehicles have loaded in this
                    browser. Open Transport once, then come back — otherwise
                    the fill cannot be logged against a vehicle.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-[var(--surface-2)] p-2">
                    <label className="min-w-[9rem] flex-1 text-[10px] font-bold text-[var(--muted)]">
                      Vehicle
                      <select
                        className={FIELD}
                        value={r.vehicleId}
                        onChange={(e) => {
                          const v = fleet.find((x) => x.id === e.target.value);
                          const opts = v ? vehicleFuelOptions(v) : [];
                          // The fuel and its unit follow the vehicle: a
                          // CNG+Petrol bus offers both, everything else is
                          // settled the moment the vehicle is chosen.
                          setRow(r.id, {
                            vehicleId: e.target.value,
                            fuelType: opts[0]?.fuelType ?? "",
                            fuelUnit: opts[0]?.unit ?? "",
                            odometer: v?.odometerKm ? String(v.odometerKm) : "",
                          });
                        }}
                      >
                        <option value="">Choose…</option>
                        {fleet.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.registrationNo} — {v.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    {fuels.length > 1 ? (
                      <label className="text-[10px] font-bold text-[var(--muted)]">
                        Fuel
                        <select
                          className={FIELD}
                          value={r.fuelType}
                          onChange={(e) => {
                            const f = fuels.find((x) => x.fuelType === e.target.value);
                            setRow(r.id, {
                              fuelType: e.target.value,
                              fuelUnit: f?.unit ?? "",
                            });
                          }}
                        >
                          {fuels.map((f) => (
                            <option key={f.fuelType} value={f.fuelType}>
                              {f.fuelType} ({f.unit})
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : fuels.length === 1 ? (
                      <span className="rounded-lg bg-[var(--brand-deep)]/10 px-2 py-1 text-[10px] font-bold text-[var(--brand-deep)]">
                        {fuels[0].fuelType} · {fuels[0].unit}
                      </span>
                    ) : null}

                    <label className="text-[10px] font-bold text-[var(--muted)]">
                      Rate ₹/{r.fuelUnit || "unit"}
                      <input
                        className={`${FIELD} max-w-[6rem] text-right`}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={r.fuelRate}
                        onChange={(e) => setRow(r.id, { fuelRate: e.target.value })}
                      />
                    </label>
                    <label className="text-[10px] font-bold text-[var(--muted)]">
                      {r.fuelUnit ? r.fuelUnit.charAt(0).toUpperCase() + r.fuelUnit.slice(1) : "Qty"}
                      <input
                        className={`${FIELD} max-w-[5.5rem] text-right`}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={r.fuelQty}
                        onChange={(e) => setRow(r.id, { fuelQty: e.target.value })}
                      />
                    </label>
                    <label className="text-[10px] font-bold text-[var(--muted)]">
                      Odometer km
                      <input
                        className={`${FIELD} max-w-[7rem] text-right`}
                        inputMode="numeric"
                        placeholder="0"
                        value={r.odometer}
                        onChange={(e) => setRow(r.id, { odometer: e.target.value })}
                      />
                    </label>
                  </div>
                )
              ) : null}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className={`${BTN_OUTLINE} mt-2`}
        onClick={() => setRows((rs) => [...rs, blankRow()])}
      >
        <Plus className="size-3.5" aria-hidden /> Add line
      </button>

      {fuelIssues.problems.length ? (
        <ul className="mt-2 space-y-0.5 rounded-lg bg-red-500/10 px-3 py-1.5 text-[11px] text-red-700">
          {fuelIssues.problems.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      {fuelIssues.warnings.length ? (
        <ul className="mt-2 space-y-0.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700">
          {fuelIssues.warnings.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 rounded-xl bg-[var(--surface-sunken)] p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] font-bold text-[var(--muted)]">
            Paid by
            <select
              className={FIELD}
              value={payMode}
              onChange={(e) => setPayMode(e.target.value)}
            >
              {QUICK_PAY_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          {needsBank ? (
            <>
              <label className="text-[11px] font-bold text-[var(--muted)]">
                Bank
                <select
                  className={FIELD}
                  value={bankId}
                  onChange={(e) => setBankId(e.target.value)}
                >
                  <option value="">Which bank…</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] font-bold text-[var(--muted)]">
                Reference
                <input
                  className={FIELD}
                  placeholder="UTR / cheque no."
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                />
              </label>
            </>
          ) : null}
          <label className="text-[11px] font-bold text-[var(--muted)]">
            Paying now ₹
            <input
              className={`${FIELD} max-w-[8rem] text-right`}
              inputMode="decimal"
              placeholder={formatInr(grandTotal).replace("₹", "")}
              value={payNow}
              onChange={(e) => setPayNow(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          <span className="font-bold text-[var(--brand-deep)]">
            Total {formatInr(totals.grandTotalPaise)}
          </span>
          <span className="text-[var(--muted)]">
            of which tax {formatInr(totals.taxPaise)}
          </span>
          <span className="font-bold text-[var(--success)]">
            Paying today {formatInr(totals.paidPaise)}
          </span>
          <span
            className={`font-bold ${
              totals.duePaise > 0 ? "text-[var(--warning)]" : "text-[var(--muted)]"
            }`}
          >
            Left owing {formatInr(totals.duePaise)}
          </span>
        </div>

        {totals.duesByVendor.length > 0 ? (
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Owed after this voucher —{" "}
            {totals.duesByVendor
              .map((d) => `${d.vendorName}: ${formatInr(d.duePaise)}`)
              .join(" · ")}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        className={`${BTN} mt-3`}
        disabled={!canPost || busy}
        onClick={() => void post()}
      >
        <Check className="size-3.5" aria-hidden />
        {busy ? "Posting…" : "Post voucher"}
      </button>
    </section>
  );
}
