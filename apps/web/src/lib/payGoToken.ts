/**
 * The one variable a WhatsApp "Pay now" button can carry.
 *
 * Meta allows a template button URL exactly one variable, and only at the
 * end. Opening a payment link publicly needs TWO things — the link id and
 * its short code (the code is what authorises a parent who is not signed in
 * to the portal) — so both travel as one token, `<linkId>.<code>`, and
 * /pay/go/<token> unpacks it into the pay page's own query string.
 *
 * Link ids are `pl_` + base-36 (no dots); codes are `PL-` + four letters or
 * digits. The last dot is the separator, so a token with no dot is not one.
 */
export type PayGoToken = { linkId: string; code: string };

export const PAY_GO_PATH = "/pay/go/";

export function buildPayGoToken(link: { id: string; code: string }): string {
  return `${link.id}.${link.code}`;
}

export function parsePayGoToken(raw: string): PayGoToken | null {
  const token = decodeURIComponent((raw || "").trim());
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const linkId = token.slice(0, dot);
  const code = token.slice(dot + 1).toUpperCase();
  if (!/^[a-z0-9_-]{3,64}$/i.test(linkId)) return null;
  if (!/^PL-[A-Z0-9]{4,8}$/.test(code)) return null;
  return { linkId, code };
}

/** Where /pay/go sends the parent. */
export function payGoRedirectPath(t: PayGoToken): string {
  const q = new URLSearchParams({ linkId: t.linkId, code: t.code });
  return `/pay/share?${q.toString()}`;
}
