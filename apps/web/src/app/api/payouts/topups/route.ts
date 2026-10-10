/**
 * Cashfree Payouts wallet top-ups (director, 10 Oct 2026: "debit would be our
 * union bank account and credit would be wallet").
 *
 * The money leaves a school bank (the Union Bank statement shows a debit) and
 * lands in the wallet. In the books: Dr 1110 Cashfree Payouts Wallet /
 * Cr that bank — a transfer between the school's own accounts, not an expense.
 *
 * GET   recent top-ups, the banks to choose from, and the wallet as the books
 *       see it beside what Cashfree says it holds
 * POST  {amountPaise, date, bankLedgerCode, reference, note?}
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { listTopups, recordTopup, topupBanks, walletBookBalancePaise } from "@/lib/payoutRequests.server";
import { payoutBalance, payoutKeysPresent } from "@/lib/payouts.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "accounts", "view");
  if (!auth.ok) return auth.response;
  const [topups, banks, book, live] = await Promise.all([
    listTopups(),
    topupBanks(),
    walletBookBalancePaise(),
    payoutKeysPresent() ? payoutBalance() : Promise.resolve(null),
  ]);
  return NextResponse.json({
    ok: true,
    topups,
    banks,
    // null = could not be read — never shown as zero.
    bookPaise: book,
    cashfreePaise: live && live.ok ? live.availablePaise : null,
  });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "accounts", "approve");
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret) return NextResponse.json({ ok: false, error: "Top-ups are recorded by a person" }, { status: 403 });
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const r = await recordTopup({
    amountPaise: Math.round(Number(b.amountPaise) || 0),
    date: String(b.date || ""),
    bankLedgerCode: String(b.bankLedgerCode || ""),
    reference: String(b.reference || ""),
    note: String(b.note || ""),
    by: auth.ctx.session.fullName || auth.ctx.session.email || "accounts",
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
