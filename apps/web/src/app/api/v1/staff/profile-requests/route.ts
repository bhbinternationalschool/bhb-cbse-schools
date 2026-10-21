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
import { requireStaffPermissionOrFeature } from "@/lib/apiRouteAuth.server";
import { hasPermission } from "@/lib/rbac";
import { invalidateServerMastersCache, requestMeta } from "@/lib/api/v1/auth";
import { readRowsByIds, signInMobilesInUse, writeStaffSensitive } from "@/lib/data/server/repo";
import { logMobileFills } from "@/lib/staffMobileFillLog.server";
import { asRevision } from "@/lib/data/types";
import { resetStaffPersistenceCache } from "@/lib/staffPersistence";
import {
  STAFF_SENSITIVE_FEATURE,
  STAFF_SENSITIVE_PROFILE_KEYS,
  isBlankMobile,
  mobileFillCheck,
  mobileKey,
  staffActorOf,
  staffHoldsPowerfulAccess,
  staffSensitiveAuthority,
} from "@/lib/staffProtectedFields";
import { writeAudit } from "@/lib/audit.server";
import { PROFILE_FIELD } from "@/lib/staffSelfProfile";
import { changeProfileRequests, patchStaffRow, readProfileRequests } from "@/lib/staffSelfProfile.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // Staff · edit sees every request; the bank & pay details function (the
  // accountant) sees the requests it can decide — bank, ID and pay only.
  const auth = await requireStaffPermissionOrFeature(req, "staff", "edit", STAFF_SENSITIVE_FEATURE, "edit");
  if (!auth.ok) return auth.response;
  const staffEditor = auth.viaMirrorSecret || hasPermission(auth.ctx.session, auth.ctx.masters, "staff", "edit", auth.ctx.rbac);
  const decidable = (r: { fields: Record<string, unknown> }) =>
    staffEditor || Object.keys(r.fields).every((k) => (STAFF_SENSITIVE_PROFILE_KEYS as readonly string[]).includes(k));
  const got = await readProfileRequests();
  if (!got) return NextResponse.json({ ok: false, error: "Could not read the requests — try again." }, { status: 503 });
  const label = (k: string) => PROFILE_FIELD.get(k as never)?.label || k;
  const shape = (r: (typeof got.state.requests)[number]) => ({
    ...r,
    fields: Object.entries(r.fields).map(([key, v]) => ({ key, label: label(key), from: v.from, to: v.to })),
  });
  return NextResponse.json({
    ok: true,
    pending: got.state.requests.filter((r) => r.status === "pending" && decidable(r)).map(shape),
    decided: got.state.requests.filter((r) => r.status !== "pending" && decidable(r)).slice(0, 30).map(shape),
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

  let mobileFilled = false;
  if (decision === "approve") {
    const changes: Record<string, string> = {};
    for (const [k, v] of Object.entries(reqRow.fields)) if (PROFILE_FIELD.get(k as never)?.approval) changes[k] = v.to;
    if (changes.mobile !== undefined) {
      // The registered mobile is a sign-in link (staff OTP). Director, 21 Oct
      // 2026: a MISSING one may be recorded (no other member, family or login
      // has the number — compared as the last 10 digits — and the member holds
      // no powerful access); changing a set one is the owner's.
      let cur: Record<string, unknown> | undefined;
      let inUse: Set<string>;
      try {
        cur = (await readRowsByIds("sis_staff", [reqRow.staffId])).get(reqRow.staffId);
        inUse = await signInMobilesInUse(reqRow.staffId);
      } catch (e) {
        return NextResponse.json({ ok: false, error: `Not applied — ${e instanceof Error ? e.message : String(e)}` }, { status: 503 });
      }
      if (!cur || cur.deleted_at) {
        return NextResponse.json({ ok: false, error: "Not applied — the staff member is not on the roster (removed)." }, { status: 409 });
      }
      if (mobileKey(cur.mobile) !== mobileKey(changes.mobile)) {
        const isOwner =
          staffSensitiveAuthority(auth.ctx.session, auth.ctx.masters, auth.ctx.rbac, { rbacKnown: auth.ctx.rbacKnown !== false }) === "owner";
        if (inUse.has(mobileKey(changes.mobile))) {
          return NextResponse.json(
            { ok: false, error: `${changes.mobile} is already the sign-in number of another member of staff, a family or a login. Not approved.` },
            { status: 409 },
          );
        }
        if (!isOwner) {
          if (!isBlankMobile(cur.mobile)) {
            return NextResponse.json(
              { ok: false, error: `${reqRow.staffName} already has a registered mobile — only the owner changes a sign-in link.` },
              { status: 403 },
            );
          }
          const fill = mobileFillCheck(
            { mobile: cur.mobile },
            { mobile: changes.mobile },
            {
              inUse,
              powerful: staffHoldsPowerfulAccess(
                { id: reqRow.staffId, email: cur.email, fullName: cur.full_name, designationId: cur.designation_id },
                auth.ctx.masters,
                auth.ctx.rbac,
              ),
              name: reqRow.staffName,
            },
          );
          if (fill.kind === "refuse") return NextResponse.json({ ok: false, error: fill.message }, { status: 403 });
          if (fill.kind === "fill") mobileFilled = true;
        }
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
    if (mobileFilled) await logMobileFills(auth.ctx.session, [reqRow.staffId], "profile request approved");
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
