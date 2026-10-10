/**
 * "What did we send, and did it land?" — school-wide.
 *
 * GET /api/wa/sent-messages?since=&purpose=&stage=&search=&limit=
 * Staff route: RBAC on `wa_automation` view, the same grant that opens
 * Masters → Automation, where this is shown.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { listWaSentMessages } from "@/lib/waSentMessages.server";
import type { WaDeliveryStage } from "@/lib/waDeliveryStatus.server";

export const runtime = "nodejs";

const STAGES = new Set<WaDeliveryStage>([
  "failed",
  "read",
  "delivered",
  "sent",
  "unknown",
]);

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "wa_automation", "view");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const rawStage = url.searchParams.get("stage") || "";
  const stage = STAGES.has(rawStage as WaDeliveryStage)
    ? (rawStage as WaDeliveryStage)
    : undefined;
  const rawLimit = Number(url.searchParams.get("limit"));

  const page = await listWaSentMessages({
    sinceIso: url.searchParams.get("since") || undefined,
    purpose: url.searchParams.get("purpose") || undefined,
    stage,
    search: url.searchParams.get("search") || undefined,
    limit: Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined,
  });

  if (!page.ok) {
    // 502, not 200-with-empty: "we could not read the log" must never render
    // as "nothing was sent".
    return NextResponse.json(
      { error: page.error || "Could not read the message log" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    rows: page.rows,
    tally: page.tally,
    purposes: page.purposes,
  });
}
