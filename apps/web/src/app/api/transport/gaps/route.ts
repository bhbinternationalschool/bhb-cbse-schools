/**
 * GET/POST /api/transport/gaps
 *
 * The fleet audit's open findings (transport_desk_gaps) plus the gaps the
 * desk shows by itself (no seat count, no driver, a used stop with no pin).
 *
 * POST settles, dismisses or reopens one stored finding and records who did
 * it. It changes nothing else: not a fee, not a stop, not an assignment. The
 * director's rule (14 Oct 2026) is that the audit shows fee gaps and the
 * office decides them, so the decision is written down here and the change,
 * if any, is made on the Transport screen like every other edit.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { writeAudit } from "@/lib/audit.server";
import { requestMeta } from "@/lib/api/v1/auth";
import {
  deskBundleToTransportState,
  fetchTransportDeskFromDb,
} from "@/lib/transportNormalized.server";
import {
  gapFromRow,
  isGapStatus,
  liveTransportGaps,
  sortGaps,
  type TransportGap,
} from "@/lib/transportGaps";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });
  }
  const { sb, tenantId } = ctx;

  const [{ data, error }, desk] = await Promise.all([
    sb.from("transport_desk_gaps").select("*").eq("tenant_id", tenantId).limit(2000),
    fetchTransportDeskFromDb(),
  ]);
  if (error) {
    // "No gaps" and "could not read the gaps" are opposite answers.
    return NextResponse.json({ error: `Could not read transport gaps: ${error.message}` }, { status: 502 });
  }
  const stored = (data ?? [])
    .map((r) => gapFromRow(r as Record<string, unknown>))
    .filter((g): g is TransportGap => g !== null);

  // The live half is only as good as the desk read; say so rather than
  // reporting a complete fleet record we could not check.
  const live = desk.ok ? liveTransportGaps(deskBundleToTransportState(desk.bundle)) : [];

  return NextResponse.json({
    gaps: sortGaps([...stored, ...live]),
    deskRead: desk.ok,
  });
}

type Body = { id?: unknown; status?: unknown; note?: unknown };

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "edit");
  if (!auth.ok) return auth.response;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  if (!id || id.startsWith("live:")) {
    return NextResponse.json(
      { error: "This gap closes by itself when the record is completed on the Transport screen" },
      { status: 400 },
    );
  }
  if (!isGapStatus(body.status)) {
    return NextResponse.json({ error: "status must be open, settled or dismissed" }, { status: 400 });
  }
  const status = body.status;
  if (status !== "open" && !note) {
    return NextResponse.json({ error: "Say what was decided" }, { status: 400 });
  }

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });
  }
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "";

  const { data, error } = await sb
    .from("transport_desk_gaps")
    .update(
      status === "open"
        ? { status, settled_at: null, settled_by: "", settle_note: "", updated_at: now }
        : { status, settled_at: now, settled_by: by, settle_note: note, updated_at: now },
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select("id, title")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  if (!data) return NextResponse.json({ error: "No such gap" }, { status: 404 });

  const meta = requestMeta(req);
  await writeAudit({
    session: auth.ctx.session,
    module: "transport",
    action: `gap_${status}`,
    entityType: "transport_gap",
    entityId: id,
    summary: `${status === "open" ? "Reopened" : status === "settled" ? "Settled" : "Dismissed"}: ${String((data as { title?: string }).title ?? id)}`,
    after: { status, note },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return NextResponse.json({ ok: true });
}
