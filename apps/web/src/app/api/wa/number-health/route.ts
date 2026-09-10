/**
 * GET /api/wa/number-health — parent numbers that cannot receive WhatsApp.
 * Staff route: RBAC on `wa_automation` view, the grant that opens the screen
 * this is shown on.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { listWaBadNumbers } from "@/lib/waNumberHealth.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "wa_automation", "view");
  if (!auth.ok) return auth.response;

  const since = new URL(req.url).searchParams.get("since") || undefined;
  const health = await listWaBadNumbers({ sinceIso: since });

  if (!health.ok) {
    // 502, never 200-with-empty: "could not read" must not render as
    // "every number is fine".
    return NextResponse.json(
      { error: health.error || "Could not read the number health" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    rows: health.rows,
    reachableButFailing: health.reachableButFailing,
    unreachableFamilies: health.unreachableFamilies,
  });
}
