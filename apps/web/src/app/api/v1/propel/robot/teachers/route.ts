/**
 * POST — which ERP teachers the robot may create on Propel (director,
 * 12 Oct 2026). The robot sends Propel's staff list (getteachers); the ERP
 * answers with Propel payloads for active teaching staff whose mobile — the
 * Propel login — no Propel account has, and lists who cannot be sent and
 * which Propel accounts the ERP does not know (reported only: the robot
 * never deactivates anyone). Writes nothing. Compliance · edit.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { buildPropelTeacherPlan, type PropelTeacher } from "@/lib/propelRobot";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  let body: { teachers?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.teachers)) {
    return NextResponse.json({ ok: false, error: "Propel's teacher list was not sent." }, { status: 400 });
  }
  const staff = auth.ctx.masters.staff ?? [];
  if (!staff.length) {
    return NextResponse.json({ ok: false, error: "Could not read the ERP staff list — try again." }, { status: 503 });
  }
  const designations = new Map((auth.ctx.masters.designations ?? []).map((d) => [d.id, d.name]));
  const plan = buildPropelTeacherPlan({
    staff,
    designationName: (id) => (id ? designations.get(id) || "" : ""),
    existing: (body.teachers as PropelTeacher[]).slice(0, 500),
  });
  return NextResponse.json({ ok: true, ...plan });
}
