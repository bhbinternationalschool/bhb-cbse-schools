import { NextResponse } from "next/server";
import { requireJobSecret, requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { archivePendingReceipts } from "@/lib/receiptArchive.server";

export const runtime = "nodejs";

/**
 * POST /api/drive/archive/receipts/tick — archive receipts that have no PDF
 * in Drive yet. Cloud Scheduler calls it with the cron secret; the office
 * can also call it signed in (settings.edit) to push the backlog through.
 * Optional ?limit= (default 40, max 200).
 */
export async function POST(req: Request) {
  const byJob = requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"]);
  if (!byJob) {
    const auth = await requireStaffPermission(req, "settings", "edit");
    if (!auth.ok) return auth.response;
  }
  const limit = Number(new URL(req.url).searchParams.get("limit") || "") || undefined;
  const result = await archivePendingReceipts({ limit });
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}

export async function GET() {
  return NextResponse.json({
    service: "drive-archive-receipts",
    note: "POST with x-cron-secret, or signed in as staff with settings.edit",
  });
}
