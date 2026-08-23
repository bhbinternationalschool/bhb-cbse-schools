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

  const auth = await requireStaffPermission(
    req,
    "accounts",
    needsApproval ? "approve" : "edit",
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
    case "parity": {
      const res = await ledgerParityAgainstDesk(body.deskRows ?? []);
      return NextResponse.json(res);
    }
    default:
      return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  }
}
