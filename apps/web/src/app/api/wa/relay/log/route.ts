/**
 * GET /api/wa/relay/log — every message the bot handed to the office, what
 * each office phone received, and every reply sent back. Kept permanently.
 *
 * Query: days (default 30), category, status, q (name / number / code / text).
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { listRelayLog } from "@/lib/waRelay.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "notifications", "view");
  if (!auth.ok) return auth.response;
  const u = new URL(req.url);
  const r = await listRelayLog({
    days: Number(u.searchParams.get("days") || 30),
    category: u.searchParams.get("category") || undefined,
    status: u.searchParams.get("status") || undefined,
    q: u.searchParams.get("q") || undefined,
    limit: Number(u.searchParams.get("limit") || 300),
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 });
  return NextResponse.json({ ok: true, rows: r.rows });
}
