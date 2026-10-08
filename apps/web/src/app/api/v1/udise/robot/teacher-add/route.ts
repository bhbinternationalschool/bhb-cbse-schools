/**
 * GET ?staffId=<ERP staff id> — what the robot may type into the portal's
 * "Add New Staff" General Profile (#/teacherCommonDetails) for an ERP staff
 * member the portal does not list (lib/udiseTeacherFill buildTeacherAddPlan).
 * Same shape as teacher-fill. Compliance · edit. Reads only.
 *
 * The full Aadhaar goes to the portal tab only when it is a valid 12-digit
 * number — the field the portal asks for. The robot still never saves.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { staffWorkingYear } from "@/lib/api/v1/staffScope";
import { buildTeacherAddPlan } from "@/lib/udiseTeacherFill";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const staffId = (new URL(req.url).searchParams.get("staffId") || "").trim();
  if (!staffId) return NextResponse.json({ ok: false, error: "Which staff member? (staffId missing)" }, { status: 400 });
  const staff = auth.ctx.masters.staff ?? [];
  if (!staff.length) {
    return NextResponse.json({ ok: false, error: "Could not read the ERP staff list — try again." }, { status: 503 });
  }
  const s = staff.find((x) => x.id === staffId);
  if (!s || s.status !== "active") {
    return NextResponse.json({ ok: false, error: "That staff member is not active in the ERP." }, { status: 404 });
  }
  const plan = buildTeacherAddPlan(s, auth.ctx.masters, staffWorkingYear(auth.ctx));
  return NextResponse.json({
    ok: true,
    teacher: { name: s.fullName, empCode: s.empCode, stream: s.stream, oasisId: s.oasisId || "" },
    ...plan,
  });
}
