import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  ensureBeneficiary,
  fetchTransferStatus,
  getPayout,
  payoutBalance,
  payoutKeysPresent,
  payoutsArmed,
  payoutsForPeriod,
  requestPayoutTransfer,
  sandboxProbe,
} from "@/lib/payouts.server";
import { payoutSentence, payoutTransferId, readPayoutStatus } from "@/lib/payouts";

export const runtime = "nodejs";

/**
 * Sending money out of the school, and knowing what became of it.
 *
 * GET  ?kind=sal&period=2026-09   every transfer for a payroll month
 *      ?transferId=…              one transfer, re-asked from Cashfree if open
 *      ?balance=1                 what is left in the prefunded wallet
 *      ?probe=1                   confirm the request shapes against sandbox
 * POST {kind, subjectId, period, amountPaise, name, accountNumber, ifsc, remarks}
 *
 * WHY POST IS GATED ON `payroll: approve`. A transfer sends money the school
 * cannot pull back. That is not the same authority as entering a payroll run,
 * so it sits behind the permission that already means "release this money".
 *
 * WHY NOTHING HERE PAYS A WHOLE RUN. Salary is still paid by the NEFT bank
 * file. The Payouts V2 request shapes have not been confirmed against a live
 * call — the build container has no Payouts credentials — so `payoutsArmed`
 * refuses every transfer until somebody runs the sandbox probe and sets the
 * flag deliberately. A loop over thirty staff members is the last thing to
 * build here, not the first.
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "payroll", "view");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") || "").trim();
  const period = (url.searchParams.get("period") || "").trim();
  const transferId = (url.searchParams.get("transferId") || "").trim();

  if (url.searchParams.get("probe")) {
    // Read-only against sandbox. The evidence the arming flag waits for.
    return NextResponse.json({ ok: true, probe: await sandboxProbe() });
  }

  if (url.searchParams.get("balance")) {
    return NextResponse.json({ ok: true, configured: payoutKeysPresent(), balance: await payoutBalance() });
  }

  if (transferId) {
    const row = await getPayout(transferId);
    if (!row) return NextResponse.json({ ok: false, error: "No such transfer" }, { status: 404 });
    // Re-ask while it is still open. A status webhook that never arrives is a
    // real failure mode, and this is how a stuck transfer resolves.
    const status = readPayoutStatus(row.status);
    if (status === "UNKNOWN" || status === "PENDING" || status === "RECEIVED" || status === "APPROVAL_PENDING") {
      await fetchTransferStatus(transferId);
    }
    const fresh = (await getPayout(transferId)) ?? row;
    return NextResponse.json({ ok: true, transfer: fresh });
  }

  if (kind && period) {
    const rows = await payoutsForPeriod(kind, period);
    return NextResponse.json({
      ok: true,
      armed: payoutsArmed(),
      configured: payoutKeysPresent(),
      transfers: rows,
      // Counted here so a screen cannot get the arithmetic wrong: only SUCCESS
      // is paid, and REVERSED is unpaid again rather than merely "not success".
      summary: rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      }, {}),
    });
  }

  return NextResponse.json(
    { ok: false, error: "Pass kind and period, transferId, balance=1 or probe=1" },
    { status: 400 },
  );
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "payroll", "approve");
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const kind = String(body.kind ?? "sal").trim();
  const subjectId = String(body.subjectId ?? "").trim();
  const period = String(body.period ?? "").trim();
  const amountPaise = Math.round(Number(body.amountPaise));
  const name = String(body.name ?? "").trim();
  const accountNumber = String(body.accountNumber ?? "").trim();
  const ifsc = String(body.ifsc ?? "").trim();

  if (!subjectId || !period) {
    return NextResponse.json({ ok: false, error: "subjectId and period are required" }, { status: 400 });
  }
  if (!Number.isFinite(amountPaise) || amountPaise < 100) {
    return NextResponse.json({ ok: false, error: "A transfer must be at least ₹1" }, { status: 400 });
  }
  if (!name || !accountNumber || !ifsc) {
    return NextResponse.json(
      { ok: false, error: "name, accountNumber and ifsc are required to reach the beneficiary" },
      { status: 400 },
    );
  }

  const beneficiary = await ensureBeneficiary({
    beneficiaryId: `${kind}_${subjectId}`,
    name,
    accountNumber,
    ifsc,
    phone: String(body.phone ?? "").trim() || undefined,
  });
  if (!beneficiary.ok) return NextResponse.json(beneficiary, { status: 400 });

  // Derived, not accepted from the client. A caller-supplied transfer id would
  // let a retry become a second payment, which is the one thing the
  // determinism exists to prevent.
  const transferId = payoutTransferId({ kind, subjectId, period, amountPaise });

  const outcome = await requestPayoutTransfer({
    transferId,
    beneficiaryId: beneficiary.beneficiaryId,
    amountPaise,
    kind,
    subjectId,
    period,
    remarks: String(body.remarks ?? "").trim() || undefined,
    requestedBy: auth.ctx.session.fullName || "payroll desk",
  });

  if (!outcome.ok) {
    return NextResponse.json(
      {
        ...outcome,
        // Said plainly, because it is the difference between "try again" and
        // "do not touch this until you have checked".
        ...(outcome.needsStatusCheck
          ? { warning: "Do NOT send this again. Check the transfer's status first — it may already have gone out." }
          : {}),
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    transfer: outcome.transfer,
    message: outcome.view
      ? payoutSentence(outcome.view)
      : "Already sent — this transfer was not re-sent.",
  });
}
