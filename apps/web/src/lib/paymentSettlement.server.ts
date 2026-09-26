/**
 * Settle a payment link and optionally send WhatsApp fee receipt.
 */

import { applyPaymentLink } from "@/lib/payments";
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
  if (!pushed.ok) {
    // The money IS collected in memory and the caller is about to be told so.
    // Say loudly that it did not reach the desk, rather than returning an
    // error that would make a gateway retry and collect it twice.
    console.error(
      "[paymentSettlement] voucher not pushed to the fee desk",
      { linkId: opts.linkId, receiptNo: result.receiptNo, error: pushed.error },
    );
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
