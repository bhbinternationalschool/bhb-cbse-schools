/**
 * Settle a payment link and optionally send WhatsApp fee receipt.
 */

import { applyPaymentLink } from "@/lib/payments";
import { ensurePaymentLinkHydrated } from "@/lib/paymentsPersistence";
import { recordPaymentGatewayEvent } from "@/lib/paymentsNormalized.server";
import { feeVoucherExistsInDb } from "@/lib/feesNormalized.server";
import { loadFees } from "@/lib/fees";
import { pushFeesRemoteServer } from "@/lib/feesPersistence.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { householdWhatsApp, loadSis, normalizeMobile } from "@/lib/sis";
import { sendSisFeeReceiptOnWhatsApp } from "@/lib/waSisBotServer";

export async function settlePaymentLinkWithWhatsApp(opts: {
  linkId: string;
  cashierName: string;
  upiRef?: string;
  collectionDate?: string;
  sendWhatsApp?: boolean;
}): Promise<
  | ({
      ok: true;
      receiptNo: string;
      voucherId: string;
      link: import("@/lib/payments").PaymentLink;
      whatsappReceipt: { ok: boolean; error?: string } | null;
    })
  | { ok: false; error: string }
> {
  // Hydrated from the database, not the local mirror file (absent on Cloud
  // Run): a webhook landing on a freshly started instance otherwise finds no
  // payment link and a parent's money is not booked.
  await ensureSchoolMirrorHydrated();

  // The mirror above is a cache, and a stale one still answers "no such
  // link" — which `applyPaymentLink` can only report as a failure to book
  // money the gateway has already taken. Re-read this one link from the
  // desk table when the mirror does not have it.
  if (!(await ensurePaymentLinkHydrated(opts.linkId))) {
    return { ok: false, error: "Pay-link not found" };
  }

  const result = applyPaymentLink({
    linkId: opts.linkId,
    cashierName: opts.cashierName,
    upiRef: opts.upiRef,
    collectionDate: opts.collectionDate,
  });
  if (!result.ok) return result;

  // THE DESK IS NOT THE DATABASE UNTIL SOMEBODY PUSHES IT.
  //
  // `collectPayment` writes the voucher through `saveFees`, which on the
  // server sets the in-memory mirror slice and returns — a browser pushes its
  // own edits, and a payment gateway webhook has no browser. So the receipt
  // lived in one Cloud Run instance's memory and died with it.
  //
  // On 26 Sep 2026 AADVIK SINGH's father paid ₹2,500 by pay-link. Receipt
  // RCV-00648 was allocated and reported as settled; no voucher was ever
  // written, the WhatsApp receipt below had nothing to send, and the family
  // still read as owing the money they had just paid.
  //
  // `api/v1/staff/fees/collect` has always pushed by hand after a counter
  // collection, which is why counter receipts survive and gateway ones did
  // not. This is the same line, on the path a gateway actually takes.
  //
  // AWAITED, not fired and forgotten: the webhook's reply must not outrun the
  // write, because Cloud Run stops giving this instance CPU once it answers.
  const pushed = await pushFeesRemoteServer(loadFees());

  // TRUST THE TABLE, NOT THE RETURN VALUE.
  //
  // On 26 Sep 2026 the settlement reported "paid, receipt RCV-00648" three
  // times while `fee_desk_vouchers` never gained a row: the push is refused
  // as a whole if any stored header holds a value Postgres cannot parse, and
  // the only account of it went to console.error — which on this Cloud Run
  // service does not reach Cloud Logging at all. Three diagnostic rounds
  // found the shape of the failure and never its message.
  //
  // So the voucher is read back, and whatever happened is written where it
  // CAN be read: payment_desk_gateway_events, beside the settlement it
  // belongs to. A lost receipt must never again be invisible.
  const stored = await feeVoucherExistsInDb(result.voucherId);
  if (!pushed.ok || stored === false) {
    console.error(
      "[paymentSettlement] voucher not pushed to the fee desk",
      {
        linkId: opts.linkId,
        receiptNo: result.receiptNo,
        voucherId: result.voucherId,
        error: pushed.error,
        readBack: stored,
      },
    );
    // Recorded, never returned as an error: returning one would make the
    // gateway retry and collect the money a second time.
    await recordPaymentGatewayEvent({
      paymentLinkId: opts.linkId,
      provider: "cashfree",
      eventType: "fee_link.voucher_push_failed",
      settlementStatus: "failed",
      receiptNo: result.receiptNo,
      voucherId: result.voucherId,
      eventJson: {
        error: pushed.error || "voucher absent from fee_desk_vouchers after push",
        readBack: stored,
        pushOk: pushed.ok,
      },
    }).catch(() => {});
  }

  let whatsappReceipt: { ok: boolean; error?: string } | null = null;
  if (opts.sendWhatsApp !== false) {
    const sis = loadSis();
    const hh = sis.households.find((h) => h.id === result.link.householdId);
    const mobile = hh ? householdWhatsApp(hh) || hh.mobile || "" : "";
    const fallbackMobile = hh ? normalizeMobile(hh.altMobile || "") : "";
    if (mobile) {
      whatsappReceipt = await sendSisFeeReceiptOnWhatsApp({
        mobile,
        fallbackMobile: fallbackMobile || undefined,
        voucherId: result.voucherId,
      });
    }
  }

  return { ...result, whatsappReceipt };
}
