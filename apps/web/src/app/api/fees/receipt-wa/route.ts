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

  const body = (await req.json().catch(() => ({}))) as {
    voucherId?: string;
    /**
     * A person pressing "Send WhatsApp" on the receipt, deliberately, after
     * the automatic one failed or the family says it never came. Skips the
     * already-sent guard — that guard exists to stop machines repeating
     * themselves, not to stop the office answering a parent.
     */
    force?: boolean;
  };
  const voucherId = (body.voucherId || "").trim();
  if (!voucherId) {
    return NextResponse.json(
      { ok: false, error: "voucherId is required" },
      { status: 400 },
    );
  }

  /*
    WAIT for the receipt to arrive, do not just miss it.

    The counter writes the receipt to localStorage and pushes on a DEBOUNCE,
    then calls this immediately — so on 2026-09-09 the server looked for two
    real receipts that had not been pushed yet, returned 404, and no send was
    ever attempted or recorded. Nothing was wrong with the money and nothing
    told anybody: `wa_receipt_sends` was simply empty.

    Polling here rather than retrying from the browser, because the tab can
    be closed or navigated away while the push is still in flight, and the
    family should still get their receipt.
  */
  let voucher: Awaited<ReturnType<typeof loadFeeContext>>["fees"]["vouchers"][number] | undefined;
  let sis: Awaited<ReturnType<typeof loadFeeContext>>["sis"] | undefined;
  const deadline = Date.now() + 20_000;
  for (let attempt = 0; ; attempt += 1) {
    const ctx = await loadFeeContext();
    sis = ctx.sis;
    voucher = ctx.fees.vouchers.find((v) => v.id === voucherId);
    if (voucher || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, attempt === 0 ? 1500 : 3000));
  }
  if (!voucher || !sis) {
    return NextResponse.json(
      {
        ok: true,
        sent: false,
        reason:
          "The receipt has not reached the server yet, so it was not sent. " +
          "Open the receipt and press Send WhatsApp once it has synced.",
      },
      { status: 200 },
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
    force: body.force === true,
  });

  return NextResponse.json(
    r.sent
      ? { ok: true, sent: true, mobile: r.mobile }
      : { ok: true, sent: false, reason: r.reason, alreadySent: !!r.alreadySent },
  );
}
