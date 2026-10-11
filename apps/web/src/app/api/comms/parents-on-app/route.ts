/**
 * Comms → Parents on app: parent app adoption by class and section — who
 * signed in, who opened it lately, notifications, app version, the last app
 * invite, and the families who never signed in with their phone numbers
 * (lib/parentsOnAppReport.server → lib/parentsOnApp).
 *
 * GET (notices · edit — office; every parent's mobile is in it)
 *   → { ok, summary, classes, families, asOf, presenceAvailable, invitesAvailable }
 *
 * Reads only. The invite is POST ./invite.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { loadParentsOnAppReport } from "@/lib/parentsOnAppReport.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "notices", "edit");
  if (!auth.ok) return auth.response;
  const loaded = await loadParentsOnAppReport(auth.ctx.session.academicYearCode || "");
  if (!loaded.ok) return NextResponse.json({ ok: false, error: loaded.error }, { status: loaded.status });
  return NextResponse.json(
    {
      ok: true,
      ...loaded.report,
      presenceAvailable: loaded.presenceAvailable,
      invitesAvailable: loaded.invitesAvailable,
      asOf: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
