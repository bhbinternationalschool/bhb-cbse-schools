/**
 * Settle a payment link and optionally send WhatsApp fee receipt.
 */

import { applyPaymentLink, resolveOpenLinesForLink } from "@/lib/payments";
import { ensurePaymentLinkHydrated } from "@/lib/paymentsPersistence";
import { recordPaymentGatewayEvent } from "@/lib/paymentsNormalized.server";
import { feeVoucherExistsInDb } from "@/lib/feesNormalized.server";
import { loadFees } from "@/lib/fees";
import { pushFeesRemoteServer } from "@/lib/feesPersistence.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { householdWhatsApp, loadSis } from "@/lib/sis";

export async function settlePaymentLinkWithWhatsApp(opts: {
  linkId: string;
  cashierName: string;
  upiRef?: string;
  collectionDate?: string;
  sendWhatsApp?: boolean;
  /**
   * What the gateway actually took, in paise. When given, the receipt must
   * come to exactly this or nothing is booked. See the amount check below.
   */
  expectedAmountPaise?: number;
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
  const link = await ensurePaymentLinkHydrated(opts.linkId, {
    authoritative: true,
  });
  if (!link) {
    return { ok: false, error: "Pay-link not found" };
  }

  // A PAY-LINK IS SETTLED AGAINST DUES AS THEY STAND NOW, NOT AS THEY WERE.
  //
  // resolveOpenLinesForLink drops any line whose live due it cannot see, and
  // transport dues live in their own module memory that hydrates separately
  // from the school mirror. On an instance where that memory is empty the
  // transport line simply vanishes and the receipt comes to less than the
  // parent paid.
  //
  // That is not hypothetical. At 07:54 UTC on 26 Sep 2026 this path resolved
  // ₹2,000 of AADVIK SINGH's ₹2,500 and wrote that figure onto the pay-link.
  // Had the voucher reached the database, the school would have booked ₹2,000
  // against a ₹2,500 payment: one head still unpaid, the family still chased
  // for it, and the bank ₹500 out. A receipt that is quietly wrong is worse
  // than one that is missing — the missing one is still recoverable.
  //
  // So the dues inputs are forced fresh BEFORE anything is resolved.
  try {
    const { ensureFeeDuesInputsHydrated } = await import(
      "@/lib/feeDuesInputs.server"
    );
    await ensureFeeDuesInputsHydrated({ force: true });
  } catch (e) {
    console.warn(
      "[paymentSettlement] dues inputs hydrate failed",
      e instanceof Error ? e.message : e,
    );
  }

  // And then the total is checked against what the gateway actually took.
  // Short by any amount: book nothing, say why, and let the claim go so a
  // retry on a properly hydrated instance can still collect it. Money left
  // in clearing with a readable reason beats a receipt that is wrong.
  if (typeof opts.expectedAmountPaise === "number" && opts.expectedAmountPaise > 0) {
    const resolved = resolveOpenLinesForLink(link);
    if ("error" in resolved) return { ok: false, error: resolved.error };
    if (resolved.amountPaise !== opts.expectedAmountPaise) {
      const detail =
        `resolved ${resolved.amountPaise} paise over ${resolved.lines.length} line(s) ` +
        `but the gateway took ${opts.expectedAmountPaise}`;
      console.error("[paymentSettlement] amount mismatch — nothing booked", {
        linkId: opts.linkId,
        detail,
      });
      await recordPaymentGatewayEvent({
        paymentLinkId: opts.linkId,
        provider: "cashfree",
        eventType: "fee_link.amount_mismatch",
        settlementStatus: "failed",
        amountPaise: opts.expectedAmountPaise,
        eventJson: {
          error: detail,
          resolvedPaise: resolved.amountPaise,
          expectedPaise: opts.expectedAmountPaise,
          dueKeys: resolved.lines.map((l) => l.dueKey),
        },
      }).catch(() => {});
      return {
        ok: false,
        error:
          `Dues do not add up to the amount paid (${detail}). Nothing was booked — ` +
          `the payment can be settled again once the dues are readable.`,
      };
    }
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

  // THE APPROVED TEMPLATE, NOT PLAIN TEXT.
  //
  // Meta delivers a free-form message only inside the 24-hour window that
  // opens when a parent writes to the school. Paying a link does not open
  // it, so a family who had not messaged the school that day got nothing —
  // and the failure was swallowed here exactly as a lost voucher was.
  //
  // The counter has used the approved `fees_receipt` template since the
  // button was replaced (see feeReceiptAutoWa.server.ts, which was written
  // for this very reason); the gateway path was left behind on the old
  // plain-text sender. It sends the same template now, in the family's own
  // language, and records the outcome per receipt so a retry or a replayed
  // webhook cannot message a family twice about the same money.
  let whatsappReceipt: { ok: boolean; error?: string } | null = null;
  if (opts.sendWhatsApp !== false) {
    const sis = loadSis();
    const hh = sis.households.find((h) => h.id === result.link.householdId);
    const mobile = hh ? householdWhatsApp(hh) || hh.mobile || "" : "";
    if (mobile) {
      // The voucher collectPayment just wrote, for its lines and total.
      const voucher = loadFees().vouchers.find((v) => v.id === result.voucherId);
      if (!voucher) {
        whatsappReceipt = { ok: false, error: "Receipt not found to send" };
      } else {
        const studentNames = [...new Set(voucher.lines.map((l) => l.studentId))]
          .map((id) => sis.students.find((st) => st.id === id)?.fullName || "")
          .filter(Boolean);
        const { sendFeeReceiptWhatsApp } = await import(
          "@/lib/feeReceiptAutoWa.server"
        );
        const sent = await sendFeeReceiptWhatsApp({
          voucher,
          mobile,
          studentNames,
        });
        whatsappReceipt = sent.sent
          ? { ok: true }
          : { ok: false, error: sent.reason };
      }
    }
  }

  return { ...result, whatsappReceipt };
}
