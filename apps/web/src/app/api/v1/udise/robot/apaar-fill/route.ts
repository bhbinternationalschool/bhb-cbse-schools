/**
 * GET ?pen=<PEN> — what the robot may type on the open UDISE+ "Generate
 * APAAR ID" page for this child (lib/udiseApaarFill): who gave consent,
 * their relation, their identity proof, the place. Only for a child the ERP
 * calls ready (lib/udiseCompliance apaarReadiness) — never for a family that
 * has not said yes. Compliance · edit. Reads only.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { isRealPortalId, loadSisForStaff, studentsInSession } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import { apaarReadiness } from "@/lib/udiseCompliance";
import { buildApaarFillPlan } from "@/lib/udiseApaarFill";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const pen = (new URL(req.url).searchParams.get("pen") || "").replace(/\D/g, "");
  if (!isRealPortalId(pen) || pen.length < 8) {
    return NextResponse.json({ ok: false, error: "This child has no PEN on the portal." }, { status: 400 });
  }
  await ensureSchoolMirrorHydrated();
  const sis = loadSisForStaff();
  const matches = studentsInSession(sis, auth.ctx.session.academicYearCode).filter(
    (s) => s.status === "active" && s.pen.replace(/\D/g, "") === pen,
  );
  if (matches.length !== 1) {
    return NextResponse.json(
      { ok: false, error: matches.length ? `${matches.length} ERP students carry PEN ${pen}. Fix that in the ERP first.` : `No active ERP student has PEN ${pen}.` },
      { status: matches.length ? 409 : 404 },
    );
  }
  const s = matches[0]!;
  const r = apaarReadiness(s);
  if (!r.ready) {
    const why =
      s.apaarConsent !== "given"
        ? "the family has not given APAAR consent in the ERP"
        : r.waitingFor.includes("parent_aadhaar")
          ? "the consenting parent's own Aadhaar is not on file"
          : "the ERP has no PEN for this child";
    return NextResponse.json({ ok: false, error: `${s.fullName}: not ready — ${why}. Nothing filled.` }, { status: 409 });
  }
  const plan = buildApaarFillPlan(s, TENANT.city || "");
  return NextResponse.json({
    ok: true,
    student: { name: s.fullName, pen, consentAt: s.apaarConsentAt, consentRecordFileId: s.apaarConsentFileId || "" },
    ...plan,
  });
}
