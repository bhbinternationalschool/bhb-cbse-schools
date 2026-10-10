/**
 * WhatsApp-submitted complaint tickets — staff-side read.
 * Tickets are written server-side (webhook, on a completed Flow response)
 * into the wa_desk_bot_slices "complaints" slice; the browser has no other
 * way to see them since lib/complaints.ts is localStorage-only.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { listServerComplaintTickets } from "@/lib/complaintsServer";
import { complaintScopeFilter } from "@/lib/api/v1/staffComplaints";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "complaints", "view");
  if (!auth.ok) return auth.response;
  const tickets = await listServerComplaintTickets();
  if (auth.viaMirrorSecret) return NextResponse.json({ ok: true, tickets });
  // Every teacher holds complaints.view; this used to hand them every
  // WhatsApp complaint in the school. Same scope as /api/v1/staff/complaints
  // — their classes, or assigned to them (2026-09-29).
  let filter: Awaited<ReturnType<typeof complaintScopeFilter>>;
  try {
    filter = await complaintScopeFilter(auth.ctx);
  } catch (e) {
    // Unknown scope is not "everything".
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Could not work out your classes" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    tickets: filter.unrestricted ? tickets : tickets.filter(filter.allows),
  });
}
