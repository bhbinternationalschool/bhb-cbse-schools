/**
 * POST { changes: [{ staffId, field, value, revisionAt }] } — the office's
 * ticked "Teachers: portal vs ERP" changes, written to sis_staff.
 *
 * Only what was ticked, and only if it still holds: the server re-runs the
 * comparison against the stored snapshot and the LIVE staff row, and refuses
 * a tick whose value moved since the screen was drawn; each staff row is
 * written conditional on the revision the office reviewed. One audit event
 * per staff member, with before and after.
 *
 * Compliance · edit (the UDISE+ desk) AND Staff · edit: this changes staff
 * records, including the mobile staff OTP login resolves on. A named person
 * only — the mirror secret cannot apply.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { assertPermission, invalidateServerMastersCache, requestMeta } from "@/lib/api/v1/auth";
import { staffWorkingYear } from "@/lib/api/v1/staffScope";
import { writeAudit } from "@/lib/audit.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { resetStaffPersistenceCache } from "@/lib/staffPersistence";
import {
  buildTeacherSyncReview,
  planStaffPatch,
  SYNC_FIELD_TO_STAFF,
  type TeacherSyncField,
  type TeacherSyncTick,
} from "@/lib/udiseTeacherSync";
import {
  readPortalTeachersSnapshot,
  readStaffWithRevisions,
  updateStaffFields,
} from "@/lib/udiseTeacherSync.server";

export const runtime = "nodejs";

type Change = { staffId?: unknown; field?: unknown; value?: unknown; revisionAt?: unknown };

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  if (auth.viaMirrorSecret) return NextResponse.json({ ok: false, error: "A signed-in person must apply these." }, { status: 403 });
  try {
    assertPermission(auth.ctx, "staff", "edit");
  } catch {
    return NextResponse.json({ ok: false, error: "Applying to staff records needs Staff · edit as well." }, { status: 403 });
  }
  let body: { changes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  const changes = (Array.isArray(body.changes) ? (body.changes as Change[]) : [])
    .filter((c) => c && typeof c.staffId === "string" && typeof c.field === "string" && typeof c.value === "string")
    .filter((c) => (c.field as string) in SYNC_FIELD_TO_STAFF);
  if (!changes.length) return NextResponse.json({ ok: false, error: "Tick at least one change." }, { status: 400 });

  const [got, erp] = await Promise.all([readPortalTeachersSnapshot(), readStaffWithRevisions()]);
  if (!got?.snapshot || !erp || !erp.staff.length) {
    return NextResponse.json({ ok: false, error: "Could not read the snapshot or the staff list — nothing applied." }, { status: 503 });
  }
  const review = buildTeacherSyncReview(got.snapshot, erp.staff, auth.ctx.masters, staffWorkingYear(auth.ctx), erp.revisions);

  const byStaff = new Map<string, { revisionAt: string; ticks: TeacherSyncTick[] }>();
  for (const c of changes) {
    const id = c.staffId as string;
    const g = byStaff.get(id) || { revisionAt: typeof c.revisionAt === "string" ? c.revisionAt : "", ticks: [] };
    g.ticks.push({ staffId: id, field: c.field as TeacherSyncField, value: c.value as string });
    byStaff.set(id, g);
  }

  const meta = requestMeta(req);
  const results: { staffId: string; name: string; ok: boolean; applied: string[]; error?: string }[] = [];
  let wrote = false;
  for (const [staffId, g] of byStaff) {
    const row = review.rows.find((r) => r.match === "matched" && r.erpStaffId === staffId);
    const staff = erp.staff.find((s) => s.id === staffId);
    if (!row || !staff) {
      results.push({ staffId, name: staff?.fullName || staffId, ok: false, applied: [], error: "No longer matched to a portal teacher — reload." });
      continue;
    }
    if (g.revisionAt !== row.erpRevision) {
      results.push({ staffId, name: staff.fullName, ok: false, applied: [], error: "The staff record changed since the review — reload and check again." });
      continue;
    }
    const plan = planStaffPatch(row, g.ticks);
    if (plan.stale.length) {
      // All or nothing per person: half a reviewed set is not what was reviewed.
      results.push({
        staffId,
        name: staff.fullName,
        ok: false,
        applied: [],
        error: `Changed since the review: ${plan.stale.map((t) => t.field).join(", ")} — reload and check again.`,
      });
      continue;
    }
    const w = await updateStaffFields(staffId, plan.patch, row.erpRevision);
    if (!w.ok) {
      results.push({ staffId, name: staff.fullName, ok: false, applied: [], error: w.error });
      continue;
    }
    wrote = true;
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(plan.patch)) before[k] = staff[k as keyof typeof staff];
    await writeAudit({
      session: auth.ctx.session,
      module: "staff",
      action: "edit",
      entityType: "staff",
      entityId: staffId,
      summary: `UDISE+ portal values applied to ${staff.fullName}: ${plan.applied.map((i) => i.label).join(", ")}`,
      before,
      after: { ...plan.patch, source: "udise_portal_teachers", snapshotAt: got.snapshot.fetchedAt },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    results.push({ staffId, name: staff.fullName, ok: true, applied: plan.applied.map((i) => i.label) });
  }

  if (wrote) {
    // The roster is cached three times over (see /api/v1/staff/roster/mobile).
    resetStaffPersistenceCache();
    invalidateServerMastersCache();
    await ensureSchoolMirrorHydrated({ force: true }).catch(() => undefined);
  }
  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}
