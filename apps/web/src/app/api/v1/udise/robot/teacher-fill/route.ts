/**
 * GET ?code=<National Code>&form=gp|at|td[&name=&dob=] — what the robot may
 * type into the open UDISE+ teacher profile step (lib/udiseTeacherFill).
 *
 * The teacher is found by the portal's National Code stored on the ERP staff
 * record; failing that, by the same name AND date of birth (both read off the
 * open form). A name alone is never enough. Compliance · edit. Reads only.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { staffWorkingYear } from "@/lib/api/v1/staffScope";
import { buildTeacherFillPlan, matchPortalTeacher, type TeacherForm } from "@/lib/udiseTeacherFill";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const q = new URL(req.url).searchParams;
  const code = (q.get("code") || "").trim();
  const form = (q.get("form") || "") as TeacherForm;
  if (!["gp", "at", "td"].includes(form)) {
    return NextResponse.json({ ok: false, error: "Open a teacher's GP, AT or TD step first." }, { status: 400 });
  }
  if (!code && !q.get("name")) {
    return NextResponse.json({ ok: false, error: "The form shows no National Code or name for this teacher." }, { status: 400 });
  }
  const staff = (auth.ctx.masters.staff ?? []).filter((s) => s.status === "active");
  if (!staff.length) {
    return NextResponse.json({ ok: false, error: "Could not read the ERP staff list — try again." }, { status: 503 });
  }
  const m = matchPortalTeacher(staff, {
    empStaffId: "",
    nationalCode: code,
    staffName: q.get("name") || "",
    dateOfBirth: q.get("dob") || "",
  });
  if (m.kind === "none") {
    return NextResponse.json(
      { ok: false, error: `No active ERP staff member has National Code ${code || "—"} or this name and date of birth. Add the code under Staff → OASIS / UDISE id.` },
      { status: 404 },
    );
  }
  if (m.kind === "unsure") {
    return NextResponse.json(
      { ok: false, error: `More than one ERP staff member could be this teacher (${m.candidates.map((c) => c.fullName).join(", ")}). Put the National Code on the right one under Staff → OASIS / UDISE id.` },
      { status: 409 },
    );
  }
  const plan = buildTeacherFillPlan(m.staff, form, auth.ctx.masters, staffWorkingYear(auth.ctx));
  return NextResponse.json({
    ok: true,
    teacher: { name: m.staff.fullName, empCode: m.staff.empCode, matchedBy: m.by },
    ...plan,
  });
}
