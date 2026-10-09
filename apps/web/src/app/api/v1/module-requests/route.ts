/**
 * The director's inbox of module change requests and stuck points
 * (lib/moduleRequests). Settings · edit (owner / admin).
 *
 * GET  → { ok, requests, stuck }
 * POST { id, status?: approved|rejected|built|new, suggestion?, directorNote?, prUrl? }
 *   An APPROVED request is the spec it is built to; the director may edit
 *   the suggestion first.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { decideModuleRequest, type ModuleRequestStatus } from "@/lib/moduleRequests";
import { readModuleRequests, updateModuleRequests } from "@/lib/moduleRequests.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "settings", "edit");
  if (!auth.ok) return auth.response;
  const state = await readModuleRequests();
  if (!state) return NextResponse.json({ ok: false, error: "Could not read requests" }, { status: 503 });
  return NextResponse.json(
    { ok: true, requests: state.requests, stuck: [...state.stuck].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt)) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "settings", "edit");
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const by = auth.ctx.session.fullName || "director";
  const r = await updateModuleRequests((st) => {
    const d = decideModuleRequest(st, {
      id,
      status: typeof body.status === "string" ? (body.status as ModuleRequestStatus) : undefined,
      suggestion: typeof body.suggestion === "string" ? body.suggestion : undefined,
      directorNote: typeof body.directorNote === "string" ? body.directorNote : undefined,
      prUrl: typeof body.prUrl === "string" ? body.prUrl : undefined,
      by,
      now: new Date().toISOString(),
    });
    return d.ok ? d.state : d;
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
