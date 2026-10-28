/**
 * POST /api/fees/counter-grants — the fee counter's standing-discount grants
 * and their revoke on a voided receipt, decided and written on the server
 * (data-layer 2.2e review fixes; director's decision 27 Oct 2026 — a
 * fees · edit clerk may record a counter grant tied to a receipt and end
 * exactly those on void). Rules: lib/data/server/counterGrants.server.ts.
 *
 * Body: { action: "grant", items, reason, ground, academicYearCode,
 *         sourceVoucherId?, sourceReceiptNo? }
 *     | { action: "revoke", voucherId, receiptNo }
 */
import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { counterGrantsPost } from "@/lib/data/server/counterGrants.server";
import { withBuildCheck } from "@/lib/staleBuild.server";

export const runtime = "nodejs";

export const POST = withBuildCheck(async (req: Request) => {
  // Fees · edit: the counter's own authority (the director's decision — a
  // fees · edit clerk records counter grants and ends them on void). The
  // finer rules (no receipt = Masters only) are in counterGrantsPost.
  const auth = await requireStaffPermission(req, "fees", "edit");
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret) {
    return NextResponse.json({ ok: false, kind: "auth", message: "A person records a discount, not the mirror." }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, kind: "invalid", message: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, kind: "invalid", message: "Body must be an object" }, { status: 400 });
  }
  const out = await counterGrantsPost(auth.ctx, body);
  return NextResponse.json(out.body, { status: out.status });
});
