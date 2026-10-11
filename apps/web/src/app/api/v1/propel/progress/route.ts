/**
 * GET — teachers' Propel course progress as the Office Robot last brought it
 * in (Staff → Appraisal). Staff · view. Read only.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { readPropelProgress } from "@/lib/propelRobot.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "view");
  if (!auth.ok) return auth.response;
  const st = await readPropelProgress();
  if (!st) return NextResponse.json({ ok: false, error: "Could not read the Propel progress — try again." }, { status: 503 });
  return NextResponse.json({ ok: true, ...st }, { headers: { "Cache-Control": "private, no-store" } });
}
