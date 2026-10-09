/**
 * POST /api/payments/cancel-link {linkId} — close a pay-link's gateway order
 * before the desk marks the link cancelled. Cancelling used to change only
 * the ERP: the Cashfree order stayed ACTIVE and payable, and a payment on it
 * then booked nothing (9 Oct 2026). Answers 409 when the family has already
 * paid, so the clerk does not cancel a paid link.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { closeOrdersForDeadLinks } from "@/lib/cashfreeCheckouts.server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "edit");
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as { linkId?: unknown };
  const linkId = typeof body.linkId === "string" ? body.linkId.trim() : "";
  if (!linkId) return NextResponse.json({ error: "linkId required" }, { status: 400 });

  const r = await closeOrdersForDeadLinks([linkId]);
  if (r.paid.length) {
    return NextResponse.json(
      { error: "This link has already been paid online — do not cancel it; the receipt will post from the gateway.", paid: true },
      { status: 409 },
    );
  }
  if (r.errors.length) return NextResponse.json({ error: r.errors.join("; ") }, { status: 502 });
  return NextResponse.json({ ok: true, gatewayClosed: r.closed.length > 0 });
}
