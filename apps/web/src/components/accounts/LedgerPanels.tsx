"use client";

/**
 * Accounts → the server book (Ledger v2), on screen.
 *
 * Phase A of the redesign: no new accounting logic here — every figure is
 * fetched from /api/ledger, which reads the append-only ledger the P0–P5
 * engine work built. These panels are deliberately read-heavy: the book is
 * filled by projection from source documents, not by forms in this file.
 *
 * Three panels:
 *   LedgerBookPanel    — position, anomalies, ageing, projection & coverage
 *   LedgerReportsPanel — TB, I&E, Balance Sheet, R&P, statements, CA pack
 *   BankReconPanel     — statement import, auto-match, the reconciliation
 *
 * House rule carried through: unknown is shown as unknown. An empty book
 * renders as an empty book with the reason beside it, never as zeros that
 * imply "checked and nil".
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  Download,
  RefreshCw,
  Scale,
} from "lucide-react";
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

/* ─── Fiscal-year helpers (Indian FY, April–March) ─────────── */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fyStart(d = new Date()): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-04-01`;
}

function fyCode(d = new Date()): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `FY${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/** One POST to the ledger API; every panel goes through this. */
async function ledgerApi<T>(body: Record<string, unknown>): Promise<T & { ok?: boolean; error?: string }> {
  const res = await fetch("/api/ledger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T & { ok?: boolean; error?: string };
}

function downloadText(filename: string, text: string) {
  const blob = new Blob(["﻿", text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* ─── Shared shapes (mirror of the server types, read side) ── */

type Anomaly = {
  code: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  references: string[];
  amountPaise: number;
  suggestedAction?: string;
};

type AgeingReport = {
  asOf: string;
  rows: {
    partyKey: string;
    partyName: string;
    totalPaise: number;
    buckets: Record<string, number>;
    oldestDays: number;
    agedFromVoucherDate: boolean;
  }[];
  totals: Record<string, number>;
  totalPaise: number;
};

type Cockpit = {
  ok: boolean;
  error?: string;
  asOf: string;
  cashPaise: number;
  bankPaise: number;
  chequesInHandPaise: number;
  payablesPaise: number;
  receivablesPaise: number;
  incomeThisYearPaise: number;
  expenditureThisYearPaise: number;
  surplusThisYearPaise: number;
  anomalies: Anomaly[];
  summary: { critical: number; warning: number; info: number; totalAmountPaise: number };
  payablesAgeing: AgeingReport;
};

type LedgerOverview = {
  ok: boolean;
  error?: string;
  trialBalance: { code: string; name: string; closingDebitPaise: number; closingCreditPaise: number }[];
  vouchers: {
    id: string;
    voucherNo: string;
    voucherType: string;
    date: string;
    narration: string;
    createdBy: string;
    sourceType: string;
  }[];
  subledgers: { kind: string; subledgerId: string; balancePaise: number }[];
  totals: { totalDebit: number; totalCredit: number; balanced: boolean };
};

const AGE_BUCKETS: { key: string; label: string }[] = [
  { key: "current", label: "Current" },
  { key: "1_30", label: "1–30d" },
  { key: "31_60", label: "31–60d" },
  { key: "61_90", label: "61–90d" },
  { key: "over_90", label: "90d+" },
];

const SEV_STYLE: Record<Anomaly["severity"], string> = {
  critical: "border-[var(--danger)]/30 bg-[var(--danger-soft)] text-[var(--danger)]",
  warning: "border-[var(--warning)]/30 bg-[var(--warning-soft)] text-[var(--warning)]",
  info: "border-[var(--info)]/30 bg-[var(--info-soft)] text-[var(--info)]",
};

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" | "bad" }) {
  return (
    <div className={CARD}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p
        className={`mt-1 text-xl font-bold tabular-nums ${
          tone === "bad"
            ? "text-[var(--danger)]"
            : tone === "warn"
              ? "text-[var(--warning)]"
              : "text-[var(--brand-deep)]"
        }`}
      >
        {value}
      </p>
      {hint ? <p className="text-[11px] text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

/* ═══ 1. The book — position, controls, projection ═════════ */

export function LedgerBookPanel({ canApprove }: { canApprove: boolean }) {
  const [cockpit, setCockpit] = useState<Cockpit | null>(null);
  const [overview, setOverview] = useState<LedgerOverview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [coverage, setCoverage] = useState<
    | {
        ok: boolean;
        rows: {
          source: string;
          deskRecords: number;
          ledgerVouchers: number;
          missingInLedger: string[];
          orphanedInLedger: string[];
        }[];
        error?: string;
      }
    | null
  >(null);
  const [projection, setProjection] = useState<
    | {
        ok: boolean;
        outcomes: {
          source: string;
          scanned: number;
          posted: number;
          alreadyPosted: number;
          reversed: number;
          skipped: number;
          refused: { sourceId: string; reason: string }[];
        }[];
      }
    | null
  >(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [c, o] = await Promise.all([
        ledgerApi<Cockpit>({ action: "cockpit", asOf: todayIso(), fyFrom: fyStart() }),
        fetch("/api/ledger", { cache: "no-store" }).then(
          (r) => r.json() as Promise<LedgerOverview>,
        ),
      ]);
      if (!c.ok) setError(c.error || "Could not read the book");
      setCockpit(c);
      setOverview(o);
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runCoverage = async () => {
    setBusy(true);
    try {
      setCoverage(await ledgerApi({ action: "reconcile" }));
    } finally {
      setBusy(false);
    }
  };

  const runProjection = async () => {
    setBusy(true);
    try {
      const res = await ledgerApi<{ outcomes: [] }>({ action: "project" });
      setProjection(res as never);
      await load();
      await runCoverage();
    } finally {
      setBusy(false);
    }
  };

  const emptyBook =
    overview !== null && overview.totals.totalDebit === 0 && overview.totals.totalCredit === 0;

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--brand-deep)]">
            <BookOpenCheck className="size-4" aria-hidden />
            The server book · {fyCode()}
          </h3>
          <p className="text-xs text-[var(--muted)]">
            Append-only ledger. Every figure below can be reproduced from the
            trial balance; nothing on this screen is a browser-local number.
          </p>
        </div>
        <button type="button" className={BTN_OUTLINE} disabled={busy} onClick={() => void load()}>
          <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} aria-hidden /> Refresh
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {cockpit?.ok ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Cash in hand" value={formatInr(cockpit.cashPaise)} />
            <Tile label="At bank" value={formatInr(cockpit.bankPaise)} />
            <Tile
              label="Cheques in hand"
              value={formatInr(cockpit.chequesInHandPaise)}
              hint="Received, not yet deposited"
            />
            <Tile
              label="Payables"
              value={formatInr(cockpit.payablesPaise)}
              tone={cockpit.payablesPaise > 0 ? "warn" : undefined}
            />
            <Tile label="Receivables" value={formatInr(cockpit.receivablesPaise)} />
            <Tile label="Income this year" value={formatInr(cockpit.incomeThisYearPaise)} />
            <Tile label="Expenditure" value={formatInr(cockpit.expenditureThisYearPaise)} />
            <Tile
              label={cockpit.surplusThisYearPaise >= 0 ? "Surplus" : "Deficit"}
              value={formatInr(Math.abs(cockpit.surplusThisYearPaise))}
              tone={cockpit.surplusThisYearPaise < 0 ? "bad" : undefined}
            />
          </div>

          {emptyBook ? (
            <p className="rounded-xl border border-[var(--info)]/30 bg-[var(--info-soft)] px-3 py-2 text-xs text-[var(--info)]">
              The book holds no postings for this year yet. That is a statement
              of fact, not a display problem — run the projection below to fill
              it from the fee, store and payroll records that exist, and check
              coverage to see what remains outside.
            </p>
          ) : null}
        </>
      ) : null}

      {/* Anomalies */}
      <section className={CARD}>
        <h4 className="text-sm font-bold text-[var(--brand-deep)]">
          Controls
          {cockpit?.ok ? (
            <span className="ml-2 text-xs font-normal text-[var(--muted)]">
              {cockpit.summary.critical} critical · {cockpit.summary.warning} warning ·{" "}
              {cockpit.summary.info} info
            </span>
          ) : null}
        </h4>
        {cockpit?.ok && cockpit.anomalies.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            All eight deterministic controls pass on what the book currently
            holds. A near-empty book passes trivially — controls mean more as
            the book fills.
          </p>
        ) : null}
        {cockpit?.ok && cockpit.anomalies.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {cockpit.anomalies.map((a) => (
              <li
                key={`${a.code}-${a.title}`}
                className={`rounded-lg border px-3 py-2 text-xs ${SEV_STYLE[a.severity]}`}
              >
                <p className="font-bold">
                  {a.title}
                  {a.amountPaise ? ` · ${formatInr(a.amountPaise)}` : ""}
                </p>
                <p className="mt-0.5">{a.detail}</p>
                {a.references.length ? (
                  <p className="mt-0.5 font-mono text-[11px]">{a.references.join(", ")}</p>
                ) : null}
                {a.suggestedAction ? <p className="mt-0.5 italic">{a.suggestedAction}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* Payables ageing */}
      {cockpit?.ok && cockpit.payablesAgeing.rows.length > 0 ? (
        <section className={CARD}>
          <h4 className="text-sm font-bold text-[var(--brand-deep)]">Payables ageing</h4>
          <p className="text-[11px] text-[var(--muted)]">
            Payments applied oldest-first; a fully paid supplier drops off.
          </p>
          <div className="mt-2 overflow-x-auto">
            <ErpTable minWidth="min-w-[42rem]">
              <ErpTableHead>
                <tr>
                  <th className="pb-2 text-left">Party</th>
                  {AGE_BUCKETS.map((b) => (
                    <th key={b.key} className="pb-2 text-right">{b.label}</th>
                  ))}
                  <th className="pb-2 text-right">Total</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {cockpit.payablesAgeing.rows.map((r) => (
                  <tr key={r.partyKey}>
                    <td className="py-1.5 font-semibold">
                      {r.partyName}
                      {r.agedFromVoucherDate ? (
                        <span className="ml-1 text-[10px] font-normal text-[var(--muted)]">
                          (from bill date)
                        </span>
                      ) : null}
                    </td>
                    {AGE_BUCKETS.map((b) => (
                      <td key={b.key} className="py-1.5 text-right tabular-nums">
                        {r.buckets[b.key] ? formatInr(r.buckets[b.key]) : "—"}
                      </td>
                    ))}
                    <td className="py-1.5 text-right font-bold tabular-nums">
                      {formatInr(r.totalPaise)}
                    </td>
                  </tr>
                ))}
              </ErpTableBody>
            </ErpTable>
          </div>
        </section>
      ) : null}

      {/* Projection & coverage */}
      <section className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-[var(--brand-deep)]">Projection &amp; coverage</h4>
            <p className="text-[11px] text-[var(--muted)]">
              The book is filled from source documents — fee receipts, store
              bills, payroll runs. Running it twice posts nothing twice.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" className={BTN_OUTLINE} disabled={busy} onClick={() => void runCoverage()}>
              Check coverage
            </button>
            {canApprove ? (
              <button type="button" className={BTN} disabled={busy} onClick={() => void runProjection()}>
                {busy ? "Working…" : "Run projection"}
              </button>
            ) : (
              <span className="self-center text-[11px] text-[var(--muted)]">
                Running the projection needs approval rights
              </span>
            )}
          </div>
        </div>

        {projection ? (
          <div className="mt-3 overflow-x-auto">
            <ErpTable minWidth="min-w-[36rem]">
              <ErpTableHead>
                <tr>
                  <th className="pb-2 text-left">Source</th>
                  <th className="pb-2 text-right">Scanned</th>
                  <th className="pb-2 text-right">Posted now</th>
                  <th className="pb-2 text-right">Already posted</th>
                  <th className="pb-2 text-right">Skipped</th>
                  <th className="pb-2 text-left">Refused</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {projection.outcomes.map((o) => (
                  <tr key={o.source}>
                    <td className="py-1.5 font-semibold">{o.source}</td>
                    <td className="py-1.5 text-right tabular-nums">{o.scanned}</td>
                    <td className="py-1.5 text-right font-bold tabular-nums">{o.posted}</td>
                    <td className="py-1.5 text-right tabular-nums">{o.alreadyPosted}</td>
                    <td className="py-1.5 text-right tabular-nums">{o.skipped}</td>
                    <td className="py-1.5 text-xs text-[var(--danger)]">
                      {o.refused.length
                        ? o.refused.map((r) => r.reason).slice(0, 3).join("; ")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </ErpTableBody>
            </ErpTable>
          </div>
        ) : null}

        {coverage ? (
          <div className="mt-3 overflow-x-auto">
            <ErpTable minWidth="min-w-[34rem]">
              <ErpTableHead>
                <tr>
                  <th className="pb-2 text-left">Source</th>
                  <th className="pb-2 text-right">Desk records</th>
                  <th className="pb-2 text-right">In the book</th>
                  <th className="pb-2 text-left">Verdict</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {coverage.rows.map((r) => {
                  const clean = r.missingInLedger.length === 0 && r.orphanedInLedger.length === 0;
                  return (
                    <tr key={r.source}>
                      <td className="py-1.5 font-semibold">{r.source}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.deskRecords}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.ledgerVouchers}</td>
                      <td
                        className={`py-1.5 text-xs font-bold ${
                          clean ? "text-[var(--success)]" : "text-[var(--danger)]"
                        }`}
                      >
                        {clean
                          ? "reconciled"
                          : `${r.missingInLedger.length} missing · ${r.orphanedInLedger.length} orphaned`}
                      </td>
                    </tr>
                  );
                })}
              </ErpTableBody>
            </ErpTable>
            {coverage.error ? (
              <p className="mt-1 text-xs text-[var(--danger)]">{coverage.error}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Recent vouchers */}
      <section className={CARD}>
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-[var(--brand-deep)]">Recent vouchers</h4>
          {overview ? (
            <span
              className={`inline-flex items-center gap-1 text-xs font-bold ${
                overview.totals.balanced ? "text-[var(--success)]" : "text-[var(--danger)]"
              }`}
            >
              <Scale className="size-3.5" aria-hidden />
              {overview.totals.balanced
                ? `Balanced · ${formatInr(overview.totals.totalDebit)} both sides`
                : "OUT OF BALANCE"}
            </span>
          ) : null}
        </div>
        {overview && overview.vouchers.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">No vouchers in the book yet.</p>
        ) : null}
        {overview && overview.vouchers.length > 0 ? (
          <div className="mt-2 overflow-x-auto">
            <ErpTable minWidth="min-w-[40rem]">
              <ErpTableHead>
                <tr>
                  <th className="pb-2 text-left">No.</th>
                  <th className="pb-2 text-left">Date</th>
                  <th className="pb-2 text-left">Type</th>
                  <th className="pb-2 text-left">Narration</th>
                  <th className="pb-2 text-left">Source</th>
                  <th className="pb-2 text-left">By</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {overview.vouchers.map((v) => (
                  <tr key={v.id}>
                    <td className="py-1.5 font-mono text-xs">{v.voucherNo}</td>
                    <td className="py-1.5">{v.date}</td>
                    <td className="py-1.5">{v.voucherType}</td>
                    <td className="py-1.5 text-xs text-[var(--muted)]">{v.narration}</td>
                    <td className="py-1.5 text-xs">{v.sourceType || "manual"}</td>
                    <td className="py-1.5 text-xs">{v.createdBy}</td>
                  </tr>
                ))}
              </ErpTableBody>
            </ErpTable>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/* ═══ 2. Reports — TB, I&E, BS, R&P, statement, CA pack ═════ */

type ReportSection = {
  title: string;
  lines: { code: string; name: string; amountPaise: number }[];
  totalPaise: number;
};

type ReportKind = "tb" | "ie" | "bs" | "rp" | "statement" | "capack";

function SectionTable({ sections, totalLabel, totalPaise }: { sections: ReportSection[]; totalLabel: string; totalPaise: number }) {
  return (
    <div className="space-y-3">
      {sections.map((s) => (
        <div key={s.title}>
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">{s.title}</p>
          <table className="w-full text-sm">
            <tbody>
              {s.lines.map((l) => (
                <tr key={l.code} className="border-b border-[var(--border)]">
                  <td className="py-1 font-mono text-xs text-[var(--muted)]">{l.code}</td>
                  <td className="py-1">{l.name}</td>
                  <td className="py-1 text-right tabular-nums">{formatInr(l.amountPaise)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={2} className="py-1 text-right text-xs font-bold">{s.title}</td>
                <td className="py-1 text-right font-bold tabular-nums">{formatInr(s.totalPaise)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
      <p className="text-right text-sm font-bold text-[var(--brand-deep)]">
        {totalLabel}: {formatInr(totalPaise)}
      </p>
    </div>
  );
}

export function LedgerReportsPanel() {
  const [kind, setKind] = useState<ReportKind>("tb");
  const [from, setFrom] = useState(fyStart());
  const [to, setTo] = useState(todayIso());
  const [code, setCode] = useState("1000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  // Which report the data in state belongs to. Rendering a balance sheet
  // template against a trial balance payload (one frame of stale state on a
  // kind switch) is a crash, not a curiosity — this gate closes it.
  const [dataKind, setDataKind] = useState<ReportKind | null>(null);
  const [accounts, setAccounts] = useState<{ code: string; name: string }[]>([]);

  useEffect(() => {
    void fetch("/api/ledger", { cache: "no-store" })
      .then((r) => r.json() as Promise<LedgerOverview>)
      .then((o) => {
        if (o.trialBalance) setAccounts(o.trialBalance.map((r) => ({ code: r.code, name: r.name })));
      })
      .catch(() => undefined);
  }, []);

  const run = useCallback(async () => {
    setBusy(true);
    setError("");
    setData(null);
    try {
      const body =
        kind === "tb"
          ? { action: "trial-balance", from, to }
          : kind === "ie"
            ? { action: "income-expenditure", from, to }
            : kind === "bs"
              ? { action: "balance-sheet", from, to }
              : kind === "rp"
                ? { action: "receipts-payments", from, to }
                : kind === "statement"
                  ? { action: "account-statement", code, from, to }
                  : { action: "ca-pack", fyCode: fyCode(), from, to };
      const res = await ledgerApi<Record<string, unknown>>(body);
      if (kind !== "capack" && !res.ok) {
        setError(res.error || "Could not build the report");
        return;
      }
      setData(res);
      setDataKind(kind);
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }, [kind, from, to, code]);

  useEffect(() => {
    void run();
    // Deliberate: re-run only on demand or when the report kind changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const report = (data?.report ?? null) as Record<string, unknown> | null;

  return (
    <div className="mt-4 space-y-4">
      <section className={CARD}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] font-bold text-[var(--muted)]">
            Report
            <select className={FIELD} value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
              <option value="tb">Trial balance</option>
              <option value="ie">Income &amp; Expenditure</option>
              <option value="bs">Balance sheet (trust form)</option>
              <option value="rp">Receipts &amp; Payments</option>
              <option value="statement">Account statement</option>
              <option value="capack">CA year-end pack</option>
            </select>
          </label>
          <label className="text-[11px] font-bold text-[var(--muted)]">
            From
            <input type="date" className={FIELD} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-[11px] font-bold text-[var(--muted)]">
            To
            <input type="date" className={FIELD} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          {kind === "statement" ? (
            <label className="text-[11px] font-bold text-[var(--muted)]">
              Account
              <select className={FIELD} value={code} onChange={(e) => setCode(e.target.value)}>
                {(accounts.length ? accounts : [{ code: "1000", name: "Cash in Hand" }]).map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="button" className={BTN} disabled={busy} onClick={() => void run()}>
            {busy ? "Building…" : "Build"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          Built from the server book alone. A figure here is a figure the trial
          balance can defend.
        </p>
      </section>

      {error ? (
        <p className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {/* Trial balance */}
      {kind === "tb" && dataKind === "tb" && report ? (
        <section className={CARD}>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-[var(--brand-deep)]">
              Trial balance · {String(report.from)} → {String(report.to)}
            </h4>
            <span
              className={`text-xs font-bold ${
                report.balanced ? "text-[var(--success)]" : "text-[var(--danger)]"
              }`}
            >
              {report.balanced ? "Balanced" : "OUT OF BALANCE"}
            </span>
          </div>
          <div className="mt-2 overflow-x-auto">
            <ErpTable minWidth="min-w-[44rem]">
              <ErpTableHead>
                <tr>
                  <th className="pb-2 text-left">Code</th>
                  <th className="pb-2 text-left">Account</th>
                  <th className="pb-2 text-right">Opening</th>
                  <th className="pb-2 text-right">Debit</th>
                  <th className="pb-2 text-right">Credit</th>
                  <th className="pb-2 text-right">Closing Dr</th>
                  <th className="pb-2 text-right">Closing Cr</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {(report.rows as Record<string, number | string>[]).map((r) => (
                  <tr key={String(r.code)}>
                    <td className="py-1 font-mono text-xs">{r.code}</td>
                    <td className="py-1">{r.name}</td>
                    <td className="py-1 text-right tabular-nums">{formatInr(Number(r.openingPaise))}</td>
                    <td className="py-1 text-right tabular-nums">{formatInr(Number(r.debitPaise))}</td>
                    <td className="py-1 text-right tabular-nums">{formatInr(Number(r.creditPaise))}</td>
                    <td className="py-1 text-right tabular-nums">{formatInr(Number(r.closingDebitPaise))}</td>
                    <td className="py-1 text-right tabular-nums">{formatInr(Number(r.closingCreditPaise))}</td>
                  </tr>
                ))}
                {(() => {
                  const t = report.totals as Record<string, number>;
                  return (
                    <tr className="font-bold">
                      <td colSpan={3} className="py-1.5 text-right">Totals</td>
                      <td className="py-1.5 text-right tabular-nums">{formatInr(t.debitPaise)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatInr(t.creditPaise)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatInr(t.closingDebitPaise)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatInr(t.closingCreditPaise)}</td>
                    </tr>
                  );
                })()}
              </ErpTableBody>
            </ErpTable>
          </div>
          {(report.rows as unknown[]).length === 0 ? (
            <p className="mt-2 text-sm text-[var(--muted)]">
              No account moved in this period — the book is empty here, and
              this report says so rather than inventing detail.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Income & Expenditure */}
      {kind === "ie" && dataKind === "ie" && report ? (
        <section className={CARD}>
          <h4 className="text-sm font-bold text-[var(--brand-deep)]">
            Income &amp; Expenditure · {String(report.from)} → {String(report.to)}
          </h4>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <SectionTable
              sections={report.income as ReportSection[]}
              totalLabel="Total income"
              totalPaise={Number(report.totalIncomePaise)}
            />
            <SectionTable
              sections={report.expenditure as ReportSection[]}
              totalLabel="Total expenditure"
              totalPaise={Number(report.totalExpenditurePaise)}
            />
          </div>
          <p
            className={`mt-3 text-right text-base font-bold ${
              Number(report.surplusPaise) >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"
            }`}
          >
            {Number(report.surplusPaise) >= 0 ? "Surplus" : "Deficit"}:{" "}
            {formatInr(Math.abs(Number(report.surplusPaise)))}
          </p>
        </section>
      ) : null}

      {/* Balance sheet */}
      {kind === "bs" && dataKind === "bs" && report ? (
        <section className={CARD}>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-[var(--brand-deep)]">
              Balance sheet as at {String(report.asOf)}
            </h4>
            <span
              className={`text-xs font-bold ${
                report.balanced ? "text-[var(--success)]" : "text-[var(--danger)]"
              }`}
            >
              {report.balanced
                ? "Balanced"
                : `Off by ${formatInr(Number(report.differencePaise))}`}
            </span>
          </div>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <SectionTable
              sections={report.liabilities as ReportSection[]}
              totalLabel="Corpus & liabilities"
              totalPaise={Number(report.totalLiabilitiesPaise)}
            />
            <SectionTable
              sections={report.assets as ReportSection[]}
              totalLabel="Assets"
              totalPaise={Number(report.totalAssetsPaise)}
            />
          </div>
        </section>
      ) : null}

      {/* Receipts & payments */}
      {kind === "rp" && dataKind === "rp" && report ? (
        <section className={CARD}>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-[var(--brand-deep)]">
              Receipts &amp; Payments · {String(report.from)} → {String(report.to)}
            </h4>
            <span
              className={`text-xs font-bold ${
                report.reconciles ? "text-[var(--success)]" : "text-[var(--danger)]"
              }`}
            >
              {report.reconciles ? "Ties to cash" : "Does NOT tie to cash"}
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Opening cash {formatInr(Number(report.openingCashPaise))} → closing{" "}
            {formatInr(Number(report.closingCashPaise))} · true cash basis, contras excluded
          </p>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <SectionTable
              sections={report.receipts as ReportSection[]}
              totalLabel="Total receipts"
              totalPaise={Number(report.totalReceiptsPaise)}
            />
            <SectionTable
              sections={report.payments as ReportSection[]}
              totalLabel="Total payments"
              totalPaise={Number(report.totalPaymentsPaise)}
            />
          </div>
        </section>
      ) : null}

      {/* Account statement */}
      {kind === "statement" && dataKind === "statement" && data?.rows ? (
        <section className={CARD}>
          <h4 className="text-sm font-bold text-[var(--brand-deep)]">
            Statement · account {code} · {from} → {to}
          </h4>
          <div className="mt-2 overflow-x-auto">
            <ErpTable minWidth="min-w-[44rem]">
              <ErpTableHead>
                <tr>
                  <th className="pb-2 text-left">Date</th>
                  <th className="pb-2 text-left">Voucher</th>
                  <th className="pb-2 text-left">Narration</th>
                  <th className="pb-2 text-left">Party</th>
                  <th className="pb-2 text-right">Debit</th>
                  <th className="pb-2 text-right">Credit</th>
                  <th className="pb-2 text-right">Running</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {(data.rows as Record<string, unknown>[]).map((r, i) => (
                  <tr key={i}>
                    <td className="py-1">{String(r.date)}</td>
                    <td className="py-1 font-mono text-xs">{String(r.voucherNo)}</td>
                    <td className="py-1 text-xs text-[var(--muted)]">{String(r.narration)}</td>
                    <td className="py-1 text-xs">{String(r.partyName) || "—"}</td>
                    <td className="py-1 text-right tabular-nums">
                      {Number(r.debitPaise) ? formatInr(Number(r.debitPaise)) : "—"}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {Number(r.creditPaise) ? formatInr(Number(r.creditPaise)) : "—"}
                    </td>
                    <td className="py-1 text-right font-semibold tabular-nums">
                      {formatInr(Number(r.runningPaise))}
                    </td>
                  </tr>
                ))}
              </ErpTableBody>
            </ErpTable>
          </div>
          {(data.rows as unknown[]).length === 0 ? (
            <p className="mt-2 text-sm text-[var(--muted)]">No movement on this account in the period.</p>
          ) : null}
        </section>
      ) : null}

      {/* CA pack */}
      {kind === "capack" && dataKind === "capack" && data ? (
        <section className={CARD}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-bold text-[var(--brand-deep)]">
              CA year-end pack · {String(data.fyCode)}
            </h4>
            <span
              className={`text-xs font-bold ${
                data.ok ? "text-[var(--success)]" : "text-[var(--warning)]"
              }`}
            >
              {data.ok ? "Ready to hand over" : "Not yet fit to hand over"}
            </span>
          </div>
          <ul className="mt-2 space-y-1">
            {(data.readiness as { check: string; ok: boolean; detail: string }[]).map((c) => (
              <li key={c.check} className="flex items-start gap-2 text-xs">
                <span className={c.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                  {c.ok ? "✓" : "✗"}
                </span>
                <span>
                  <strong>{c.check}</strong> — {c.detail}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <button
              type="button"
              className={BTN_OUTLINE}
              onClick={async () => {
                const res = await ledgerApi<{ csv?: Record<string, string> }>({
                  action: "ca-pack",
                  fyCode: fyCode(),
                  from,
                  to,
                  csv: true,
                });
                for (const [name, content] of Object.entries(res.csv ?? {})) {
                  downloadText(name, content);
                }
              }}
            >
              <Download className="size-3.5" aria-hidden /> Download CSV bundle
            </button>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Schedules only, by design — the Form 10B clause annexures turn on
              registration facts that live in the trust deed, and belong to the
              CA.
            </p>
          </div>
          {(data.schedules as { title: string; totalPaise: number }[]).length > 0 ? (
            <div className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
              {(data.schedules as { title: string; totalPaise: number }[]).map((s) => (
                <p key={s.title} className="flex justify-between border-b border-[var(--border)] py-1">
                  <span>{s.title}</span>
                  <span className="font-semibold tabular-nums">{formatInr(s.totalPaise)}</span>
                </p>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/* ═══ 3. Bank reconciliation ═══════════════════════════════ */

export function BankReconPanel({
  banks,
}: {
  banks: { id: string; name: string }[];
}) {
  const [bankId, setBankId] = useState(banks[0]?.id ?? "");
  const [asOf, setAsOf] = useState(todayIso());
  const [csv, setCsv] = useState("");
  const [statementRef, setStatementRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [matches, setMatches] = useState<Record<string, unknown> | null>(null);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      return await ledgerApi<Record<string, unknown>>(body);
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!bankId) return setNotice("Pick the bank account first");
    if (!csv.trim()) return setNotice("Paste the statement CSV first");
    const res = await act({
      action: "import-statement",
      bankSubledgerId: bankId,
      statementRef,
      csv,
    });
    if (!res?.ok) return setNotice(res?.error || "Import failed");
    setNotice(
      `Imported ${res.inserted} line(s) · ${res.duplicates} already known · ${res.parsed} parsed`,
    );
    setCsv("");
  };

  const runAutoMatch = async () => {
    if (!bankId) return setNotice("Pick the bank account first");
    const res = await act({ action: "auto-match", bankSubledgerId: bankId, asOf });
    if (!res?.ok) return setNotice(res?.error || "Matching failed");
    setMatches(res);
    setNotice(
      `${res.applied} matched automatically · ${(res.proposed as unknown[]).length} proposals need a person · ${res.unmatchedStatement} statement / ${res.unmatchedBook} book lines open`,
    );
  };

  const runReport = async () => {
    if (!bankId) return setNotice("Pick the bank account first");
    const res = await act({ action: "bank-recon", bankSubledgerId: bankId, asOf });
    if (!res?.ok) return setNotice(res?.error || "Could not build the reconciliation");
    setReport(res);
  };

  const summary = report?.summary as
    | {
        bookBalancePaise: number;
        statementClosingPaise: number | null;
        unpresentedPaise: number;
        unrecordedPaise: number;
        reconciledPaise: number;
        reconciles: boolean;
      }
    | undefined;

  return (
    <div className="mt-4 space-y-4">
      <section className={CARD}>
        <h4 className="text-sm font-bold text-[var(--brand-deep)]">Bank reconciliation</h4>
        <p className="text-[11px] text-[var(--muted)]">
          Import the bank&rsquo;s CSV, let the matcher pair what it can prove,
          decide the rest yourself. Reconciling posts nothing — it explains.
        </p>
        {banks.length === 0 ? (
          <p className="mt-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]">
            No bank accounts are on file in Accounts → Masters yet, so there is
            nothing to reconcile against. Add the bank there first.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-[11px] font-bold text-[var(--muted)]">
              Bank account
              <select className={FIELD} value={bankId} onChange={(e) => setBankId(e.target.value)}>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-bold text-[var(--muted)]">
              As of
              <input type="date" className={FIELD} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </label>
            <button type="button" className={BTN_OUTLINE} disabled={busy} onClick={() => void runAutoMatch()}>
              Auto-match
            </button>
            <button type="button" className={BTN} disabled={busy} onClick={() => void runReport()}>
              Reconciliation report
            </button>
          </div>
        )}
        {notice ? (
          <p className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--accent)] px-3 py-1.5 text-xs text-[var(--brand-deep)]">
            {notice}
          </p>
        ) : null}
      </section>

      {banks.length > 0 ? (
        <section className={CARD}>
          <h4 className="text-sm font-bold text-[var(--brand-deep)]">Import statement</h4>
          <div className="mt-2 space-y-2">
            <label className="block text-[11px] font-bold text-[var(--muted)]">
              Statement reference (e.g. &ldquo;Aug 2026&rdquo;)
              <input
                className={FIELD}
                value={statementRef}
                onChange={(e) => setStatementRef(e.target.value)}
              />
            </label>
            <label className="block text-[11px] font-bold text-[var(--muted)]">
              Paste the bank&rsquo;s CSV export
              <textarea
                className={`${FIELD} h-28 font-mono text-xs`}
                placeholder="Date,Narration,Ref,Debit,Credit,Balance"
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
              />
            </label>
            <button type="button" className={BTN} disabled={busy} onClick={() => void runImport()}>
              Import lines
            </button>
            <p className="text-[11px] text-[var(--muted)]">
              Lines are content-hashed — importing the same statement twice
              inserts nothing twice.
            </p>
          </div>
        </section>
      ) : null}

      {matches && (matches.proposed as unknown[])?.length > 0 ? (
        <section className={CARD}>
          <h4 className="text-sm font-bold text-[var(--brand-deep)]">
            Proposed matches — a person decides
          </h4>
          <ul className="mt-2 space-y-2">
            {(matches.proposed as Record<string, unknown>[]).map((m) => (
              <li
                key={String(m.statementLineId)}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-xs"
              >
                <span>
                  <strong>{String(m.statementNarration)}</strong> ↔ {String(m.bookNarration)}
                  <span className="ml-1 text-[var(--muted)]">({String(m.reason)})</span>
                </span>
                <button
                  type="button"
                  className={BTN_OUTLINE}
                  disabled={busy}
                  onClick={async () => {
                    const res = await act({
                      action: "match",
                      statementLineId: m.statementLineId,
                      ledgerLineId: m.ledgerLineId,
                      note: m.reason,
                    });
                    setNotice(res?.ok ? "Matched" : res?.error || "Match failed");
                    await runAutoMatch();
                  }}
                >
                  Accept
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {summary ? (
        <section className={CARD}>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-[var(--brand-deep)]">
              The reconciliation, as arithmetic
            </h4>
            <span
              className={`text-xs font-bold ${
                summary.reconciles ? "text-[var(--success)]" : "text-[var(--danger)]"
              }`}
            >
              {summary.reconciles ? "Reconciles" : "Does not reconcile"}
            </span>
          </div>
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Book balance" value={formatInr(summary.bookBalancePaise)} />
            <Tile
              label="− Unpresented"
              value={formatInr(summary.unpresentedPaise)}
              hint="In the book, bank hasn't seen it"
            />
            <Tile
              label="+ Unrecorded"
              value={formatInr(summary.unrecordedPaise)}
              hint="On the statement, book hasn't"
            />
            <Tile
              label="= Should equal bank"
              value={formatInr(summary.reconciledPaise)}
              hint={
                summary.statementClosingPaise === null
                  ? "Statement closing balance unknown"
                  : `Bank says ${formatInr(summary.statementClosingPaise)}`
              }
              tone={summary.reconciles ? undefined : "bad"}
            />
          </div>
          {(["unpresented", "unrecorded"] as const).map((side) => {
            const rows = (report?.[side] ?? []) as Record<string, unknown>[];
            if (!rows.length) return null;
            return (
              <div key={side} className="mt-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                  {side === "unpresented" ? "In the book, not on the statement" : "On the statement, not in the book"}
                </p>
                <ul className="mt-1 space-y-1">
                  {rows.map((r) => (
                    <li key={String(r.id)} className="flex flex-wrap justify-between gap-2 border-b border-[var(--border)] py-1 text-xs">
                      <span>
                        {String(r.date)} · {String(r.narration)}
                        {r.suggestion ? (
                          <em className="ml-1 text-[var(--muted)]">— {String(r.suggestion)}</em>
                        ) : null}
                      </span>
                      <span className="font-semibold tabular-nums">{formatInr(Number(r.amountPaise))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ) : null}

      <p className="flex items-start gap-1.5 text-[11px] text-[var(--muted)]">
        <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
        The matcher auto-applies only exact and strong matches (amount and
        direction always exact). Weak matches are proposals — accepting one is
        your decision, recorded under your name.
      </p>
    </div>
  );
}
