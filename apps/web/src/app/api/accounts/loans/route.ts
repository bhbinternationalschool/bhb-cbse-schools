/**
 * Accounts → Loans (and Transport → Finance → Vehicle loans).
 *
 * GET   every loan account from Ledger v2: terms, history with running
 *       balance, EMIs awaiting approval, the projection to the end, and the
 *       open prepayment / top-up requests (lib/loans.server.ts).
 * POST  { action, … }
 *         save-terms                       Accounts · edit
 *         request (prepayment | top-up)    Accounts · edit
 *         approve-emi, skip-emi, reopen-emi,
 *         approve-request, reject-request,
 *         add-loan                         Accounts · approve
 *
 * Every action also needs Accounts position · view: a loan's balance is a
 * position figure (the rule /api/transport/vehicle-loans and the account
 * statement follow). Approving is the only thing that posts; nothing is
 * posted by a GET or by the daily tick.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { featureGrantHeld, hasPermission, type RbacAction } from "@/lib/rbac";
import { isPayMode, type EmiApproval, type LoanParty, type LoanRequestInput } from "@/lib/loans";
import {
  addLoan,
  approveEmi,
  approveLoanRequest,
  buildLoans,
  createLoanRequest,
  rejectLoanRequest,
  saveLoanTerms,
  skipEmi,
} from "@/lib/loans.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "accounts", "view");
  if (!auth.ok) return auth.response;
  const pos = await requireStaffPermission(req, "accounts_position", "view");
  if (!pos.ok) return pos.response;
  const r = await buildLoans();
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status ?? 502 });
  const can = (action: RbacAction) =>
    auth.viaMirrorSecret ||
    hasPermission(auth.ctx.session, auth.ctx.masters, "accounts", action, auth.ctx.rbac) ||
    featureGrantHeld(auth.ctx.session, auth.ctx.masters, "accounts.loans", action, auth.ctx.rbac);
  // The chart itself is not part of the answer — only the accounts the forms offer.
  const { accounts: _chart, ...body } = r;
  void _chart;
  return NextResponse.json({ ...body, canEdit: can("edit"), canApprove: can("approve") }, { headers: { "cache-control": "no-store" } });
}

const APPROVE_ACTIONS = new Set(["approve-emi", "skip-emi", "reopen-emi", "approve-request", "reject-request", "add-loan"]);
const EDIT_ACTIONS = new Set(["save-terms", "request"]);

function int(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}
function party(v: unknown): LoanParty | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const externalId = String(r.externalId ?? "").trim();
  if (!externalId) return null;
  return { kind: "vendor", externalId: externalId.slice(0, 120), name: String(r.name ?? externalId).trim().slice(0, 120) };
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const action = String(body.action ?? "");
  const needed: RbacAction | null = APPROVE_ACTIONS.has(action) ? "approve" : EDIT_ACTIONS.has(action) ? "edit" : null;
  if (!needed) return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  const auth = await requireStaffPermission(req, "accounts", needed);
  if (!auth.ok) return auth.response;
  const pos = await requireStaffPermission(req, "accounts_position", "view");
  if (!pos.ok) return pos.response;
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "staff";
  const code = String(body.code ?? "").trim();
  const mode = isPayMode(body.mode) ? body.mode : null;

  let r: { ok: boolean; status?: number } & Record<string, unknown>;
  switch (action) {
    case "save-terms":
      r = await saveLoanTerms({ code, terms: body.terms, baseUpdatedAt: String(body.baseUpdatedAt ?? ""), by });
      break;
    case "approve-emi": {
      if (!mode) return NextResponse.json({ ok: false, error: "Choose how it was paid" }, { status: 400 });
      const a: EmiApproval = {
        code,
        month: String(body.month ?? ""),
        date: String(body.date ?? ""),
        amountPaise: int(body.amountPaise),
        principalPaise: int(body.principalPaise),
        interestPaise: int(body.interestPaise),
        accountCode: String(body.accountCode ?? "").trim(),
        mode,
        ref: String(body.ref ?? "").trim().slice(0, 80),
        party: party(body.party),
      };
      r = await approveEmi(a, by);
      break;
    }
    case "skip-emi":
    case "reopen-emi":
      r = await skipEmi({ code, month: String(body.month ?? ""), reason: String(body.reason ?? ""), by, reopen: action === "reopen-emi" });
      break;
    case "request": {
      if (!mode) return NextResponse.json({ ok: false, error: "Choose the mode" }, { status: 400 });
      const input: LoanRequestInput = {
        code,
        kind: body.kind === "topup" ? "topup" : "prepayment",
        date: String(body.date ?? ""),
        amountPaise: int(body.amountPaise),
        accountCode: String(body.accountCode ?? "").trim(),
        mode,
        ref: String(body.ref ?? "").trim().slice(0, 80),
        party: party(body.party),
        note: String(body.note ?? "").trim().slice(0, 300),
      };
      r = await createLoanRequest(input, by);
      break;
    }
    case "approve-request": {
      const e = (body.edits && typeof body.edits === "object" ? body.edits : {}) as Record<string, unknown>;
      r = await approveLoanRequest({
        id: String(body.id ?? ""),
        edits: {
          ...(e.date !== undefined ? { date: String(e.date) } : {}),
          ...(e.amountPaise !== undefined ? { amountPaise: int(e.amountPaise) } : {}),
          ...(e.accountCode !== undefined ? { accountCode: String(e.accountCode).trim() } : {}),
          ...(isPayMode(e.mode) ? { mode: e.mode } : {}),
          ...(e.ref !== undefined ? { ref: String(e.ref).trim() } : {}),
          ...(e.party !== undefined ? { party: party(e.party) } : {}),
        },
        by,
      });
      break;
    }
    case "reject-request":
      r = await rejectLoanRequest({ id: String(body.id ?? ""), note: String(body.note ?? ""), by });
      break;
    case "add-loan":
      r = await addLoan({
        title: String(body.title ?? ""),
        terms: body.terms,
        chargesPaise: int(body.chargesPaise) || 0,
        debitCode: String(body.debitCode ?? "").trim(),
        by,
      });
      break;
    default:
      return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  }
  return NextResponse.json(r, { status: r.ok ? 200 : (r.status ?? 422) });
}
