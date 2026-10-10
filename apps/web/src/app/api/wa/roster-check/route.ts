/**
 * POST /api/wa/roster-check — ask Meta whether every active family's number
 * is on WhatsApp, and store the verdicts.
 *
 * A manual action: it spends a Graph API call per 100 numbers, so it is run
 * before a fee run or after importing a class, not on a schedule. `edit`
 * rather than `view` because it writes the verdicts.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { checkRosterOnWhatsApp } from "@/lib/waRosterCheck.server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "wa_automation", "edit");
  if (!auth.ok) return auth.response;

  const result = await checkRosterOnWhatsApp();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
