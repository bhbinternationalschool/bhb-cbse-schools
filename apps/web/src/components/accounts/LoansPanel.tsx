"use client";

/**
 * Accounts → Loans, and Transport → Finance → Vehicle loans (same panel,
 * same server code: /api/accounts/loans, lib/loans.server.ts).
 *
 *   - EMIs awaiting approval: each month whose due date has come and has no
 *     EMI in the books. The approver may correct date, amount, the
 *     principal/interest split (must add up), paid-from, mode and reference,
 *     then approves — only then is the voucher posted. Or skips it, with a
 *     reason.
 *   - Prepayments and top-ups: asked for here (Accounts · edit), posted on
 *     approval (Accounts · approve).
 *   - Every loan: balance from the books, terms, history with running
 *     balance, projection to the end (labelled), export by loan and months.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { VoucherDetailDialog } from "@/components/accounts/VoucherDetailDialog";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { RowActionMenu } from "@/components/ui/erp-grid";
import {
  PAY_MODES,
  PAY_MODE_LABELS,
  TRUSTEE_ASHISH,
  TRUSTEE_LOAN_CODE,
  VEHICLE_SUSPENSE_CODE,
  addMonths,
  istToday,
  loanExportRows,
  loanTotals,
  monthLabel,
  monthOf,
  paidFromLabel,
  rupees,
  type EmiProposal,
  type LoanComputed,
  type LoanParty,
  type LoanRequest,
  type LoanTerms,
  type PayMode,
} from "@/lib/loans";

type LoanView = {
  code: string;
  name: string;
  terms: LoanTerms | null;
  termsSource: "saved" | "default" | "none";
  vehicleLabel: string;
  computed: LoanComputed;
};
type Acct = { code: string; name: string };
type VehicleRef = { id: string; label: string; isActive: boolean };

type Loaded =
  | { kind: "loading" }
  | { kind: "error"; message: string; forbidden: boolean }
  | {
      kind: "ok";
      today: string;
      loans: LoanView[];
      vehicles: VehicleRef[];
      moneyAccounts: Acct[];
      assetAccounts: Acct[];
      requests: LoanRequest[];
      canEdit: boolean;
      canApprove: boolean;
    };

const inr = (p: number) => `₹${rupees(p)}`;
function fmtDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
/** "58,908.50" → 5890850; "" or junk → NaN. */
function toPaise(s: string): number {
  const t = s.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}
const asRupees = (p: number) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));

const btn = "rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50";
const btnPrimary = "rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-bold text-[var(--primary-foreground)] disabled:opacity-50";
const lbl = "text-[11px] font-semibold text-[var(--muted)]";
const card = "rounded-xl border border-[var(--border)] bg-[var(--card)] p-3";

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; voucherNo?: string; replay?: boolean; code?: string }> {
  try {
    const res = await fetch("/api/accounts/loans", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; voucherNo?: string; replay?: boolean; code?: string };
    if (!res.ok || !j.ok) return { ok: false, error: j.error || `Not done (${res.status})` };
    return { ok: true, voucherNo: j.voucherNo, replay: j.replay, code: j.code };
  } catch {
    return { ok: false, error: "Could not reach the server — nothing was done." };
  }
}

export function LoansPanel({ scope = "accounts" }: { scope?: "accounts" | "transport" }) {
  const [state, setState] = useState<Loaded>({ kind: "loading" });
  const [openVoucher, setOpenVoucher] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [approving, setApproving] = useState<{ loan: LoanView; p: EmiProposal } | null>(null);
  const [editingTerms, setEditingTerms] = useState<LoanView | null>(null);
  const [requesting, setRequesting] = useState<{ loan: LoanView; kind: "prepayment" | "topup" } | null>(null);
  const [addingLoan, setAddingLoan] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts/loans", { credentials: "same-origin", cache: "no-store" });
      const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !b.ok) {
        setState({ kind: "error", message: String(b.error || `Could not load the loans (${res.status})`), forbidden: res.status === 401 || res.status === 403 });
        return;
      }
      setState({
        kind: "ok",
        today: String(b.today ?? istToday()),
        loans: (b.loans as LoanView[]) ?? [],
        vehicles: (b.vehicles as VehicleRef[]) ?? [],
        moneyAccounts: (b.moneyAccounts as Acct[]) ?? [],
        assetAccounts: (b.assetAccounts as Acct[]) ?? [],
        requests: (b.requests as LoanRequest[]) ?? [],
        canEdit: !!b.canEdit,
        canApprove: !!b.canApprove,
      });
    } catch {
      setState({ kind: "error", message: "Could not reach the server — the loans are not shown, not missing.", forbidden: false });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const done = (msg: string) => {
    setNotice(msg);
    void load();
  };

  if (state.kind === "loading") return <p className="text-sm text-[var(--muted)]">Reading the loan accounts…</p>;
  if (state.kind === "error") {
    return (
      <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-sm">
        {state.forbidden
          ? "Loan balances are Accounts figures: seeing them needs Accounts · view and Accounts position · view (Masters → Roles)."
          : state.message}
      </p>
    );
  }

  const s = state;
  const acctName = (code: string) => [...s.moneyAccounts, ...s.assetAccounts].find((a) => a.code === code)?.name ?? code;
  const pending = s.loans.flatMap((l) => l.computed.pending.map((p) => ({ loan: l, p })));
  const openRequests = s.requests.filter((r) => r.status === "pending");
  const totalOut = s.loans.reduce((n, l) => n + Math.max(0, l.computed.outstandingPaise), 0);
  const shownDetail = detail ? s.loans.find((l) => l.code === detail) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">{scope === "transport" ? "Vehicle loans — from the books" : "Loans"}</h2>
          <p className="text-[11px] text-[var(--muted)]">
            Balances from the books. Each month&apos;s EMI is proposed on its due date and posted only when someone with Accounts · approve approves it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.canApprove ? (
            <button type="button" className={btn} onClick={() => setAddingLoan(true)}>
              Add a new loan
            </button>
          ) : null}
          <button type="button" className={btn} onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>
      {notice ? (
        <p className="rounded-lg bg-[var(--success-soft)] px-3 py-2 text-xs font-semibold text-[var(--success)]" role="status">
          {notice}
        </p>
      ) : null}

      {/* ── Awaiting approval ── */}
      <section className={card}>
        <h3 className="text-xs font-bold text-[var(--brand-deep)]">Awaiting approval</h3>
        {pending.length === 0 && openRequests.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--muted)]">Nothing waiting — every EMI due so far is in the books or skipped.</p>
        ) : (
          <ErpTableShell density="compact" className="mt-2">
            <div className="overflow-x-auto">
            <ErpTable minWidth="min-w-[760px]" className="text-xs">
              <ErpTableHead>
                <tr>
                  <th className="px-2 py-1">Loan</th>
                  <th className="px-2 py-1">What</th>
                  <th className="px-2 py-1">Due / date</th>
                  <th className="px-2 py-1 text-right">Amount</th>
                  <th className="px-2 py-1 text-right">Principal</th>
                  <th className="px-2 py-1 text-right">Interest</th>
                  <th className="px-2 py-1">Paid from</th>
                  <th className="px-2 py-1" />
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {pending.map(({ loan, p }) => (
                  <tr key={p.key} className="border-t border-[var(--border)] align-top">
                    <td className="px-2 py-1.5">
                      <div className="font-semibold">{loan.vehicleLabel || loan.name}</div>
                      <div className="text-[10px] text-[var(--muted)]">
                        {loan.code} · {loan.terms?.contractNo}
                        {loan.termsSource === "default" ? " · terms not yet confirmed" : ""}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      {p.emiNo ? `EMI ${p.emiNo}` : "EMI"} · {monthLabel(p.month)}
                      {p.isFinal ? <div className="text-[10px] font-bold text-[var(--warning,#b45309)]">Last instalment</div> : null}
                    </td>
                    <td className="px-2 py-1.5">{fmtDate(p.dueOn)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{inr(p.amountPaise)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{inr(p.principalPaise)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums" title={`${inr(p.openingPaise)} × ${loan.terms?.annualRatePct}% × ${p.days} days ÷ 365`}>
                      {inr(p.interestPaise)}
                    </td>
                    <td className="px-2 py-1.5">{paidFromLabel(p.paidFrom, acctName(p.paidFrom.accountCode))}</td>
                    <td className="px-2 py-1.5 text-right">
                      {s.canApprove ? (
                        <button type="button" className={btnPrimary} onClick={() => setApproving({ loan, p })}>
                          Review &amp; approve
                        </button>
                      ) : (
                        <span className="text-[10px] text-[var(--muted)]">Needs Accounts · approve</span>
                      )}
                    </td>
                  </tr>
                ))}
                {openRequests.map((r) => (
                  <RequestRow key={r.id} r={r} loan={s.loans.find((l) => l.code === r.code)} acctName={acctName} canApprove={s.canApprove} onDone={done} />
                ))}
              </ErpTableBody>
            </ErpTable>
          </div>
          </ErpTableShell>
        )}
      </section>

      {approving ? (
        <EmiApprovalForm
          loan={approving.loan}
          p={approving.p}
          today={s.today}
          moneyAccounts={s.moneyAccounts}
          onClose={() => setApproving(null)}
          onDone={(msg) => {
            setApproving(null);
            done(msg);
          }}
        />
      ) : null}

      {/* ── Every loan ── */}
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold text-[var(--brand-deep)]">
            {s.loans.length} loan{s.loans.length === 1 ? "" : "s"} · owed {inr(totalOut)}
          </h3>
        </div>
        {s.loans.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--muted)]">No loan account in the books. A vehicle loan is a liability account named &quot;Vehicle Loan — …&quot;.</p>
        ) : (
          <ErpTableShell density="compact" className="mt-2">
            <div className="overflow-x-auto">
            <ErpTable minWidth="min-w-[1080px]" className="text-xs">
              <ErpTableHead>
                <tr>
                  <th className="px-2 py-1">Loan</th>
                  <th className="px-2 py-1">Vehicle</th>
                  <th className="px-2 py-1">Lender · contract</th>
                  <th className="px-2 py-1 text-right">Original</th>
                  <th className="px-2 py-1 text-right">Outstanding</th>
                  <th className="px-2 py-1 text-right">EMI</th>
                  <th className="px-2 py-1 text-right">Rate</th>
                  <th className="px-2 py-1">Next due</th>
                  <th className="px-2 py-1">Awaiting approval</th>
                  <th className="px-2 py-1">Last paid</th>
                  <th className="px-2 py-1" />
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {s.loans.map((l) => {
                  const c = l.computed;
                  return (
                    <tr key={l.code} className="border-t border-[var(--border)] align-top">
                      <td className="px-2 py-1.5">
                        <button type="button" className="text-left font-semibold text-[var(--brand-mid)] hover:underline" onClick={() => setDetail(l.code)}>
                          {l.code}
                        </button>
                        <div className="max-w-[220px] text-[10px] text-[var(--muted)]">{l.name}</div>
                        {l.termsSource !== "saved" ? (
                          <div className="text-[10px] font-bold text-[var(--danger)]">{l.termsSource === "default" ? "Terms: defaults — confirm" : "No terms"}</div>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5">{l.vehicleLabel || <span className="text-[var(--muted)]">—</span>}</td>
                      <td className="px-2 py-1.5">
                        {l.terms?.lender || "—"}
                        <div className="text-[10px] text-[var(--muted)]">{l.terms?.contractNo}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{c.originalPaise ? inr(c.originalPaise) : "—"}</td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{c.outstandingPaise <= 0 ? "Repaid" : inr(c.outstandingPaise)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{l.terms ? inr(l.terms.emiPaise) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{l.terms ? `${l.terms.annualRatePct.toFixed(4)}%` : "—"}</td>
                      <td className="px-2 py-1.5">{fmtDate(c.nextDueOn)}</td>
                      <td className="px-2 py-1.5">
                        {c.pending.length ? (
                          <span className="rounded-md bg-[var(--danger-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--danger)]">
                            {c.pending.map((p) => monthLabel(p.month)).join(", ")}
                          </span>
                        ) : (
                          <span className="text-[var(--muted)]">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {c.lastPaid ? (
                          <>
                            <button type="button" className="font-semibold text-[var(--brand-mid)] hover:underline" onClick={() => setOpenVoucher(c.lastPaid!.voucherNo)}>
                              {c.lastPaid.voucherNo}
                            </button>
                            <div className="text-[10px] text-[var(--muted)]">
                              {fmtDate(c.lastPaid.date)} · {inr(c.lastPaid.amountPaise)}
                            </div>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <RowActionMenu
                          row={l}
                          actions={[
                            { id: "detail", label: "History & schedule", onSelect: (r) => setDetail(r.code) },
                            { id: "terms", label: "Terms", hidden: () => !s.canEdit, onSelect: (r) => setEditingTerms(r) },
                            { id: "prepay", label: "Top-up payment / additional loan", hidden: () => !s.canEdit, onSelect: (r) => setRequesting({ loan: r, kind: "prepayment" }) },
                            { id: "voucher", label: "Open last voucher", hidden: (r) => !r.computed.lastPaid, onSelect: (r) => setOpenVoucher(r.computed.lastPaid!.voucherNo) },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </ErpTableBody>
            </ErpTable>
          </div>
          </ErpTableShell>
        )}
      </section>

      {editingTerms ? (
        <TermsEditor
          loan={editingTerms}
          vehicles={s.vehicles}
          moneyAccounts={s.moneyAccounts}
          onClose={() => setEditingTerms(null)}
          onDone={(m) => {
            setEditingTerms(null);
            done(m);
          }}
        />
      ) : null}
      {requesting ? (
        <RequestForm
          loan={requesting.loan}
          initialKind={requesting.kind}
          today={s.today}
          moneyAccounts={s.moneyAccounts}
          assetAccounts={s.assetAccounts}
          onClose={() => setRequesting(null)}
          onDone={(m) => {
            setRequesting(null);
            done(m);
          }}
        />
      ) : null}
      {addingLoan ? (
        <AddLoanForm
          vehicles={s.vehicles}
          moneyAccounts={s.moneyAccounts}
          assetAccounts={s.assetAccounts}
          today={s.today}
          onClose={() => setAddingLoan(false)}
          onDone={(m) => {
            setAddingLoan(false);
            done(m);
          }}
        />
      ) : null}

      {shownDetail ? (
        <LoanDetail loan={shownDetail} canApprove={s.canApprove} onOpenVoucher={setOpenVoucher} onClose={() => setDetail(null)} onDone={done} />
      ) : null}

      {s.loans.length ? <ExportPanel loans={s.loans} today={s.today} /> : null}

      {openVoucher ? <VoucherDetailDialog target={{ voucherNo: openVoucher }} onClose={() => setOpenVoucher(null)} /> : null}
    </div>
  );
}

/* ─── Paid-from picker ────────────────────────────────────── */

function PaidFromFields({
  accountCode,
  mode,
  party,
  moneyAccounts,
  onChange,
  refValue,
  onRef,
}: {
  accountCode: string;
  mode: PayMode;
  party: LoanParty | null;
  moneyAccounts: Acct[];
  onChange: (v: { accountCode: string; mode: PayMode; party: LoanParty | null }) => void;
  refValue?: string;
  onRef?: (v: string) => void;
}) {
  return (
    <>
      <label className={lbl}>
        Mode
        <select
          className="field mt-1 !py-1.5"
          value={mode}
          onChange={(e) => {
            const m = e.target.value as PayMode;
            if (m === "trustee_personal") onChange({ accountCode: TRUSTEE_LOAN_CODE, mode: m, party: party ?? TRUSTEE_ASHISH });
            else if (m === "cash") onChange({ accountCode: "1000", mode: m, party: null });
            else onChange({ accountCode: accountCode === TRUSTEE_LOAN_CODE || accountCode === "1000" ? "" : accountCode, mode: m, party: null });
          }}
        >
          {PAY_MODES.map((m) => (
            <option key={m} value={m}>
              {PAY_MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      <label className={lbl}>
        Paid from (account)
        <select
          className="field mt-1 !py-1.5"
          value={accountCode}
          onChange={(e) => {
            const c = e.target.value;
            if (c === TRUSTEE_LOAN_CODE) onChange({ accountCode: c, mode: "trustee_personal", party: party ?? TRUSTEE_ASHISH });
            else if (c === "1000") onChange({ accountCode: c, mode: "cash", party: null });
            else onChange({ accountCode: c, mode: mode === "trustee_personal" || mode === "cash" ? "bank_transfer" : mode, party: null });
          }}
        >
          <option value="">Choose…</option>
          {moneyAccounts.map((a) => (
            <option key={a.code} value={a.code}>
              {a.code} · {a.name}
            </option>
          ))}
        </select>
      </label>
      {accountCode === TRUSTEE_LOAN_CODE ? (
        <label className={lbl}>
          Trustee
          <input
            className="field mt-1 !py-1.5"
            value={party?.name ?? ""}
            onChange={(e) => onChange({ accountCode, mode, party: { kind: "vendor", externalId: e.target.value.trim().toLowerCase(), name: e.target.value } })}
          />
        </label>
      ) : onRef ? (
        <label className={lbl}>
          {mode === "cheque" ? "Cheque no." : mode === "nach" ? "NACH / ACH ref" : mode === "upi" ? "UTR" : "Reference"}
          <input className="field mt-1 !py-1.5" value={refValue ?? ""} onChange={(e) => onRef(e.target.value)} />
        </label>
      ) : null}
      {accountCode === TRUSTEE_LOAN_CODE ? (
        <p className="text-[11px] font-semibold text-[var(--brand-deep)] sm:col-span-3">Paid by trustee {party?.name || "…"} — added to his loan to the trust (Cr 2100).</p>
      ) : null}
    </>
  );
}

/* ─── Approve one EMI ─────────────────────────────────────── */

function EmiApprovalForm({
  loan,
  p,
  today,
  moneyAccounts,
  onClose,
  onDone,
}: {
  loan: LoanView;
  p: EmiProposal;
  today: string;
  moneyAccounts: Acct[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [date, setDate] = useState(p.dueOn <= today ? p.dueOn : today);
  const [amount, setAmount] = useState(asRupees(p.amountPaise));
  const [interest, setInterest] = useState(asRupees(p.interestPaise));
  const [principal, setPrincipal] = useState(asRupees(p.principalPaise));
  const [pf, setPf] = useState({ accountCode: p.paidFrom.accountCode, mode: p.paidFrom.mode, party: p.paidFrom.party });
  const [ref, setRef] = useState("");
  const [skipReason, setSkipReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const a = toPaise(amount);
  const i = toPaise(interest);
  const pr = toPaise(principal);
  const balanced = Number.isFinite(a) && Number.isFinite(i) && Number.isFinite(pr) && a === i + pr;

  async function approve() {
    setBusy(true);
    setErr("");
    const r = await post({
      action: "approve-emi",
      code: loan.code,
      month: p.month,
      date,
      amountPaise: a,
      principalPaise: pr,
      interestPaise: i,
      accountCode: pf.accountCode,
      mode: pf.mode,
      ref,
      party: pf.party,
    });
    setBusy(false);
    if (!r.ok) setErr(r.error || "Not approved");
    else onDone(`${monthLabel(p.month)} EMI on ${loan.code} ${r.replay ? "was already" : "is now"} in the books as ${r.voucherNo}.`);
  }
  async function skip() {
    setBusy(true);
    setErr("");
    const r = await post({ action: "skip-emi", code: loan.code, month: p.month, reason: skipReason });
    setBusy(false);
    if (!r.ok) setErr(r.error || "Not skipped");
    else onDone(`${monthLabel(p.month)} EMI on ${loan.code} skipped.`);
  }

  return (
    <section className={card} aria-label="Approve EMI">
      <div className="text-sm font-bold text-[var(--brand-deep)]">
        Approve {p.emiNo ? `EMI ${p.emiNo}` : "EMI"} · {monthLabel(p.month)} · {loan.vehicleLabel || loan.name}
      </div>
      <p className="text-[11px] text-[var(--muted)]">
        Proposed: interest {inr(p.interestPaise)} = {inr(p.openingPaise)} × {loan.terms?.annualRatePct}% × {p.days} days ({fmtDate(p.interestFrom)} → {fmtDate(p.dueOn)}) ÷ 365. Correct anything that differs from the lender&apos;s statement.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className={lbl}>
          Date paid
          <input type="date" className="field mt-1 !py-1.5" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className={lbl}>
          Amount paid (₹)
          <input
            className="field mt-1 !py-1.5"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              const na = toPaise(e.target.value);
              if (Number.isFinite(na) && Number.isFinite(i) && na >= i) setPrincipal(asRupees(na - i));
            }}
          />
        </label>
        <div />
        <label className={lbl}>
          Interest (₹)
          <input
            className="field mt-1 !py-1.5"
            inputMode="decimal"
            value={interest}
            onChange={(e) => {
              setInterest(e.target.value);
              const ni = toPaise(e.target.value);
              if (Number.isFinite(ni) && Number.isFinite(a) && a >= ni) setPrincipal(asRupees(a - ni));
            }}
          />
        </label>
        <label className={lbl}>
          Principal (₹)
          <input className="field mt-1 !py-1.5" inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
        </label>
        <div className={`self-end text-[11px] font-semibold ${balanced ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
          {balanced ? "Principal + interest = amount" : "Principal + interest must equal the amount paid"}
        </div>
        <PaidFromFields
          accountCode={pf.accountCode}
          mode={pf.mode}
          party={pf.party}
          moneyAccounts={moneyAccounts}
          onChange={setPf}
          refValue={ref}
          onRef={setRef}
        />
      </div>
      {err ? <p className="mt-2 text-xs font-semibold text-[var(--danger)]">{err}</p> : null}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <button type="button" className={btnPrimary} disabled={busy || !balanced} onClick={() => void approve()}>
          {busy ? "Posting…" : `Approve & post ${Number.isFinite(a) ? inr(a) : ""}`}
        </button>
        <button type="button" className={btn} onClick={onClose}>
          Cancel
        </button>
        <span className="mx-2 h-6 w-px bg-[var(--border)]" />
        <label className={lbl}>
          Skip this month — reason
          <input className="field mt-1 !py-1.5" value={skipReason} onChange={(e) => setSkipReason(e.target.value)} placeholder="e.g. lender moratorium" />
        </label>
        <button type="button" className={btn} disabled={busy || skipReason.trim().length < 4} onClick={() => void skip()}>
          Skip
        </button>
      </div>
    </section>
  );
}

/* ─── Prepayment / top-up requests ────────────────────────── */

function RequestRow({
  r,
  loan,
  acctName,
  canApprove,
  onDone,
}: {
  r: LoanRequest;
  loan: LoanView | undefined;
  acctName: (c: string) => string;
  canApprove: boolean;
  onDone: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  async function approve() {
    setBusy(true);
    setErr("");
    const res = await post({ action: "approve-request", id: r.id });
    setBusy(false);
    if (!res.ok) setErr(res.error || "Not approved");
    else onDone(`${r.kind === "prepayment" ? "Prepayment" : "Top-up"} on ${r.code} posted as ${res.voucherNo}.`);
  }
  async function reject() {
    setBusy(true);
    setErr("");
    const res = await post({ action: "reject-request", id: r.id, note });
    setBusy(false);
    if (!res.ok) setErr(res.error || "Not rejected");
    else onDone(`Request on ${r.code} rejected.`);
  }
  const pf = { accountCode: r.accountCode, mode: r.mode, party: r.party };
  return (
    <tr className="border-t border-[var(--border)] align-top">
      <td className="px-2 py-1.5">
        <div className="font-semibold">{loan?.vehicleLabel || loan?.name || r.code}</div>
        <div className="text-[10px] text-[var(--muted)]">
          {r.code} · asked by {r.requestedBy}
        </div>
      </td>
      <td className="px-2 py-1.5">
        {r.kind === "prepayment" ? "Part-prepayment (principal only)" : "Additional loan (top-up disbursal)"}
        {r.note ? <div className="text-[10px] text-[var(--muted)]">{r.note}</div> : null}
      </td>
      <td className="px-2 py-1.5">{fmtDate(r.date)}</td>
      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{inr(r.amountPaise)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{r.kind === "prepayment" ? inr(r.amountPaise) : "—"}</td>
      <td className="px-2 py-1.5 text-right">—</td>
      <td className="px-2 py-1.5">
        {r.kind === "prepayment" ? paidFromLabel(pf, acctName(r.accountCode)) : `Into ${r.accountCode} ${acctName(r.accountCode)}`}
        {r.ref ? <div className="text-[10px] text-[var(--muted)]">Ref {r.ref}</div> : null}
      </td>
      <td className="px-2 py-1.5 text-right">
        {canApprove ? (
          <div className="flex flex-col items-end gap-1">
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void approve()}>
              Approve &amp; post
            </button>
            {rejecting ? (
              <div className="flex gap-1">
                <input className="field !py-1 text-xs" placeholder="Why?" value={note} onChange={(e) => setNote(e.target.value)} />
                <button type="button" className={btn} disabled={busy || note.trim().length < 4} onClick={() => void reject()}>
                  Reject
                </button>
              </div>
            ) : (
              <button type="button" className={btn} onClick={() => setRejecting(true)}>
                Reject…
              </button>
            )}
            {err ? <span className="text-[10px] font-semibold text-[var(--danger)]">{err}</span> : null}
          </div>
        ) : (
          <span className="text-[10px] text-[var(--muted)]">Needs Accounts · approve</span>
        )}
      </td>
    </tr>
  );
}

function RequestForm({
  loan,
  initialKind,
  today,
  moneyAccounts,
  assetAccounts,
  onClose,
  onDone,
}: {
  loan: LoanView;
  initialKind: "prepayment" | "topup";
  today: string;
  moneyAccounts: Acct[];
  assetAccounts: Acct[];
  onClose: () => void;
  onDone: (m: string) => void;
}) {
  const [kind, setKind] = useState(initialKind);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [pf, setPf] = useState<{ accountCode: string; mode: PayMode; party: LoanParty | null }>(
    loan.terms ? { ...loan.terms.paidFrom, mode: loan.terms.paidFrom.mode === "nach" ? "bank_transfer" : loan.terms.paidFrom.mode } : { accountCode: "", mode: "bank_transfer", party: null },
  );
  const [toAccount, setToAccount] = useState(VEHICLE_SUSPENSE_CODE);
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true);
    setErr("");
    const r = await post({
      action: "request",
      code: loan.code,
      kind,
      date,
      amountPaise: toPaise(amount),
      accountCode: kind === "prepayment" ? pf.accountCode : toAccount,
      mode: kind === "prepayment" ? pf.mode : "bank_transfer",
      party: kind === "prepayment" ? pf.party : null,
      ref,
      note,
    });
    setBusy(false);
    if (!r.ok) setErr(r.error || "Not saved");
    else onDone(`${kind === "prepayment" ? "Prepayment" : "Top-up"} on ${loan.code} sent for approval — nothing is in the books until it is approved.`);
  }

  return (
    <section className={card}>
      <div className="text-sm font-bold text-[var(--brand-deep)]">
        {loan.vehicleLabel || loan.name} · {loan.terms?.lender} {loan.terms?.contractNo}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        <label className="flex items-center gap-1">
          <input type="radio" checked={kind === "prepayment"} onChange={() => setKind("prepayment")} />
          <b>Top-up payment to the lender</b> (part-prepayment — reduces what is owed)
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={kind === "topup"} onChange={() => setKind("topup")} />
          <b>Additional loan (top-up disbursal)</b> — borrowing more; raises what is owed
        </label>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className={lbl}>
          Date
          <input type="date" className="field mt-1 !py-1.5" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className={lbl}>
          Amount (₹)
          <input className="field mt-1 !py-1.5" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <div />
        {kind === "prepayment" ? (
          <PaidFromFields accountCode={pf.accountCode} mode={pf.mode} party={pf.party} moneyAccounts={moneyAccounts} onChange={setPf} refValue={ref} onRef={setRef} />
        ) : (
          <>
            <label className={lbl}>
              Money went to
              <select className="field mt-1 !py-1.5" value={toAccount} onChange={(e) => setToAccount(e.target.value)}>
                {assetAccounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={lbl}>
              Reference
              <input className="field mt-1 !py-1.5" value={ref} onChange={(e) => setRef(e.target.value)} />
            </label>
          </>
        )}
        <label className={`${lbl} sm:col-span-3`}>
          Note
          <input className="field mt-1 !py-1.5" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {kind === "prepayment" ? (
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          After a prepayment the lender usually lowers the EMI or shortens the loan. When its letter says which, update the EMI (or last instalment) under Terms — the
          next proposals follow the terms.
        </p>
      ) : null}
      {err ? <p className="mt-2 text-xs font-semibold text-[var(--danger)]">{err}</p> : null}
      <div className="mt-2 flex gap-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
          {busy ? "Sending…" : "Send for approval"}
        </button>
        <button type="button" className={btn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </section>
  );
}

/* ─── Terms ───────────────────────────────────────────────── */

type TermsDraft = {
  lender: string;
  contractNo: string;
  vehicleId: string;
  emi: string;
  rate: string;
  dueDay: string;
  rounding: "paisa" | "rupee";
  pf: { accountCode: string; mode: PayMode; party: LoanParty | null };
  first: string;
  last: string;
  sanctioned: string;
  sanctionedOn: string;
  active: boolean;
  note: string;
};

function draftOf(t: LoanTerms | null): TermsDraft {
  return {
    lender: t?.lender ?? "Mahindra Finance",
    contractNo: t?.contractNo ?? "",
    vehicleId: t?.vehicleId ?? "",
    emi: t ? asRupees(t.emiPaise) : "",
    rate: t ? String(t.annualRatePct) : "",
    dueDay: String(t?.dueDay ?? 10),
    rounding: t?.interestRounding ?? "paisa",
    pf: t ? { ...t.paidFrom } : { accountCode: "", mode: "nach", party: null },
    first: t?.firstInstalmentDate ?? "",
    last: t?.lastInstalmentDate ?? "",
    sanctioned: t?.sanctionedPaise ? asRupees(t.sanctionedPaise) : "",
    sanctionedOn: t?.sanctionedOn ?? "",
    active: t?.active ?? true,
    note: t?.note ?? "",
  };
}
function termsBody(d: TermsDraft) {
  return {
    lender: d.lender,
    contractNo: d.contractNo,
    vehicleId: d.vehicleId,
    emiPaise: toPaise(d.emi),
    annualRatePct: Number(d.rate),
    dueDay: Number(d.dueDay),
    interestMethod: "reducing_daily_365",
    interestRounding: d.rounding,
    paidFrom: d.pf,
    firstInstalmentDate: d.first,
    lastInstalmentDate: d.last,
    sanctionedPaise: d.sanctioned ? toPaise(d.sanctioned) : 0,
    sanctionedOn: d.sanctionedOn,
    active: d.active,
    note: d.note,
  };
}

function TermsFields({ d, set, vehicles, moneyAccounts }: { d: TermsDraft; set: (d: TermsDraft) => void; vehicles: VehicleRef[]; moneyAccounts: Acct[] }) {
  const f = (k: keyof TermsDraft) => (e: { target: { value: string } }) => set({ ...d, [k]: e.target.value });
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-3">
      <label className={lbl}>
        Lender
        <input className="field mt-1 !py-1.5" value={d.lender} onChange={f("lender")} />
      </label>
      <label className={lbl}>
        Contract / loan no.
        <input className="field mt-1 !py-1.5" value={d.contractNo} onChange={f("contractNo")} />
      </label>
      <label className={lbl}>
        Vehicle
        <select className="field mt-1 !py-1.5" value={d.vehicleId} onChange={f("vehicleId")}>
          <option value="">Not a vehicle / not linked</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
              {v.isActive ? "" : " (inactive)"}
            </option>
          ))}
        </select>
      </label>
      <label className={lbl}>
        EMI (₹)
        <input className="field mt-1 !py-1.5" inputMode="decimal" value={d.emi} onChange={f("emi")} />
      </label>
      <label className={lbl}>
        Annual rate (%)
        <input className="field mt-1 !py-1.5" inputMode="decimal" value={d.rate} onChange={f("rate")} />
      </label>
      <label className={lbl}>
        Due day of month
        <input className="field mt-1 !py-1.5" inputMode="numeric" value={d.dueDay} onChange={f("dueDay")} />
      </label>
      <label className={lbl}>
        Interest method
        <select className="field mt-1 !py-1.5" value={d.rounding} onChange={(e) => set({ ...d, rounding: e.target.value === "rupee" ? "rupee" : "paisa" })}>
          <option value="paisa">Reducing balance, daily ÷ 365 — rounded to the paisa</option>
          <option value="rupee">Reducing balance, daily ÷ 365 — rounded to the rupee</option>
        </select>
      </label>
      <label className={lbl}>
        First instalment due
        <input type="date" className="field mt-1 !py-1.5" value={d.first} onChange={f("first")} />
      </label>
      <label className={lbl}>
        Last instalment due (if known)
        <input type="date" className="field mt-1 !py-1.5" value={d.last} onChange={f("last")} />
      </label>
      <label className={lbl}>
        Amount sanctioned (₹, if known)
        <input className="field mt-1 !py-1.5" inputMode="decimal" value={d.sanctioned} onChange={f("sanctioned")} />
      </label>
      <label className={lbl}>
        Sanctioned / disbursed on
        <input type="date" className="field mt-1 !py-1.5" value={d.sanctionedOn} onChange={f("sanctionedOn")} />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={d.active} onChange={(e) => set({ ...d, active: e.target.checked })} /> Propose EMIs for this loan
      </label>
      <div className="text-[11px] font-bold text-[var(--brand-deep)] sm:col-span-3">EMI is paid from</div>
      <PaidFromFields accountCode={d.pf.accountCode} mode={d.pf.mode} party={d.pf.party} moneyAccounts={moneyAccounts} onChange={(pf) => set({ ...d, pf })} />
      <label className={`${lbl} sm:col-span-3`}>
        Note
        <input className="field mt-1 !py-1.5" value={d.note} onChange={f("note")} />
      </label>
    </div>
  );
}

function TermsEditor({
  loan,
  vehicles,
  moneyAccounts,
  onClose,
  onDone,
}: {
  loan: LoanView;
  vehicles: VehicleRef[];
  moneyAccounts: Acct[];
  onClose: () => void;
  onDone: (m: string) => void;
}) {
  const [d, setD] = useState<TermsDraft>(() => draftOf(loan.terms));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    setBusy(true);
    setErr("");
    const r = await post({
      action: "save-terms",
      code: loan.code,
      terms: termsBody(d),
      baseUpdatedAt: loan.termsSource === "saved" ? loan.terms?.updatedAt ?? "" : "",
    });
    setBusy(false);
    if (!r.ok) setErr(r.error || "Not saved");
    else onDone(`Terms for ${loan.code} saved.`);
  }
  return (
    <section className={card}>
      <div className="text-sm font-bold text-[var(--brand-deep)]">Terms · {loan.name}</div>
      {loan.termsSource === "default" ? (
        <p className="text-[11px] text-[var(--danger)]">These are the defaults from the lender&apos;s statements — check them and save to confirm.</p>
      ) : null}
      <p className="text-[11px] text-[var(--muted)]">After a prepayment, when the lender lowers the EMI or shortens the loan, change the EMI or last instalment here.</p>
      <TermsFields d={d} set={setD} vehicles={vehicles} moneyAccounts={moneyAccounts} />
      {err ? <p className="mt-2 text-xs font-semibold text-[var(--danger)]">{err}</p> : null}
      <div className="mt-2 flex gap-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save terms"}
        </button>
        <button type="button" className={btn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </section>
  );
}

function AddLoanForm({
  vehicles,
  moneyAccounts,
  assetAccounts,
  today,
  onClose,
  onDone,
}: {
  vehicles: VehicleRef[];
  moneyAccounts: Acct[];
  assetAccounts: Acct[];
  today: string;
  onClose: () => void;
  onDone: (m: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [d, setD] = useState<TermsDraft>(() => ({ ...draftOf(null), sanctionedOn: today }));
  const [charges, setCharges] = useState("");
  const [debitCode, setDebitCode] = useState(VEHICLE_SUSPENSE_CODE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    setBusy(true);
    setErr("");
    const r = await post({ action: "add-loan", title, terms: termsBody(d), chargesPaise: charges ? toPaise(charges) : 0, debitCode });
    setBusy(false);
    if (!r.ok) setErr(r.error || "Not added");
    else onDone(`Loan ${r.code} opened and booked as ${r.voucherNo}.`);
  }
  return (
    <section className={card}>
      <div className="text-sm font-bold text-[var(--brand-deep)]">Add a new loan</div>
      <p className="text-[11px] text-[var(--muted)]">
        Opens a liability account &quot;Vehicle Loan — …&quot;, saves its terms and books it: Dr where the money went (1950 suspense when the lender paid the dealer) and
        Dr 5090 the lender&apos;s charges, Cr the new loan.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className={`${lbl} sm:col-span-2`}>
          Vehicle / purpose (account name)
          <input className="field mt-1 !py-1.5" placeholder="TATA Magic Express Van UP65XX0000" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className={lbl}>
          Lender&apos;s charges deducted (₹)
          <input className="field mt-1 !py-1.5" inputMode="decimal" value={charges} onChange={(e) => setCharges(e.target.value)} />
        </label>
        <label className={lbl}>
          Loan money went to
          <select className="field mt-1 !py-1.5" value={debitCode} onChange={(e) => setDebitCode(e.target.value)}>
            {assetAccounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <TermsFields d={d} set={setD} vehicles={vehicles} moneyAccounts={moneyAccounts} />
      {err ? <p className="mt-2 text-xs font-semibold text-[var(--danger)]">{err}</p> : null}
      <div className="mt-2 flex gap-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
          {busy ? "Opening…" : "Open and book the loan"}
        </button>
        <button type="button" className={btn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </section>
  );
}

/* ─── One loan: history and schedule ──────────────────────── */

const KIND_LABEL: Record<string, string> = {
  disbursal: "Loan / opening balance",
  emi: "EMI",
  prepayment: "Prepayment (principal)",
  topup: "Top-up (additional loan)",
  other: "Other",
};

function LoanDetail({
  loan,
  canApprove,
  onOpenVoucher,
  onClose,
  onDone,
}: {
  loan: LoanView;
  canApprove: boolean;
  onOpenVoucher: (no: string) => void;
  onClose: () => void;
  onDone: (m: string) => void;
}) {
  const c = loan.computed;
  async function reopen(month: string) {
    const r = await post({ action: "reopen-emi", code: loan.code, month });
    if (r.ok) onDone(`${monthLabel(month)} reopened for ${loan.code}.`);
  }
  return (
    <section className={card} aria-label={`Loan ${loan.code}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-[var(--brand-deep)]">{loan.name}</div>
          <div className="text-[11px] text-[var(--muted)]">
            {loan.vehicleLabel ? `${loan.vehicleLabel} · ` : ""}
            Paid so far: principal {inr(c.principalPaidPaise)}, interest {inr(c.interestPaidPaise)}
            {c.prepaidPaise ? `, prepaid ${inr(c.prepaidPaise)}` : ""}
            {c.toppedUpPaise ? `, topped up ${inr(c.toppedUpPaise)}` : ""} · outstanding {inr(c.outstandingPaise)}
          </div>
        </div>
        <button type="button" className={btn} onClick={onClose}>
          Close
        </button>
      </div>
      {c.warnings.map((w) => (
        <p key={w} className="mt-1 text-[11px] font-semibold text-[var(--danger)]">
          {w}
        </p>
      ))}
      <ErpTableShell density="compact" className="mt-2">
        <div className="overflow-x-auto">
        <ErpTable minWidth="min-w-[820px]" className="text-xs">
          <ErpTableHead>
            <tr>
              <th className="px-2 py-1">Date</th>
              <th className="px-2 py-1">Voucher</th>
              <th className="px-2 py-1">What</th>
              <th className="px-2 py-1 text-right">Borrowed</th>
              <th className="px-2 py-1 text-right">Principal</th>
              <th className="px-2 py-1 text-right">Interest</th>
              <th className="px-2 py-1 text-right">Balance</th>
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {c.history.map((h) => (
              <tr key={h.voucherId} className="border-t border-[var(--border)]" title={h.narration}>
                <td className="px-2 py-1">{fmtDate(h.date)}</td>
                <td className="px-2 py-1">
                  <button type="button" className="font-semibold text-[var(--brand-mid)] hover:underline" onClick={() => onOpenVoucher(h.voucherNo)}>
                    {h.voucherNo}
                  </button>
                </td>
                <td className="px-2 py-1">
                  {KIND_LABEL[h.kind]}
                  {h.kind === "emi" ? ` ${h.emiNo || ""}${h.month ? ` · ${monthLabel(h.month)}` : ""}` : ""}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{h.creditPaise ? inr(h.creditPaise) : ""}</td>
                <td className="px-2 py-1 text-right tabular-nums">{h.principalPaise ? inr(h.principalPaise) : ""}</td>
                <td className="px-2 py-1 text-right tabular-nums">{h.interestPaise ? inr(h.interestPaise) : ""}</td>
                <td className="px-2 py-1 text-right font-semibold tabular-nums">{inr(h.balancePaise)}</td>
              </tr>
            ))}
            {c.projection.map((p) => (
              <tr key={p.key} className="border-t border-dashed border-[var(--border)] italic text-[var(--muted)]">
                <td className="px-2 py-1">{fmtDate(p.dueOn)}</td>
                <td className="px-2 py-1">{p.status === "awaiting_approval" ? "Awaiting approval" : "Projection"}</td>
                <td className="px-2 py-1">
                  EMI {p.emiNo || ""} · {monthLabel(p.month)}
                  {p.isFinal ? " (last)" : ""}
                </td>
                <td />
                <td className="px-2 py-1 text-right tabular-nums">{inr(p.principalPaise)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{inr(p.interestPaise)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{inr(p.closingPaise)}</td>
              </tr>
            ))}
          </ErpTableBody>
        </ErpTable>
      </div>
      </ErpTableShell>
      <p className="mt-1 text-[10px] text-[var(--muted)]">
        Italic rows are a projection by the terms&apos; interest method — not in the books. A prepayment or a changed EMI changes them.
      </p>
      {c.skipped.length ? (
        <div className="mt-2 text-xs">
          <b>Skipped months:</b>{" "}
          {c.skipped.map((k) => (
            <span key={k.key} className="mr-2">
              {monthLabel(k.month)} ({k.reason}, {k.by})
              {canApprove ? (
                <button type="button" className="ml-1 text-[var(--brand-mid)] underline" onClick={() => void reopen(k.month)}>
                  reopen
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/* ─── Export ──────────────────────────────────────────────── */

function ExportPanel({ loans, today }: { loans: LoanView[]; today: string }) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(loans.map((l) => l.code)));
  const fyStart = Number(today.slice(5, 7)) >= 4 ? `${today.slice(0, 4)}-04` : `${Number(today.slice(0, 4)) - 1}-04`;
  const [from, setFrom] = useState(fyStart);
  const [to, setTo] = useState(monthOf(today));
  const [withProjection, setWithProjection] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const rows = useMemo(
    () =>
      loanExportRows(
        loans
          .filter((l) => chosen.has(l.code))
          .map((l) => ({ code: l.code, vehicle: l.vehicleLabel, contract: `${l.terms?.lender ?? ""} ${l.terms?.contractNo ?? ""}`.trim(), computed: l.computed })),
        { fromMonth: from, toMonth: to, projection: withProjection },
      ),
    [loans, chosen, from, to, withProjection],
  );

  async function run(format: "xlsx" | "csv" | "pdf") {
    setBusy(true);
    setErr("");
    try {
      const { downloadXlsxReport, downloadExcelCsv, downloadPdfReport } = await import("@/lib/reportExport");
      const r = (p: number) => Math.round(p) / 100;
      const columns = [
        { key: "code", header: "Loan a/c", type: "text" as const },
        { key: "vehicle", header: "Vehicle" },
        { key: "contract", header: "Lender / contract", type: "text" as const },
        { key: "date", header: "Date", type: "date" as const },
        { key: "type", header: "Type" },
        { key: "voucherNo", header: "Voucher no", type: "text" as const },
        { key: "emiNo", header: "EMI no", type: "text" as const, total: false },
        { key: "principal", header: "Principal", type: "money" as const },
        { key: "interest", header: "Interest", type: "money" as const },
        { key: "prepayment", header: "Prepayment", type: "money" as const },
        { key: "topup", header: "Top-up", type: "money" as const },
        { key: "balance", header: "Balance after", type: "money" as const, total: false },
        { key: "status", header: "Status" },
      ];
      const data = rows.map((x) => ({
        code: x.code,
        vehicle: x.vehicle,
        contract: x.contract,
        date: x.date,
        type: x.type,
        voucherNo: x.voucherNo,
        emiNo: x.emiNo === "" ? "" : String(x.emiNo),
        principal: r(x.principalPaise),
        interest: r(x.interestPaise),
        prepayment: r(x.prepaymentPaise),
        topup: r(x.topupPaise),
        balance: r(x.balancePaise),
        status: x.status,
      }));
      const totalsCols = [
        { key: "label", header: "Group" },
        { key: "principal", header: "Principal", type: "money" as const },
        { key: "interest", header: "Interest", type: "money" as const },
        { key: "prepayment", header: "Prepayment", type: "money" as const },
        { key: "topup", header: "Top-up", type: "money" as const },
      ];
      const tot = (by: "vehicle" | "month") =>
        loanTotals(rows, by).map((t) => ({ label: t.label, principal: r(t.principalPaise), interest: r(t.interestPaise), prepayment: r(t.prepaymentPaise), topup: r(t.topupPaise) }));
      const input = {
        title: "Loans — history" + (withProjection ? " and projection" : ""),
        subtitle: `${monthLabel(from)} to ${monthLabel(to)}`,
        filterNote: `${chosen.size} loan${chosen.size === 1 ? "" : "s"}${withProjection ? " · projection rows are not in the books" : ""}`,
        columns,
        rows: data,
        fileBaseName: `loans_${from}_${to}`,
        extraSheets: [
          { name: "By vehicle", columns: totalsCols, rows: tot("vehicle") },
          { name: "By month", columns: totalsCols, rows: tot("month") },
        ],
      };
      if (format === "xlsx") await downloadXlsxReport(input);
      else if (format === "csv") downloadExcelCsv(input);
      else await downloadPdfReport(input);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={card} aria-label="Export loans">
      <h3 className="text-xs font-bold text-[var(--brand-deep)]">Export — by vehicle and months</h3>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {loans.map((l) => (
          <label key={l.code} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={chosen.has(l.code)}
              onChange={(e) => {
                const n = new Set(chosen);
                if (e.target.checked) n.add(l.code);
                else n.delete(l.code);
                setChosen(n);
              }}
            />
            {l.code} {l.vehicleLabel ? `· ${l.vehicleLabel}` : ""}
          </label>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className={lbl}>
          From month
          <input type="month" className="field mt-1 !py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className={lbl}>
          To month
          <input type="month" className="field mt-1 !py-1.5" value={to} max={addMonths(monthOf(today), 600)} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={withProjection} onChange={(e) => setWithProjection(e.target.checked)} /> Include projection
        </label>
        <span className="text-[11px] text-[var(--muted)]">{rows.length} rows</span>
        <button type="button" className={btn} disabled={busy || !rows.length} onClick={() => void run("xlsx")}>
          Excel
        </button>
        <button type="button" className={btn} disabled={busy || !rows.length} onClick={() => void run("csv")}>
          CSV
        </button>
        <button type="button" className={btn} disabled={busy || !rows.length} onClick={() => void run("pdf")}>
          PDF
        </button>
      </div>
      <p className="mt-1 text-[10px] text-[var(--muted)]">Excel and PDF carry totals of principal, interest, prepayments and top-ups per vehicle and per month.</p>
      {err ? <p className="mt-1 text-xs font-semibold text-[var(--danger)]">{err}</p> : null}
    </section>
  );
}
