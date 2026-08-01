/**
 * Settle a payment link and optionally send WhatsApp fee receipt.
 */

import { applyPaymentLink } from "@/lib/payments";
import { ensureSchoolMirrorLoaded } from "@/lib/schoolDataMirror.server";
import { householdWhatsApp, loadSis } from "@/lib/sis";
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
  await ensureSchoolMirrorLoaded();
  const result = applyPaymentLink({
    linkId: opts.linkId,
    cashierName: opts.cashierName,
    upiRef: opts.upiRef,
    collectionDate: opts.collectionDate,
  });
  if (!result.ok) return result;

  let whatsappReceipt: { ok: boolean; error?: string } | null = null;
  if (opts.sendWhatsApp !== false) {
    const sis = loadSis();
    const hh = sis.households.find((h) => h.id === result.link.householdId);
    const mobile = hh ? householdWhatsApp(hh) || hh.mobile || "" : "";
    if (mobile) {
      whatsappReceipt = await sendSisFeeReceiptOnWhatsApp({
        mobile,
        voucherId: result.voucherId,
      });
    }
  }

  return { ...result, whatsappReceipt };
}
