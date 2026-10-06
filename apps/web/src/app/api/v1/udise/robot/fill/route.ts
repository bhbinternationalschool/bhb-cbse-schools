/**
 * GET ?pen=<PEN> — what the UDISE robot may type into this child's open
 * UDISE+ profile form (lib/udisePortalFill). Looked up by PEN only: the
 * portal form names the child by PEN, and a name is not an identity.
 * Compliance · edit, the grant the UDISE+ desk needs. Reads only.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { householdOf, isRealPortalId, loadSis, studentsInSession } from "@/lib/sis";
import { buildUdiseFillPlan } from "@/lib/udisePortalFill";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const pen = (new URL(req.url).searchParams.get("pen") || "").replace(/\D/g, "");
  if (!isRealPortalId(pen) || pen.length < 8) {
    return NextResponse.json({ ok: false, error: "The form shows no PEN for this child." }, { status: 400 });
  }
  await ensureSchoolMirrorHydrated();
  const sis = loadSis();
  // One row per child (studentsInSession) — never the raw list, which holds
  // a row per year and would make every child look like two.
  const matches = studentsInSession(sis, auth.ctx.session.academicYearCode).filter(
    (s) => s.status === "active" && s.pen.replace(/\D/g, "") === pen,
  );
  if (!matches.length) {
    return NextResponse.json({ ok: false, error: `No active ERP student has PEN ${pen}. Pull from the portal and apply it in the ERP first.` }, { status: 404 });
  }
  if (matches.length > 1) {
    return NextResponse.json(
      { ok: false, error: `${matches.length} ERP students carry PEN ${pen} (${matches.map((m) => m.fullName).join(", ")}). Fix that in the ERP first.` },
      { status: 409 },
    );
  }
  const s = matches[0]!;
  const plan = buildUdiseFillPlan(s, s.householdId ? householdOf(sis, s.householdId) : undefined);
  return NextResponse.json({ ok: true, student: { name: s.fullName, admissionNo: s.admissionNo, pen }, ...plan });
}
