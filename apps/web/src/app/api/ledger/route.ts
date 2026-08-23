/**
 * Ledger v2 — the only door into the server book from the app.
 *
 * GET  returns the trial balance, sub-ledger balances and recent vouchers.
 * POST performs one action: post, reverse, mirror, lock, open-balances,
 *      close-year or ensure-masters.
 *
 * Reads need `accounts:view`, writes need `accounts:edit`, except the
 * destructive-by-nature ones (lock, close, opening balances) which additionally
 * require `approve` — those are decisions, not data entry.
 */

import { NextResponse } from "next/server";
import {
  requireStaffPermission,
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import {
  ensureLedgerMasters,
  ledgerCloseFiscalYear,
  ledgerLockPeriod,
  ledgerOpenBalances,
  ledgerParityAgainstDesk,
  ledgerPost,
  ledgerRecentVouchers,
  ledgerReverse,
  ledgerSubledgerBalances,
  ledgerTrialBalance,
} from "@/lib/ledger/ledger.server";
import { ledgerReconciliation, projectAll } from "@/lib/ledger/project.server";
import {
  accountStatement,
  balanceSheetReport,
  caYearEndPack,
  incomeExpenditureReport,
  packToCsvBundle,
  receiptsPaymentsReport,
  trialBalanceReport,
} from "@/lib/ledger/reports.server";
import {
  applyManualMatch,
  autoMatchBank,
  bankReconciliationReport,
  importBankStatementCsv,
  proposeChequeClearings,
  unmatch,
} from "@/lib/ledger/reconcile.server";
import type { LedgerVoucherInput } from "@/lib/ledger/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(
    req,
    SCHOOL_DATA_DESK_RBAC["accounts-desk"]!,
    "GET",
  );
  if (!auth.ok) return auth.response;

  const [tb, subledgers, vouchers] = await Promise.all([
    ledgerTrialBalance(),
    ledgerSubledgerBalances(),
    ledgerRecentVouchers(50),
  ]);

  const totalDebit = tb.rows.reduce((n, r) => n + r.closingDebitPaise, 0);
  const totalCredit = tb.rows.reduce((n, r) => n + r.closingCreditPaise, 0);

  return NextResponse.json({
    ok: tb.ok,
    error: tb.error,
    trialBalance: tb.rows,
    subledgers,
    vouchers,
    totals: { totalDebit, totalCredit, balanced: totalDebit === totalCredit },
  });
}

type PostBody =
  | { action: "post"; voucher: LedgerVoucherInput }
  | { action: "mirror"; voucher: LedgerVoucherInput }
  | { action: "reverse"; voucherId: string; reason?: string; date?: string }
  | { action: "lock"; period: string; status: "open" | "locked" | "closed"; note?: string }
  | {
      action: "open-balances";
      fyCode: string;
      rows: { accountCode: string; debitPaise: number; creditPaise: number }[];
    }
  | { action: "close-year"; fyCode: string; surplusAccountCode?: string }
  | { action: "ensure-masters" }
  | { action: "project"; limit?: number }
  | { action: "reconcile" }
  | {
      action: "import-statement";
      bankSubledgerId: string;
      statementRef?: string;
      csv: string;
      openingBalancePaise?: number | null;
      closingBalancePaise?: number | null;
    }
  | { action: "auto-match"; bankSubledgerId: string; asOf?: string; applyAuto?: boolean }
  | { action: "match"; statementLineId: string; ledgerLineId: string; note?: string }
  | { action: "unmatch"; statementLineId: string }
  | {
      action: "bank-recon";
      bankSubledgerId: string;
      asOf: string;
      statementClosingPaise?: number | null;
    }
  | { action: "cheque-clearings"; bankSubledgerId: string; asOf?: string }
  | { action: "trial-balance"; from: string; to: string }
  | { action: "income-expenditure"; from: string; to: string }
  | { action: "balance-sheet"; from: string; to: string }
  | { action: "receipts-payments"; from: string; to: string }
  | { action: "account-statement"; code: string; from: string; to: string }
  | { action: "ca-pack"; fyCode: string; from: string; to: string; csv?: boolean }
  | { action: "parity"; deskRows: { code: string; balancePaise: number }[] };

export async function POST(req: Request) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  // Locking a period, loading opening balances and closing a year are
  // decisions about the book, not data entry — they need approval rights.
  const needsApproval =
    body.action === "lock" ||
    body.action === "close-year" ||
    body.action === "open-balances" ||
    // Projection writes vouchers for every desk record it can see. It is
    // idempotent and safe to repeat, but it is still a bulk write to the book.
    body.action === "project";

  // Reports read the book and change nothing, so they need only view rights —
  // which is what makes a read-only auditor login possible at all. Requiring
  // `edit` here would force anyone reviewing the accounts to hold rights to
  // alter them.
  const readOnly = new Set([
    "trial-balance",
    "income-expenditure",
    "balance-sheet",
    "receipts-payments",
    "account-statement",
    "ca-pack",
    "reconcile",
    "parity",
    "bank-recon",
    "cheque-clearings",
  ]);

  const auth = await requireStaffPermission(
    req,
    "accounts",
    needsApproval ? "approve" : readOnly.has(body.action) ? "view" : "edit",
  );
  if (!auth.ok) return auth.response;

  const actor =
    auth.ctx.session.fullName || auth.ctx.session.email || auth.ctx.session.roleCode || "";

  switch (body.action) {
    case "ensure-masters": {
      const res = await ensureLedgerMasters();
      return NextResponse.json(res, { status: res.ok ? 200 : 502 });
    }
    case "post":
    case "mirror": {
      const res = await ledgerPost({ ...body.voucher, createdBy: body.voucher.createdBy || actor });
      return NextResponse.json(res, { status: res.ok ? 200 : 422 });
    }
    case "reverse": {
      const res = await ledgerReverse({
        voucherId: body.voucherId,
        reason: body.reason,
        date: body.date,
        createdBy: actor,
      });
      return NextResponse.json(res, { status: res.ok ? 200 : 422 });
    }
    case "lock": {
      const res = await ledgerLockPeriod({
        period: body.period,
        status: body.status,
        actor,
        note: body.note,
      });
      return NextResponse.json(res, { status: res.ok ? 200 : 422 });
    }
    case "open-balances": {
      const res = await ledgerOpenBalances({
        fyCode: body.fyCode,
        rows: body.rows,
        createdBy: actor,
      });
      return NextResponse.json(res, { status: res.ok ? 200 : 422 });
    }
    case "close-year": {
      const res = await ledgerCloseFiscalYear({
        fyCode: body.fyCode,
        surplusAccountCode: body.surplusAccountCode,
        actor,
      });
      return NextResponse.json(res, { status: res.ok ? 200 : 422 });
    }
    case "project": {
      const res = await projectAll({ limit: body.limit });
      return NextResponse.json(res, { status: res.ok ? 200 : 207 });
    }
    case "reconcile": {
      const res = await ledgerReconciliation();
      return NextResponse.json(res, { status: res.ok ? 200 : 207 });
    }
    case "import-statement": {
      const res = await importBankStatementCsv({
        bankSubledgerId: body.bankSubledgerId,
        statementRef: body.statementRef ?? "",
        csv: body.csv,
        openingBalancePaise: body.openingBalancePaise,
        closingBalancePaise: body.closingBalancePaise,
        importedBy: actor,
      });
      return NextResponse.json(res, { status: res.ok ? 200 : 422 });
    }
    case "auto-match": {
      const res = await autoMatchBank({
        bankSubledgerId: body.bankSubledgerId,
        asOf: body.asOf,
        matchedBy: actor || "auto",
        applyAuto: body.applyAuto,
      });
      return NextResponse.json(res, { status: res.ok ? 200 : 422 });
    }
    case "match": {
      const res = await applyManualMatch({
        statementLineId: body.statementLineId,
        ledgerLineId: body.ledgerLineId,
        matchedBy: actor,
        note: body.note,
      });
      return NextResponse.json(res, { status: res.ok ? 200 : 422 });
    }
    case "unmatch": {
      const res = await unmatch(body.statementLineId);
      return NextResponse.json(res, { status: res.ok ? 200 : 422 });
    }
    case "bank-recon": {
      const res = await bankReconciliationReport({
        bankSubledgerId: body.bankSubledgerId,
        asOf: body.asOf,
        statementClosingPaise: body.statementClosingPaise,
      });
      return NextResponse.json(res, { status: res.ok ? 200 : 422 });
    }
    case "cheque-clearings": {
      const res = await proposeChequeClearings({
        bankSubledgerId: body.bankSubledgerId,
        asOf: body.asOf,
      });
      return NextResponse.json(res, { status: res.ok ? 200 : 422 });
    }
    case "trial-balance": {
      const res = await trialBalanceReport({ from: body.from, to: body.to });
      return NextResponse.json(res, { status: res.ok ? 200 : 422 });
    }
    case "income-expenditure": {
      const res = await incomeExpenditureReport({ from: body.from, to: body.to });
      return NextResponse.json(res, { status: res.ok ? 200 : 422 });
    }
    case "balance-sheet": {
      const res = await balanceSheetReport({ from: body.from, to: body.to });
      return NextResponse.json(res, { status: res.ok ? 200 : 422 });
    }
    case "receipts-payments": {
      const res = await receiptsPaymentsReport({ from: body.from, to: body.to });
      return NextResponse.json(res, { status: res.ok ? 200 : 422 });
    }
    case "account-statement": {
      const res = await accountStatement({ code: body.code, from: body.from, to: body.to });
      return NextResponse.json(res, { status: res.ok ? 200 : 422 });
    }
    case "ca-pack": {
      const pack = await caYearEndPack({
        fyCode: body.fyCode,
        from: body.from,
        to: body.to,
      });
      // `ok` here means the pack is fit to hand over, not that the request
      // worked — an unready pack is still returned so the reasons can be read.
      return NextResponse.json(
        body.csv ? { ...pack, csv: packToCsvBundle(pack) } : pack,
        { status: 200 },
      );
    }
    case "parity": {
      const res = await ledgerParityAgainstDesk(body.deskRows ?? []);
      return NextResponse.json(res);
    }
    default:
      return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  }
}
