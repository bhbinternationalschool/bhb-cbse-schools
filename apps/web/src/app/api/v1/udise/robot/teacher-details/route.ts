/**
 * POST — the robot's "Fetch all teachers from portal": every UDISE+ teacher
 *        (teaching and non-teaching lists, plus each one's GP / AT / TD form)
 *        stored as the latest snapshot (module_local_state
 *        "udise_portal_teachers"). Body: { listsRead, teachers: [{ staffType,
 *        list, gp, at, td }] } — only whitelisted fields are kept
 *        (lib/udiseTeacherSync); no Aadhaar. Writes nothing to Staff.
 * GET  — that snapshot lined up with ERP Staff, field by field, for the
 *        office's review (Students → UDISE+ → Teachers: portal vs ERP).
 *
 * Compliance · edit for both, like the other robot routes.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { staffWorkingYear } from "@/lib/api/v1/staffScope";
import { buildTeacherSyncReview, normalizePortalTeacherSnapshot } from "@/lib/udiseTeacherSync";
import {
  readPortalTeachersSnapshot,
  readStaffWithRevisions,
  writePortalTeachersSnapshot,
} from "@/lib/udiseTeacherSync.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const [got, erp] = await Promise.all([readPortalTeachersSnapshot(), readStaffWithRevisions()]);
  if (!got) return NextResponse.json({ ok: false, error: "Could not read the portal snapshot. Try again." }, { status: 503 });
  if (!got.snapshot) {
    return NextResponse.json({ ok: true, fetchedAt: "", fetchedBy: "", listsRead: null, rows: [], notOnPortal: [] });
  }
  if (!erp || !erp.staff.length) {
    // Unknown is not empty: an unread roster would offer every portal value as "missing".
    return NextResponse.json({ ok: false, error: "Could not read the ERP staff list — try again." }, { status: 503 });
  }
  const review = buildTeacherSyncReview(got.snapshot, erp.staff, auth.ctx.masters, staffWorkingYear(auth.ctx), erp.revisions);
  return NextResponse.json({
    ok: true,
    fetchedAt: got.snapshot.fetchedAt,
    fetchedBy: got.snapshot.fetchedBy,
    listsRead: got.snapshot.listsRead,
    ...review,
  });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  const by = auth.ctx.session.fullName || auth.ctx.session.email || "";
  const snapshot = normalizePortalTeacherSnapshot(body, by, new Date().toISOString());
  if (!snapshot.teachers.length) {
    return NextResponse.json({ ok: false, error: "The portal sent no teachers — nothing stored." }, { status: 400 });
  }
  const saved = await writePortalTeachersSnapshot(snapshot);
  if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error }, { status: 500 });
  const erp = await readStaffWithRevisions();
  const review = erp && erp.staff.length
    ? buildTeacherSyncReview(snapshot, erp.staff, auth.ctx.masters, staffWorkingYear(auth.ctx), erp.revisions)
    : null;
  return NextResponse.json({
    ok: true,
    stored: snapshot.teachers.length,
    listsRead: snapshot.listsRead,
    formsUnread: snapshot.teachers.filter((t) => !t.gp || !t.at || !t.td).length,
    // Counts only — the review itself is in the ERP, behind its own login.
    matched: review ? review.rows.filter((r) => r.match === "matched").length : null,
    toReview: review ? review.rows.reduce((n, r) => n + r.items.length, 0) : null,
  });
}
