/**
 * WhatsApp-submitted complaint tickets — staff-side read.
 * Tickets are written server-side (webhook, on a completed Flow response)
 * into the wa_desk_bot_slices "complaints" slice; the browser has no other
 * way to see them since lib/complaints.ts is localStorage-only.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { listServerComplaintTickets } from "@/lib/complaintsServer";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "complaints", "view");
  if (!auth.ok) return auth.response;
  const tickets = await listServerComplaintTickets();
  return NextResponse.json({ ok: true, tickets });
}
