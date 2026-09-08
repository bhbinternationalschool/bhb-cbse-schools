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

/**
 * The origin a redirect must carry.
 *
 * Behind Cloud Run, `req.url` is built from the server's bind address — the
 * first production redirect went to https://0.0.0.0:3000/pay/share (found
 * 2026-09-08, minutes after deploy). The public host is in the Host header
 * (or X-Forwarded-Host when a proxy rewrites it); when neither names a real
 * host, the school's public origin is used. A parent must never be sent to
 * an address that exists only inside the container.
 */
export function resolvePublicOrigin(
  headers: { get(name: string): string | null },
  fallbackOrigin: string,
): string {
  const host = (headers.get("x-forwarded-host") || headers.get("host") || "").split(",")[0]!.trim();
  if (!host || /^(0\.0\.0\.0|\[::\]|::)(:\d+)?$/.test(host)) return fallbackOrigin.replace(/\/$/, "");
  const proto = (headers.get("x-forwarded-proto") || "").split(",")[0]!.trim() || (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
