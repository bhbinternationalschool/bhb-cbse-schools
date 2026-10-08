/**
 * Is an online gateway supposed to be taking this payment — and saying so,
 * loudly, when it refuses.
 *
 * From 28 Sep to 8 Oct 2026 Cashfree answered every order with "authentication
 * Failed" (the keys had been regenerated; production still held the old
 * secret). Nothing logged it. Each fee path took the refusal as "no gateway"
 * and sent the parent to the old UPI QR / GPay page, so for ten days not one
 * fee reached the gateway, families retried the same ₹19,300 nine times, and
 * the only sign was a parent saying the app "opens the old QR".
 *
 * So: the UPI page is what a school WITHOUT a gateway uses. A school WITH one
 * whose gateway refuses gets the refusal logged under one greppable tag and
 * the parent told plainly that online payment is unavailable right now —
 * never a quiet change of payment method.
 */

import "server-only";
import { shouldUseCashfreeCheckout } from "@/lib/cashfree.server";
import { shouldUseRazorpayCheckout } from "@/lib/razorpay.server";

/** True when a gateway is configured, so a failed attach is an outage, not a mode. */
export function onlineGatewayExpected(): boolean {
  return shouldUseCashfreeCheckout() || shouldUseRazorpayCheckout();
}

/** The tag every gateway refusal is logged under — search the logs for it. */
export const GATEWAY_REFUSED_TAG = "[gateway] checkout refused";

export function logGatewayRefusal(where: string, linkId: string, error: string): void {
  console.error(GATEWAY_REFUSED_TAG, JSON.stringify({ where, linkId, error }));
}

/** What a parent is told instead of being handed a different way to pay. */
export const GATEWAY_UNAVAILABLE_EN =
  "Online payment is not available right now. Please try again in a little while, or pay at the school office.";
export const GATEWAY_UNAVAILABLE_HI =
  "ऑनलाइन भुगतान अभी उपलब्ध नहीं है। कृपया थोड़ी देर बाद फिर से कोशिश करें, या स्कूल कार्यालय में भुगतान करें।";
