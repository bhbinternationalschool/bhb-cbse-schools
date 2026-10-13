/**
 * The office's queue of staff profile changes that need approval
 * (identity, bank, statutory — lib/staffSelfProfile). Staff · edit.
 *
 * GET  — open requests (full values: the office sees the record anyway)
 *        and the last 30 decided.
 * POST — { id, decision: "approve" | "reject", note } — approve writes the
 *        new values to the live staff row; reject records why.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { requestMeta } from "@/lib/api/v1/auth";
import { writeAudit } from "@/lib/audit.server";
import { PROFILE_FIELD } from "@/lib/staffSelfProfile";
import { changeProfileRequests, patchStaffRow, readProfileRequests } from "@/lib/staffSelfProfile.server";
import { getServerTenantContext } from "@/lib/serverTenant";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "edit");
  if (!auth.ok) return auth.response;
  const got = await readProfileRequests();
  if (!got) return NextResponse.json({ ok: false, error: "Could not read the requests — try again." }, { status: 503 });
  const label = (k: string) => PROFILE_FIELD.get(k as never)?.label || k;
  const shape = (r: (typeof got.state.requests)[number]) => ({
    ...r,
    fields: Object.entries(r.fields).map(([key, v]) => ({ key, label: label(key), from: v.from, to: v.to })),
  });
  return NextResponse.json({
    ok: true,
    pending: got.state.requests.filter((r) => r.status === "pending").map(shape),
    decided: got.state.requests.filter((r) => r.status !== "pending").slice(0, 30).map(shape),
  });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "edit");
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret) return NextResponse.json({ ok: false, error: "A signed-in person must decide." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { id?: unknown; decision?: unknown; note?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const decision = body?.decision === "approve" ? "approve" : body?.decision === "reject" ? "reject" : "";
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 240) : "";
  if (!id || !decision) return NextResponse.json({ ok: false, error: "id and decision required" }, { status: 400 });
  if (decision === "reject" && !note) return NextResponse.json({ ok: false, error: "Say why it is rejected — the staff member sees this." }, { status: 400 });

  const got = await readProfileRequests();
  const reqRow = got?.state.requests.find((r) => r.id === id);
  if (!reqRow) return NextResponse.json({ ok: false, error: "Request not found — reload." }, { status: 404 });
  if (reqRow.status !== "pending") return NextResponse.json({ ok: false, error: `Already ${reqRow.status}.` }, { status: 409 });
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "office";

  if (decision === "approve") {
    const changes: Record<string, string> = {};
    for (const [k, v] of Object.entries(reqRow.fields)) if (PROFILE_FIELD.get(k as never)?.approval) changes[k] = v.to;
    if (changes.mobile) {
      // The staff OTP login resolves on this number: it must be one person's.
      const t = await getServerTenantContext();
      const clash = t
        ? await t.sb.from("sis_staff").select("id, full_name").eq("tenant_id", t.tenantId).eq("mobile", changes.mobile).eq("status", "active").neq("id", reqRow.staffId).limit(1)
        : null;
      if (clash?.data?.length) {
        return NextResponse.json(
          { ok: false, error: `${changes.mobile} is already the registered mobile of ${(clash.data[0] as { full_name: string }).full_name}. Not approved.` },
          { status: 409 },
        );
      }
    }
    const w = await patchStaffRow(reqRow.staffId, () => changes);
    if (!w.ok) return NextResponse.json({ ok: false, error: `Not applied — ${w.error}` }, { status: 503 });
  }

  const now = new Date().toISOString();
  const saved = await changeProfileRequests((s) => {
    const i = s.requests.findIndex((r) => r.id === id);
    if (i < 0 || s.requests[i]!.status !== "pending") return { error: "The request changed meanwhile — reload." };
    const requests = [...s.requests];
    requests[i] = { ...requests[i]!, status: decision === "approve" ? "approved" : "rejected", decidedAt: now, decidedBy: by, note };
    return { ...s, requests };
  });
  if (!saved.ok) {
    return NextResponse.json(
      { ok: false, error: decision === "approve" ? `The record WAS updated, but the request could not be closed — ${saved.error}` : saved.error },
      { status: 503 },
    );
  }
  const meta = requestMeta(req);
  await writeAudit({
    session: auth.ctx.session,
    module: "staff",
    action: "edit",
    entityType: "staff",
    entityId: reqRow.staffId,
    summary: `${decision === "approve" ? "Approved" : "Rejected"} ${reqRow.staffName}'s profile change: ${Object.keys(reqRow.fields).join(", ")}${note ? ` · ${note}` : ""}`,
    before: Object.fromEntries(Object.entries(reqRow.fields).map(([k, v]) => [k, v.from])),
    after: decision === "approve" ? Object.fromEntries(Object.entries(reqRow.fields).map(([k, v]) => [k, v.to])) : { rejected: true },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return NextResponse.json({ ok: true, status: decision === "approve" ? "approved" : "rejected" });
}
