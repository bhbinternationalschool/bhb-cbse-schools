import "server-only";

/**
 * Accounts → Loans on the server: read every loan from Ledger v2, its terms
 * and its approval queue; post approved EMIs, prepayments and top-ups
 * through ledgerPost (idempotent source ids); and the daily tick that tells
 * approvers once per loan-month. Rules live in lib/loans.ts.
 *
 * Two module_local_state rows, written only here, by compare-and-set
 * (lib/transportFinance.server casUpdate): LOAN_TERMS_KEY and LOAN_QUEUE_KEY.
 * Proposals are never stored — they are worked out from the books each time,
 * so an EMI typed by hand in Accounts is recognised and never proposed again.
 *
 * Every read failure is "unknown", never "none": the caller gets an error.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { L_CASH } from "@/lib/ledger/coa";
import {
  LOAN_BOOKING_SOURCE,
  LOAN_EMI_SOURCE,
  LOAN_INTEREST_CODE,
  LOAN_PREPAYMENT_SOURCE,
  LOAN_QUEUE_KEY,
  LOAN_TERMS_KEY,
  LOAN_TOPUP_SOURCE,
  TRUSTEE_LOAN_CODE,
  bookingLines,
  computeLoan,
  effectiveTerms,
  emiApprovalProblem,
  emiLines,
  emiNarration,
  isIsoDate,
  isMonth,
  istToday,
  loanRequestProblem,
  monthLabel,
  nextLoanCode,
  normalizeLoanQueue,
  normalizeLoanTerms,
  normalizeLoanTermsState,
  requestLines,
  requestNarration,
  rupees,
  termsProblem,
  type EmiApproval,
  type LoanComputed,
  type LoanLedgerEntry,
  type LoanQueueState,
  type LoanRequest,
  type LoanRequestInput,
  type LoanTerms,
  type LoanTermsState,
  type MoneyAccount,
} from "@/lib/loans";
import { isInterestAccount, isVehicleLoanAccount, normalizeLoanLinks, TRANSPORT_LOAN_LINKS_KEY } from "@/lib/transportFinance";
import { casUpdate, pageAll, readFleetVehicles, readRow, type FleetVehicleRef } from "@/lib/transportFinance.server";

type Fail = { ok: false; error: string; status?: number; conflict?: boolean };

/* ─── Stores ──────────────────────────────────────────────── */

export async function readLoanTerms(): Promise<{ state: LoanTermsState; updatedAt: string } | null> {
  const row = await readRow(LOAN_TERMS_KEY);
  return row ? { state: normalizeLoanTermsState(row.state), updatedAt: row.updatedAt } : null;
}

export async function readLoanQueue(): Promise<{ state: LoanQueueState; updatedAt: string } | null> {
  const row = await readRow(LOAN_QUEUE_KEY);
  return row ? { state: normalizeLoanQueue(row.state), updatedAt: row.updatedAt } : null;
}

/* ─── Accounts ────────────────────────────────────────────── */

export type ChartAccount = {
  code: string;
  name: string;
  kind: string;
  parentCode: string;
  hasChildren: boolean;
  isCash: boolean;
  isBank: boolean;
  bankAccountId: string;
};

async function chart(): Promise<ChartAccount[]> {
  const { ledgerListAccounts } = await import("@/lib/ledger/ledger.server");
  return ledgerListAccounts();
}

/** Where an EMI or prepayment can be paid from: a bank, the cash box, or the trustee (2100). */
export function moneyAccountsOf(accounts: readonly ChartAccount[]): ChartAccount[] {
  return accounts.filter((a) => !a.hasChildren && (a.isCash || a.isBank || a.code === L_CASH || a.code === TRUSTEE_LOAN_CODE));
}
/** Where a top-up or a new loan's money can go: any asset leaf (bank, 1950 suspense, fixed assets…). */
export function assetAccountsOf(accounts: readonly ChartAccount[]): ChartAccount[] {
  return accounts.filter((a) => !a.hasChildren && a.kind === "asset");
}

/* ─── Loans, from the books ───────────────────────────────── */

export type LoanView = {
  code: string;
  name: string;
  terms: LoanTerms | null;
  termsSource: "saved" | "default" | "none";
  vehicleLabel: string;
  computed: LoanComputed;
};

export type LoansSnapshot = {
  ok: true;
  today: string;
  loans: LoanView[];
  vehicles: FleetVehicleRef[];
  moneyAccounts: { code: string; name: string }[];
  assetAccounts: { code: string; name: string }[];
  requests: LoanRequest[];
  termsUpdatedAt: string;
  /** Accounts the server knows — validation, never sent whole to the screen. */
  accounts: ChartAccount[];
};

type AccountRow = { id: string; code: string; name: string; kind: string; parent_code: string | null; is_active: boolean | null };
type LineRow = { voucher_id: string; account_id: string; debit_paise: number; credit_paise: number };
type VoucherRow = {
  id: string;
  voucher_no: string;
  voucher_type: string;
  voucher_date: string;
  reverses_voucher_id: string | null;
  source_type: string | null;
  source_id: string | null;
  narration: string | null;
};

export async function buildLoans(today = istToday()): Promise<LoansSnapshot | Fail> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable", status: 503 };
  const [terms, queue, linksRow, vehicles, accountsRes, postable] = await Promise.all([
    readLoanTerms(),
    readLoanQueue(),
    readRow(TRANSPORT_LOAN_LINKS_KEY),
    readFleetVehicles(),
    ctx.sb.from("ledger_accounts").select("id, code, name, kind, parent_code, is_active").eq("tenant_id", ctx.tenantId),
    chart(),
  ]);
  if (!terms) return { ok: false, error: "Could not read the loan terms", status: 502 };
  if (!queue) return { ok: false, error: "Could not read the loan approvals", status: 502 };
  if (!linksRow) return { ok: false, error: "Could not read the loan ↔ vehicle links", status: 502 };
  if (accountsRes.error) return { ok: false, error: `Could not read the chart of accounts: ${accountsRes.error.message}`, status: 502 };
  if (postable.length === 0) return { ok: false, error: "Could not read the chart of accounts", status: 502 };
  const links = normalizeLoanLinks(linksRow.state);
  const all = (accountsRes.data ?? []) as AccountRow[];
  const known = new Set([...Object.keys(links.links), ...Object.keys(terms.state.loans)]);
  const loanAccounts = all.filter((a) =>
    isVehicleLoanAccount({ code: a.code, name: a.name, kind: a.kind, parentCode: a.parent_code ?? "", isActive: a.is_active !== false }, known),
  );
  const fleet = vehicles ?? [];
  const entriesByCode = new Map<string, LoanLedgerEntry[]>();

  if (loanAccounts.length) {
    const interestIds = new Set(all.filter((a) => isInterestAccount(a)).map((a) => a.id));
    const codeById = new Map(loanAccounts.map((a) => [a.id, a.code]));
    const lines = await pageAll<LineRow>((from, to) =>
      ctx.sb
        .from("ledger_lines")
        .select("voucher_id, account_id, debit_paise, credit_paise")
        .eq("tenant_id", ctx.tenantId)
        .in("account_id", [...codeById.keys()])
        .order("id")
        .range(from, to),
    );
    if (!lines) return { ok: false, error: "Could not read the loan accounts' lines", status: 502 };
    const voucherIds = [...new Set(lines.map((l) => l.voucher_id))];
    const vouchers = new Map<string, VoucherRow>();
    const reversed = new Set<string>();
    const interest = new Map<string, number>();
    for (let i = 0; i < voucherIds.length; i += 200) {
      const ids = voucherIds.slice(i, i + 200);
      const [vs, revs, ints] = await Promise.all([
        ctx.sb
          .from("ledger_vouchers")
          .select("id, voucher_no, voucher_type, voucher_date, reverses_voucher_id, source_type, source_id, narration")
          .eq("tenant_id", ctx.tenantId)
          .in("id", ids),
        ctx.sb.from("ledger_vouchers").select("reverses_voucher_id").eq("tenant_id", ctx.tenantId).in("reverses_voucher_id", ids),
        interestIds.size
          ? ctx.sb
              .from("ledger_lines")
              .select("voucher_id, account_id, debit_paise, credit_paise")
              .eq("tenant_id", ctx.tenantId)
              .in("voucher_id", ids)
              .in("account_id", [...interestIds])
          : Promise.resolve({ data: [], error: null }),
      ]);
      const err = vs.error || revs.error || ints.error;
      if (err) return { ok: false, error: `Could not read the loan vouchers: ${err.message}`, status: 502 };
      if ((vs.data ?? []).length !== ids.length) return { ok: false, error: "Some loan vouchers could not be read — nothing is shown rather than a wrong balance", status: 502 };
      for (const v of (vs.data ?? []) as VoucherRow[]) vouchers.set(v.id, v);
      for (const r of (revs.data ?? []) as { reverses_voucher_id: string | null }[]) if (r.reverses_voucher_id) reversed.add(r.reverses_voucher_id);
      for (const l of (ints.data ?? []) as LineRow[]) {
        interest.set(l.voucher_id, (interest.get(l.voucher_id) ?? 0) + Number(l.debit_paise || 0) - Number(l.credit_paise || 0));
      }
    }
    const byKey = new Map<string, LoanLedgerEntry>();
    for (const l of lines) {
      const code = codeById.get(l.account_id);
      const v = vouchers.get(l.voucher_id);
      if (!code || !v) continue;
      const key = `${code}|${v.id}`;
      const e =
        byKey.get(key) ??
        ({
          voucherId: v.id,
          voucherNo: v.voucher_no,
          voucherType: v.voucher_type,
          date: String(v.voucher_date).slice(0, 10),
          sourceType: v.source_type ?? "",
          sourceId: v.source_id ?? "",
          narration: v.narration ?? "",
          loanDebitPaise: 0,
          loanCreditPaise: 0,
          interestPaise: interest.get(v.id) ?? 0,
          cancelled: !!v.reverses_voucher_id || reversed.has(v.id),
        } satisfies LoanLedgerEntry);
      e.loanDebitPaise += Number(l.debit_paise || 0);
      e.loanCreditPaise += Number(l.credit_paise || 0);
      byKey.set(key, e);
      const list = entriesByCode.get(code) ?? [];
      if (!list.includes(e)) list.push(e);
      entriesByCode.set(code, list);
    }
  }

  const loans: LoanView[] = loanAccounts
    .map((a) => {
      const eff = effectiveTerms(a.code, terms.state);
      const link = links.links[a.code];
      // A vehicle linked on Transport → Finance before terms were saved still counts.
      const t = eff ? { ...eff.terms, vehicleId: eff.terms.vehicleId || link?.vehicleId || "" } : null;
      const veh = t?.vehicleId ? fleet.find((v) => v.id === t.vehicleId) : undefined;
      return {
        code: a.code,
        name: a.name,
        terms: t,
        termsSource: eff ? eff.source : ("none" as const),
        vehicleLabel: veh ? veh.label : t?.vehicleId ? "(vehicle no longer in the fleet)" : "",
        computed: computeLoan({ code: a.code, entries: entriesByCode.get(a.code) ?? [], terms: t, today, skips: queue.state.skips }),
      };
    })
    .sort((x, y) => x.code.localeCompare(y.code));

  return {
    ok: true,
    today,
    loans,
    vehicles: fleet,
    moneyAccounts: moneyAccountsOf(postable).map((a) => ({ code: a.code, name: a.name })),
    assetAccounts: assetAccountsOf(postable).map((a) => ({ code: a.code, name: a.name })),
    requests: queue.state.requests,
    termsUpdatedAt: terms.updatedAt,
    accounts: postable,
  };
}

function money(accounts: readonly ChartAccount[], code: string): MoneyAccount | null {
  const a = accounts.find((x) => x.code === code);
  return a ? { code: a.code, name: a.name, bankAccountId: a.bankAccountId } : null;
}

/* ─── Terms ───────────────────────────────────────────────── */

/**
 * Save one loan's terms (Accounts · edit). `baseUpdatedAt` is the loan's
 * updatedAt the screen loaded ("" for terms never saved): two people editing
 * the same loan cannot silently overwrite each other.
 */
export async function saveLoanTerms(input: { code: string; terms: unknown; baseUpdatedAt: string; by: string }): Promise<{ ok: true; terms: LoanTerms } | Fail> {
  const snap = await buildLoans();
  if (!snap.ok) return snap;
  const loan = snap.loans.find((l) => l.code === input.code);
  if (!loan) return { ok: false, error: "That is not a loan account", status: 404 };
  const now = new Date().toISOString();
  const t = normalizeLoanTerms(input.code, { ...(input.terms as object), updatedAt: now, updatedBy: input.by });
  if (!t) return { ok: false, error: "Nothing to save", status: 400 };
  if (t.vehicleId && !snap.vehicles.some((v) => v.id === t.vehicleId)) return { ok: false, error: "That vehicle is not in the fleet", status: 400 };
  const exists = (c: string) => snap.accounts.some((a) => a.code === c);
  const problem = termsProblem(t, exists);
  if (problem) return { ok: false, error: problem, status: 400 };
  const r = await casUpdate(LOAN_TERMS_KEY, normalizeLoanTermsState, (cur) => {
    const was = cur.loans[input.code];
    if ((was?.updatedAt ?? "") !== (input.baseUpdatedAt ?? "")) {
      return { ok: false, conflict: true, status: 409, error: `${was?.updatedBy || "Someone"} changed these terms meanwhile — reload and try again` };
    }
    return { ok: true, next: { loans: { ...cur.loans, [input.code]: t } } };
  });
  return r.ok ? { ok: true, terms: t } : r;
}

/* ─── EMIs ────────────────────────────────────────────────── */

export async function approveEmi(a: EmiApproval, by: string): Promise<{ ok: true; voucherNo: string; replay: boolean } | Fail> {
  if (!isMonth(a.month)) return { ok: false, error: "Which month's EMI?", status: 400 };
  const snap = await buildLoans();
  if (!snap.ok) return snap;
  const loan = snap.loans.find((l) => l.code === a.code);
  if (!loan || !loan.terms) return { ok: false, error: "No terms for that loan", status: 404 };
  const posted = loan.computed.history.find((h) => h.kind === "emi" && h.month === a.month);
  if (posted) return { ok: false, error: `The ${monthLabel(a.month)} EMI is already in the books as ${posted.voucherNo}`, status: 409 };
  if (loan.computed.skipped.some((k) => k.month === a.month)) return { ok: false, error: `${monthLabel(a.month)} was skipped — reopen it first`, status: 409 };
  const proposal = loan.computed.projection.find((p) => p.month === a.month);
  if (!proposal) return { ok: false, error: `No EMI is owed for ${monthLabel(a.month)} on this loan`, status: 409 };
  const problem = emiApprovalProblem(a, {
    today: snap.today,
    outstandingPaise: loan.computed.outstandingPaise,
    accountExists: (c) => snap.accounts.some((x) => x.code === c),
  });
  if (problem) return { ok: false, error: problem, status: 400 };
  const acct = money(snap.accounts, a.accountCode);
  const narration = emiNarration({ emiNo: proposal.emiNo, terms: loan.terms, vehicleLabel: loan.vehicleLabel, dueOn: proposal.dueOn, a, accountName: acct?.name ?? a.accountCode });
  const { ledgerPost } = await import("@/lib/ledger/ledger.server");
  const r = await ledgerPost({
    voucherType: "payment",
    date: a.date,
    narration,
    sourceType: LOAN_EMI_SOURCE,
    sourceId: `${a.code}:${a.month}`,
    createdBy: by,
    lines: emiLines(a, acct, LOAN_INTEREST_CODE),
  });
  if (!r.ok) return { ok: false, error: `The books refused the EMI: ${r.error}`, status: 422 };
  return { ok: true, voucherNo: r.voucherNo, replay: !r.created };
}

export async function skipEmi(input: { code: string; month: string; reason: string; by: string; reopen?: boolean }): Promise<{ ok: true } | Fail> {
  if (!isMonth(input.month)) return { ok: false, error: "Which month?", status: 400 };
  const reason = String(input.reason ?? "").trim();
  if (!input.reopen && reason.length < 4) return { ok: false, error: "Say why this month is skipped", status: 400 };
  const key = `${input.code}:${input.month}`;
  const r = await casUpdate(LOAN_QUEUE_KEY, normalizeLoanQueue, (cur) => {
    const skips = { ...cur.skips };
    if (input.reopen) delete skips[key];
    else skips[key] = { key, code: input.code, month: input.month, reason: reason.slice(0, 300), by: input.by, at: new Date().toISOString() };
    return { ok: true, next: { ...cur, skips } };
  });
  return r.ok ? { ok: true } : r;
}

/* ─── Prepayments and top-ups ─────────────────────────────── */

function newRequestId(kind: string): string {
  return `loan${kind === "topup" ? "tu" : "pp"}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export async function createLoanRequest(input: LoanRequestInput, by: string): Promise<{ ok: true; request: LoanRequest } | Fail> {
  const snap = await buildLoans();
  if (!snap.ok) return snap;
  const loan = snap.loans.find((l) => l.code === input.code);
  if (!loan) return { ok: false, error: "That is not a loan account", status: 404 };
  const problem = loanRequestProblem(input, {
    today: snap.today,
    outstandingPaise: loan.computed.outstandingPaise,
    accountExists: (c) => snap.accounts.some((x) => x.code === c),
  });
  if (problem) return { ok: false, error: problem, status: 400 };
  const request: LoanRequest = {
    ...input,
    party: input.accountCode === TRUSTEE_LOAN_CODE ? input.party : null,
    id: newRequestId(input.kind),
    status: "pending",
    requestedBy: by,
    requestedAt: new Date().toISOString(),
    decidedBy: "",
    decidedAt: "",
    decisionNote: "",
    voucherNo: "",
    voucherId: "",
  };
  const r = await casUpdate(LOAN_QUEUE_KEY, normalizeLoanQueue, (cur) => ({ ok: true, next: { ...cur, requests: [...cur.requests, request] } }));
  return r.ok ? { ok: true, request } : r;
}

/**
 * Approve a prepayment / top-up: post it (source loan_prepayment|loan_topup
 * : <request id> — a repeat returns the same voucher), then mark it posted.
 * The approver may correct date, amount, account, mode and reference first.
 */
export async function approveLoanRequest(input: {
  id: string;
  edits?: Partial<Pick<LoanRequest, "date" | "amountPaise" | "accountCode" | "mode" | "ref" | "party">>;
  by: string;
}): Promise<{ ok: true; voucherNo: string; replay: boolean } | Fail> {
  const snap = await buildLoans();
  if (!snap.ok) return snap;
  const queue = await readLoanQueue();
  if (!queue) return { ok: false, error: "Could not read the approvals", status: 502 };
  const was = queue.state.requests.find((r) => r.id === input.id);
  if (!was) return { ok: false, error: "No such request", status: 404 };
  if (was.status === "rejected") return { ok: false, error: "This request was rejected", status: 409 };
  if (was.status === "posted") return { ok: true, voucherNo: was.voucherNo, replay: true };
  const loan = snap.loans.find((l) => l.code === was.code);
  if (!loan) return { ok: false, error: "That loan account is gone", status: 404 };
  const e = input.edits ?? {};
  const req: LoanRequest = {
    ...was,
    date: e.date ?? was.date,
    amountPaise: e.amountPaise ?? was.amountPaise,
    accountCode: e.accountCode ?? was.accountCode,
    mode: e.mode ?? was.mode,
    ref: (e.ref ?? was.ref).slice(0, 80),
    party: e.party !== undefined ? e.party : was.party,
  };
  if (req.accountCode !== TRUSTEE_LOAN_CODE) req.party = null;
  const problem = loanRequestProblem(req, {
    today: snap.today,
    outstandingPaise: loan.computed.outstandingPaise,
    accountExists: (c) => snap.accounts.some((x) => x.code === c),
  });
  if (problem) return { ok: false, error: problem, status: 400 };
  const acct = money(snap.accounts, req.accountCode);
  const { ledgerPost } = await import("@/lib/ledger/ledger.server");
  const posted = await ledgerPost({
    voucherType: req.kind === "prepayment" ? "payment" : "journal",
    date: req.date,
    narration: requestNarration(req, loan.terms, loan.vehicleLabel, acct?.name ?? req.accountCode),
    sourceType: req.kind === "prepayment" ? LOAN_PREPAYMENT_SOURCE : LOAN_TOPUP_SOURCE,
    sourceId: req.id,
    createdBy: input.by,
    lines: requestLines(req, acct),
  });
  if (!posted.ok) return { ok: false, error: `The books refused it: ${posted.error}`, status: 422 };
  const now = new Date().toISOString();
  const stamped = await casUpdate(LOAN_QUEUE_KEY, normalizeLoanQueue, (cur) => ({
    ok: true,
    next: {
      ...cur,
      requests: cur.requests.map((r) =>
        r.id === req.id ? { ...req, status: "posted" as const, decidedBy: input.by, decidedAt: now, voucherNo: posted.voucherNo, voucherId: posted.voucherId } : r,
      ),
    },
  }));
  if (!stamped.ok) {
    return { ok: false, error: `Voucher ${posted.voucherNo} is in the books, but the request could not be marked (${stamped.error}). Approve it again — it will not post twice.`, status: 502 };
  }
  return { ok: true, voucherNo: posted.voucherNo, replay: !posted.created };
}

export async function rejectLoanRequest(input: { id: string; note: string; by: string }): Promise<{ ok: true } | Fail> {
  const note = String(input.note ?? "").trim();
  if (note.length < 4) return { ok: false, error: "Say why it is rejected", status: 400 };
  const r = await casUpdate(LOAN_QUEUE_KEY, normalizeLoanQueue, (cur) => {
    const was = cur.requests.find((x) => x.id === input.id);
    if (!was) return { ok: false, error: "No such request", status: 404 };
    if (was.status !== "pending") return { ok: false, error: `It is already ${was.status}`, status: 409 };
    return {
      ok: true,
      next: {
        ...cur,
        requests: cur.requests.map((x) =>
          x.id === input.id ? { ...x, status: "rejected" as const, decidedBy: input.by, decidedAt: new Date().toISOString(), decisionNote: note.slice(0, 300) } : x,
        ),
      },
    };
  });
  return r.ok ? { ok: true } : r;
}

/* ─── A new loan ──────────────────────────────────────────── */

/**
 * Open a new loan (Accounts · approve, because it posts): a liability
 * account under 2 named "Vehicle Loan — …" (so Transport → Finance finds it
 * too), its terms, and the booking JV — Dr where the money went (1950
 * suspense for a dealer paid direct) + Dr 5090 the lender's charges / Cr the
 * new loan. The JV is idempotent on `<code>:booking`.
 */
export async function addLoan(input: {
  title: string;
  terms: unknown;
  chargesPaise: number;
  debitCode: string;
  by: string;
}): Promise<{ ok: true; code: string; voucherNo: string } | Fail> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable", status: 503 };
  const snap = await buildLoans();
  if (!snap.ok) return snap;
  const t0 = normalizeLoanTerms("new", input.terms);
  if (!t0) return { ok: false, error: "Enter the loan's terms", status: 400 };
  const title = String(input.title ?? "").trim().slice(0, 80);
  if (!title) return { ok: false, error: "Name the vehicle or purpose (e.g. TATA Magic UP65XX0000)", status: 400 };
  if (!t0.contractNo) return { ok: false, error: "Enter the lender's contract / loan number", status: 400 };
  if (snap.loans.some((l) => l.terms?.contractNo && l.terms.contractNo === t0.contractNo)) {
    return { ok: false, error: `Loan ${t0.contractNo} is already in the books`, status: 409 };
  }
  if (!(t0.sanctionedPaise > 0) || !isIsoDate(t0.sanctionedOn)) return { ok: false, error: "Enter the amount sanctioned and its date", status: 400 };
  if (t0.sanctionedOn > snap.today) return { ok: false, error: "The sanction date cannot be in the future", status: 400 };
  const charges = Math.max(0, Math.round(Number(input.chargesPaise) || 0));
  if (charges >= t0.sanctionedPaise) return { ok: false, error: "The charges cannot be the whole loan", status: 400 };
  const exists = (c: string) => snap.accounts.some((a) => a.code === c);
  if (!snap.accounts.some((a) => a.code === input.debitCode && a.kind === "asset" && !a.hasChildren)) {
    return { ok: false, error: "Choose where the loan money went (an asset account — 1950 suspense when the lender paid the dealer)", status: 400 };
  }
  if (t0.vehicleId && !snap.vehicles.some((v) => v.id === t0.vehicleId)) return { ok: false, error: "That vehicle is not in the fleet", status: 400 };

  // The account. Codes are re-read and a clash retried, never overwritten.
  let code = "";
  for (let attempt = 0; attempt < 5 && !code; attempt++) {
    const { data, error } = await ctx.sb.from("ledger_accounts").select("code").eq("tenant_id", ctx.tenantId);
    if (error) return { ok: false, error: error.message, status: 502 };
    const candidate = nextLoanCode(new Set(((data ?? []) as { code: string }[]).map((r) => String(r.code))));
    if (!candidate) return { ok: false, error: "No free loan codes left (2155–2199)", status: 409 };
    const lender = t0.lender.replace(/\s+Finance$/i, "") || t0.lender;
    const { error: insErr } = await ctx.sb.from("ledger_accounts").insert({
      tenant_id: ctx.tenantId,
      code: candidate,
      name: `Vehicle Loan — ${title} (${lender} ${t0.contractNo})`.slice(0, 160),
      parent_code: "2",
      kind: "liability",
      schedule_group: "Loans & borrowings",
    });
    if (!insErr) code = candidate;
    else if (!/duplicate|unique/i.test(insErr.message)) return { ok: false, error: insErr.message, status: 502 };
  }
  if (!code) return { ok: false, error: "Could not open the account — try again", status: 409 };

  const terms: LoanTerms = { ...t0, code, updatedAt: new Date().toISOString(), updatedBy: input.by };
  const problem = termsProblem(terms, exists);
  const saved = problem
    ? ({ ok: false, error: problem } as Fail)
    : await casUpdate(LOAN_TERMS_KEY, normalizeLoanTermsState, (cur) => ({ ok: true, next: { loans: { ...cur.loans, [code]: terms } } }));

  const { ledgerPost } = await import("@/lib/ledger/ledger.server");
  const lender = t0.lender || "the lender";
  const posted = await ledgerPost({
    voucherType: "journal",
    date: t0.sanctionedOn,
    narration: `New ${lender} loan ${t0.contractNo} for ${title}: ${rupees(t0.sanctionedPaise)} sanctioned ${t0.sanctionedOn}${charges ? `; ${rupees(charges)} loan charges deducted` : ""}.`.slice(0, 480),
    sourceType: LOAN_BOOKING_SOURCE,
    sourceId: `${code}:booking`,
    createdBy: input.by,
    lines: bookingLines({ code, sanctionedPaise: t0.sanctionedPaise, chargesPaise: charges, debitCode: input.debitCode }),
  });
  if (!posted.ok) return { ok: false, error: `Account ${code} was opened, but the books refused the booking: ${posted.error}. Fix it and post the booking from Vouchers.`, status: 422 };
  if (!saved.ok) return { ok: false, error: `Loan ${code} is booked (${posted.voucherNo}), but its terms were not saved: ${saved.error}. Save them under Terms.`, status: 207 };
  return { ok: true, code, voucherNo: posted.voucherNo };
}

/* ─── The daily tick ──────────────────────────────────────── */

/**
 * Staff who would be let through to approve: Accounts · approve (the module
 * or the Loans function) AND Accounts position · view (the screen shows
 * balances). null = roles unreadable — nobody is guessed at.
 */
export async function loanApproverStaffIds(): Promise<string[] | null> {
  const { ensureSchoolMirrorHydrated } = await import("@/lib/schoolDataMirror.server");
  await ensureSchoolMirrorHydrated();
  const { loadMasters } = await import("@/lib/masters");
  const { loadServerRbacIfKnown } = await import("@/lib/api/v1/auth");
  const { hasPermission, featureGrantHeld } = await import("@/lib/rbac");
  const { staffSessionFor } = await import("@/lib/erpCommands.server");
  const rbac = await loadServerRbacIfKnown();
  if (!rbac) return null;
  const masters = loadMasters();
  const out: string[] = [];
  for (const staff of masters.staff ?? []) {
    if (staff.status !== "active") continue;
    const session = staffSessionFor(staff, masters);
    const approve =
      hasPermission(session, masters, "accounts", "approve", rbac) || featureGrantHeld(session, masters, "accounts.loans", "approve", rbac);
    if (approve && hasPermission(session, masters, "accounts_position", "view", rbac)) out.push(staff.id);
  }
  return [...new Set(out)];
}

export type LoanTickResult = {
  ok: boolean;
  today: string;
  /** Everything awaiting approval now. */
  pending: { key: string; label: string; amountPaise: number }[];
  /** Of those, the ones approvers had not been told about. */
  newlyDue: string[];
  recipients: number;
  pushed: number;
  dryRun: boolean;
  error?: string;
};

export async function runLoanTick(opts: { dryRun: boolean; today?: string }): Promise<LoanTickResult> {
  const today = opts.today ?? istToday();
  const base: LoanTickResult = { ok: false, today, pending: [], newlyDue: [], recipients: 0, pushed: 0, dryRun: opts.dryRun };
  const snap = await buildLoans(today);
  if (!snap.ok) return { ...base, error: snap.error };
  const queue = await readLoanQueue();
  if (!queue) return { ...base, error: "Could not read the approvals" };
  const pending: LoanTickResult["pending"] = [];
  for (const l of snap.loans) {
    for (const p of l.computed.pending) {
      pending.push({ key: p.key, label: `${monthLabel(p.month)} EMI · ${l.vehicleLabel || l.name} · ₹${rupees(p.amountPaise)}`, amountPaise: p.amountPaise });
    }
  }
  for (const r of snap.requests) {
    if (r.status !== "pending") continue;
    pending.push({ key: `req:${r.id}`, label: `${r.kind === "prepayment" ? "Prepayment" : "Top-up"} · ${r.code} · ₹${rupees(r.amountPaise)}`, amountPaise: r.amountPaise });
  }
  const fresh = pending.filter((p) => !queue.state.notified[p.key]);
  const out = { ...base, ok: true, pending, newlyDue: fresh.map((p) => p.key) };
  if (fresh.length === 0 || opts.dryRun) return out;

  const ids = await loanApproverStaffIds();
  if (!ids) return { ...out, ok: false, error: "Roles could not be read — nobody was told; the next tick tries again" };
  let pushed = 0;
  try {
    const { sendPushToSubjects } = await import("@/lib/webPush.server");
    const total = fresh.reduce((n, p) => n + p.amountPaise, 0);
    const res = await sendPushToSubjects("staff", ids, {
      title: fresh.length === 1 ? "Loan payment awaiting approval" : `${fresh.length} loan payments awaiting approval`,
      body: `${fresh.slice(0, 4).map((p) => p.label).join("; ")}${fresh.length > 4 ? `; and ${fresh.length - 4} more` : ""}. Total ₹${rupees(total)}. Nothing is posted until approved.`.slice(0, 300),
      url: "/accounts?tab=loans",
      data: { kind: "loan_emi_approval" },
    });
    pushed = res.sent;
  } catch (e) {
    return { ...out, ok: false, recipients: ids.length, error: `Push failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  // Told once per loan-month: marked after the send, so a failed send is retried tomorrow.
  const at = new Date().toISOString();
  const marked = await casUpdate(LOAN_QUEUE_KEY, normalizeLoanQueue, (cur) => {
    const notified = { ...cur.notified };
    for (const p of fresh) notified[p.key] = at;
    return { ok: true, next: { ...cur, notified } };
  });
  return { ...out, recipients: ids.length, pushed, ok: marked.ok, ...(marked.ok ? {} : { error: `Sent, but not marked as told: ${marked.error}` }) };
}
