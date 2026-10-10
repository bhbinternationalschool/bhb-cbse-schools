/**
 * GET /pay/go/<linkId>.<code> — the target of the WhatsApp "Pay now" button.
 *
 * A template button URL may carry one variable, at the end; the pay page
 * needs a link id AND its code. This route unpacks the combined token and
 * redirects. A token that does not parse goes to the parent portal, where
 * every open due can still be paid, rather than to an error page.
 */
import { NextResponse } from "next/server";
import { publicPortalOrigin } from "@/lib/admissions";
import { parsePayGoToken, payGoRedirectPath, resolvePublicOrigin } from "@/lib/payGoToken";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const parsed = parsePayGoToken(token);
  // Never `new URL(path, req.url)`: behind Cloud Run that is the container's
  // bind address, and the first live redirect went to 0.0.0.0:3000.
  const origin = resolvePublicOrigin(req.headers, publicPortalOrigin());
  return NextResponse.redirect(`${origin}${parsed ? payGoRedirectPath(parsed) : "/parent"}`, 302);
}
