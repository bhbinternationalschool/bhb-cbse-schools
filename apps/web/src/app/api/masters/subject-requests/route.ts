import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { decideSubjectRequest, listSubjectRequests } from "@/lib/subjectRequests.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Masters → Subjects: teachers' requests to change what a class studies.
 * GET  (masters · view) → { pending, recent }
 * POST (masters · edit) { id, decision: "approve" | "reject", note?, newCode? }
 */

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "masters", "view");
  if (!auth.ok) return auth.response;
  const all = await listSubjectRequests({ limit: 100 });
  if (!all) return NextResponse.json({ ok: false, error: "Could not read the requests" }, { status: 503 });
  return NextResponse.json(
    { ok: true, pending: all.filter((r) => r.status === "pending"), recent: all.filter((r) => r.status !== "pending").slice(0, 20) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "masters", "edit");
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const decision = body.decision === "approve" ? "approve" : body.decision === "reject" ? "reject" : null;
  if (!decision) return NextResponse.json({ ok: false, error: "decision must be approve or reject" }, { status: 400 });
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "Office";
  const r = await decideSubjectRequest(String(body.id ?? ""), decision, by, {
    note: String(body.note ?? ""),
    newCode: String(body.newCode ?? ""),
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, summary: r.summary });
}
