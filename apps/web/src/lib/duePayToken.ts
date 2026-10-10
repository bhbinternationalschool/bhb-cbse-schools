/**
 * The "pay your fee" link every parent message carries.
 *
 * WHY A LINK THAT MAKES THE CHECKOUT WHEN TAPPED
 * Until 14 Sep 2026 the fee reminders (1,126 sent that month) linked to the
 * parent portal login, and the bot's replies told parents to pay in GPay and
 * then come back and tap "Confirm paid" — while a live payment gateway sat
 * unused: three checkouts ever. A reminder cannot carry a gateway checkout
 * made in advance: an order per family per reminder is a hundred API calls
 * inside a tick that already runs near its time limit, and the amount would be
 * stale by the time a parent who paid half at the counter opened it.
 *
 * So the message carries a signed token naming the family (and the child, and
 * which dues), and /pay/due/<token> works out what is owed AT THAT MOMENT,
 * raises the link, attaches the gateway and redirects. Nothing is created for
 * a parent who never taps.
 *
 * The token is HMAC-signed so an id in a URL cannot be edited to open another
 * family's dues, and it expires. Paying someone else's fee is not a harm this
 * guards against; showing a stranger another child's dues is.
 *
 * Pure (no Node crypto import here) so the parts that build message text can
 * be tested; signing lives in duePayToken.server.ts.
 */

export type DuePayScope = "open" | "overdue";

export type DuePayPayload = {
  /** Household id. */
  h: string;
  /** One child; absent = every child in the household. */
  s?: string;
  /** "overdue" = only dues past their date; "open" = everything owed up to this month. */
  sc: DuePayScope;
  /** Unix seconds. */
  exp: number;
};

export const DUE_PAY_PATH = "/pay/due/";
export const DUE_PAY_TTL_DAYS = 30;

export function isDuePayPayload(v: unknown): v is DuePayPayload {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.h === "string" &&
    p.h.length > 0 &&
    (p.s === undefined || typeof p.s === "string") &&
    (p.sc === "open" || p.sc === "overdue") &&
    typeof p.exp === "number"
  );
}
