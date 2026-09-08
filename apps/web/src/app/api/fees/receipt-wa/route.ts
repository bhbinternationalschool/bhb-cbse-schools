import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { loadFeeContext, householdContact } from "@/lib/api/v1/staffFees";
import { sendFeeReceiptWhatsApp } from "@/lib/feeReceiptAutoWa.server";

export const runtime = "nodejs";

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
