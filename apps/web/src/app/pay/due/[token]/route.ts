/**
 * GET /pay/due/<token> — the "pay your fee" link in reminders and bot replies.
 *
 * Works out what the family owes now, raises a payment link, attaches the
 * gateway and redirects straight to it. No login, no GPay-then-come-back,
 * no "Confirm paid". See lib/duePayToken.ts for why the checkout is made at
 * tap time rather than when the message is sent.
 */

import { NextResponse } from "next/server";
import { publicPortalOrigin } from "@/lib/admissions";
import { verifyDuePayToken } from "@/lib/duePayToken.server";
import { startDirectFeeCheckout } from "@/lib/duePayCheckout.server";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import { resolvePublicOrigin } from "@/lib/payGoToken";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(title: string, lines: string[], status = 200): NextResponse {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = `<!doctype html><html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;font-family:system-ui,-apple-system,"Noto Sans Devanagari",sans-serif;background:#f6f7fb;color:#1f2a44}main{max-width:28rem;margin:10vh auto;padding:1.5rem;background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.08)}h1{font-size:1.15rem;margin:0 0 .75rem}p{line-height:1.55;margin:.5rem 0}small{color:#6b7280}</style></head>
<body><main><h1>${esc(title)}</h1>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}<p><small>${esc(TENANT.nameDisplay)}</small></p></main></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const payload = verifyDuePayToken(token);
  if (!payload) {
    return page(
      "यह भुगतान लिंक पुराना हो गया है",
      [
        "कृपया स्कूल के WhatsApp नंबर पर PAY लिखें — नया लिंक तुरंत मिल जाएगा।",
        "This payment link has expired. Send PAY to the school's WhatsApp number for a fresh one.",
      ],
      410,
    );
  }

  // Return URLs must be the public host, never the container's bind address.
  const origin = resolvePublicOrigin(req.headers, publicPortalOrigin());
  const r = await startDirectFeeCheckout({
    householdId: payload.h,
    studentId: payload.s,
    scope: payload.sc,
    appOrigin: origin,
  });

  if (r.kind === "checkout" || r.kind === "fallback") {
    if (r.kind === "fallback") console.warn("[pay/due] gateway unavailable, UPI page instead:", r.reason);
    return NextResponse.redirect(r.url, 302);
  }
  if (r.kind === "nothing_due") {
    const hindi = waTemplateLanguageFor(r.household ?? {}) === "hi";
    return page(
      hindi ? "कोई फीस बकाया नहीं है ✅" : "Nothing is due ✅",
      hindi
        ? ["इस समय आपकी कोई फीस बकाया नहीं है — संभव है भुगतान पहले ही हो चुका हो।", "रसीदें देखने के लिए स्कूल के WhatsApp नंबर पर RECEIPTS लिखें।"]
        : ["No fee is due right now — it may already have been paid.", "Send RECEIPTS to the school's WhatsApp number to see your receipts."],
    );
  }
  console.error("[pay/due] could not start checkout", r.error);
  return page(
    "भुगतान अभी शुरू नहीं हो सका",
    [
      "कृपया कुछ मिनट बाद फिर से लिंक खोलें, या स्कूल के WhatsApp नंबर पर HUMAN लिखें।",
      "The payment could not start just now. Please try the link again in a few minutes, or send HUMAN to the school's WhatsApp number.",
    ],
    503,
  );
}
