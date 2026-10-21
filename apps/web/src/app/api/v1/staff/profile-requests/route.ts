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
import { requireStaffPermission, requireStaffPermissionOrFeature } from "@/lib/apiRouteAuth.server";
import { hasPermission } from "@/lib/rbac";
import { invalidateServerMastersCache, requestMeta } from "@/lib/api/v1/auth";
import { readRowsByIds, writeStaffSensitive } from "@/lib/data/server/repo";
import { asRevision } from "@/lib/data/types";
import { resetStaffPersistenceCache } from "@/lib/staffPersistence";
import { STAFF_SENSITIVE_FEATURE, STAFF_SENSITIVE_PROFILE_KEYS, staffActorOf, staffSensitiveAuthority } from "@/lib/staffProtectedFields";
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
  // Staff · edit decides requests; the bank & pay details function (the
  // accountant) may decide those that touch only its fields (checked below).
  const auth = await requireStaffPermissionOrFeature(req, "staff", "edit", STAFF_SENSITIVE_FEATURE, "edit");
  if (!auth.ok) return auth.response;
  const staffEditor = auth.viaMirrorSecret || hasPermission(auth.ctx.session, auth.ctx.masters, "staff", "edit", auth.ctx.rbac);
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
  if (!staffEditor && Object.keys(reqRow.fields).some((k) => !(STAFF_SENSITIVE_PROFILE_KEYS as readonly string[]).includes(k))) {
    return NextResponse.json(
      { ok: false, error: "This request changes more than bank, ID and pay details — it needs Staff (change). Ask the office." },
      { status: 403 },
    );
  }

  if (decision === "approve") {
    const changes: Record<string, string> = {};
    for (const [k, v] of Object.entries(reqRow.fields)) if (PROFILE_FIELD.get(k as never)?.approval) changes[k] = v.to;
    if (changes.mobile) {
      // The staff OTP login resolves on this number: it must be one person's.
      const t = await getServerTenantContext();
      const clash = t
        ? await t.sb.from("sis_staff").select("id, full_name").eq("tenant_id", t.tenantId).eq("mobile", changes.mobile).eq("status", "active").is("deleted_at", null).neq("id", reqRow.staffId).limit(1)
        : null;
      if (clash?.data?.length) {
        return NextResponse.json(
          { ok: false, error: `${changes.mobile} is already the registered mobile of ${(clash.data[0] as { full_name: string }).full_name}. Not approved.` },
          { status: 409 },
        );
      }
    }
    // Bank, UPI, Aadhaar, PAN (and pay) are the owner's and the accountant's
    // to accept (data-layer 2.2b; director, 20–21 Oct 2026): written through
    // sis_staff_write_sensitive — which records the field names, the authority
    // and who — never by staff · edit alone. Everything else as before.
    const sensitive = Object.keys(changes).filter((k) => (STAFF_SENSITIVE_PROFILE_KEYS as readonly string[]).includes(k));
    if (sensitive.length) {
      const authority = staffSensitiveAuthority(auth.ctx.session, auth.ctx.masters, auth.ctx.rbac, {
        rbacKnown: auth.ctx.rbacKnown !== false,
      });
      const actor = staffActorOf(auth.ctx.session);
      if (!authority || !actor) {
        return NextResponse.json(
          {
            ok: false,
            error: `${sensitive.join(", ")}: bank, UPI, Aadhaar, PAN and pay can be changed only by the owner or with the bank & pay details function.`,
          },
          { status: 403 },
        );
      }
      let row: Record<string, unknown> | undefined;
      try {
        row = (await readRowsByIds("sis_staff", [reqRow.staffId])).get(reqRow.staffId);
      } catch (e) {
        return NextResponse.json({ ok: false, error: `Not applied — ${e instanceof Error ? e.message : String(e)}` }, { status: 503 });
      }
      if (!row || row.deleted_at) {
        return NextResponse.json({ ok: false, error: "Not applied — the staff member is not on the roster (removed)." }, { status: 409 });
      }
      const profile = { ...((row.profile as Record<string, unknown>) || {}), ...changes };
      const w = await writeStaffSensitive(
        [
          {
            op: "upsert",
            id: reqRow.staffId,
            base: asRevision(String(row.updated_at ?? "")),
            row: {
              profile,
              ...(changes.fullName !== undefined ? { full_name: changes.fullName } : {}),
              ...(changes.mobile !== undefined ? { mobile: changes.mobile } : {}),
            },
          },
        ],
        authority,
        actor,
      );
      if (!w.ok) {
        return NextResponse.json({ ok: false, error: `Not applied — ${w.message}` }, { status: w.kind === "conflict" ? 409 : 503 });
      }
      resetStaffPersistenceCache();
      invalidateServerMastersCache();
    } else {
      const w = await patchStaffRow(reqRow.staffId, () => changes);
      if (!w.ok) return NextResponse.json({ ok: false, error: `Not applied — ${w.error}` }, { status: 503 });
    }
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
