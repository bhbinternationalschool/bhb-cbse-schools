import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { loadFeeContext, householdContact } from "@/lib/api/v1/staffFees";
import { sendFeeReceiptWhatsApp } from "@/lib/feeReceiptAutoWa.server";
import { receiptSendStatuses } from "@/lib/waDeliveryStatus.server";

export const runtime = "nodejs";

/**
 * GET — what happened to the receipts the school messaged.
 *
 * `?voucherId=` for one receipt (the ticks beside a receipt on screen),
 * `?since=YYYY-MM-DD` for a day's worth (the desk view of who has opened
 * theirs). Meta's status webhook has been recording sent / delivered / read
 * for months and nothing in the ERP ever showed it, so "did that parent get
 * their receipt" had no answer short of asking them.
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "view");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const voucherId = (url.searchParams.get("voucherId") || "").trim();
  const since = (url.searchParams.get("since") || "").trim();

  const rows = await receiptSendStatuses({
    voucherIds: voucherId ? [voucherId] : undefined,
    // A bare date means midnight IST, which is the day the office means.
    sinceIso: since ? new Date(`${since}T00:00:00+05:30`).toISOString() : undefined,
    limit: voucherId ? 1 : 500,
  });

  return NextResponse.json({
    ok: true,
    receipts: rows,
    counts: rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.stage] = (acc[r.stage] ?? 0) + 1;
      return acc;
    }, {}),
  });
}

/**
 * Message a family their receipt, by voucher id.
 *
 * The staff app collects through `/api/v1/staff/fees/collect`, which sends
 * on its own. The web counter cannot: it builds the receipt in the browser
 * and then pushes the fee book, so the server never sees "a receipt was
 * created" as an event. Rather than have the server diff every push looking
 * for new vouchers — slow, and wrong the moment two counters push at once —
 * the counter says which receipt it just made.
 *
 * Idempotent by construction: `wa_receipt_sends` is keyed on the voucher, so
 * calling this twice, or after the app already sent, does nothing the second
 * time. That is what makes it safe to call from a browser that might retry.
 */
export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "create");
  if (!auth.ok) return auth.response;

  const body = (await req.json().catch(() => ({}))) as { voucherId?: string };
  const voucherId = (body.voucherId || "").trim();
  if (!voucherId) {
    return NextResponse.json(
      { ok: false, error: "voucherId is required" },
      { status: 400 },
    );
  }

  const { sis, fees } = await loadFeeContext();
  const voucher = fees.vouchers.find((v) => v.id === voucherId);
  if (!voucher) {
    // The push that carries the receipt may not have landed yet. Saying so
    // plainly beats a silent success the counter would read as "sent".
    return NextResponse.json(
      { ok: false, error: "Receipt not found on the server yet" },
      { status: 404 },
    );
  }

  const studentNames = [
    ...new Set(voucher.lines.map((l) => l.studentId)),
  ]
    .map((id) => sis.students.find((s) => s.id === id)?.fullName || "")
    .filter(Boolean);

  const r = await sendFeeReceiptWhatsApp({
    voucher,
    mobile: householdContact(sis, voucher.householdId).mobile,
    studentNames,
  });

  return NextResponse.json(
    r.sent
      ? { ok: true, sent: true, mobile: r.mobile }
      : { ok: true, sent: false, reason: r.reason, alreadySent: !!r.alreadySent },
  );
}
