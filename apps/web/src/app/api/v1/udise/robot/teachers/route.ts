/**
 * POST — the UDISE+ Teacher module's list, lined up with ERP Staff
 * (lib/udiseTeacherFill buildTeacherBoard): who matches, whose National Code
 * the ERP does not hold yet, where the two disagree, and which ERP teachers
 * the portal does not list.
 *
 * Body: { teachers: [portal teacher-details rows] } — only the fields in
 * PORTAL_TEACHER_FIELDS are read (no Aadhaar, no mobile). Compliance · edit,
 * the grant the UDISE+ desk needs. Reads only; writes nothing to the ERP.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { buildTeacherBoard, pickPortalTeacher } from "@/lib/udiseTeacherFill";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  let body: { teachers?: unknown; nonTeachingRead?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.teachers) || !body.teachers.length) {
    return NextResponse.json({ ok: false, error: "Send the portal's teacher list with the request." }, { status: 400 });
  }
  const portal = (body.teachers as Record<string, unknown>[])
    .filter((t) => t && typeof t === "object")
    .map(pickPortalTeacher);
  const staff = auth.ctx.masters.staff ?? [];
  if (!staff.length) {
    // Unknown is not empty: an unread roster would call every teacher "not in the ERP".
    return NextResponse.json({ ok: false, error: "Could not read the ERP staff list — try again." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, ...buildTeacherBoard(staff, portal, { nonTeachingRead: body.nonTeachingRead === true }) });
}
