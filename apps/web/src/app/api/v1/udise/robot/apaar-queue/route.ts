/**
 * POST — which children the robot may open UDISE+ "Generate APAAR ID" for
 * (lib/udiseApaarFill buildApaarQueue): the ERP calls them ready (consent
 * given on WhatsApp, the consenting parent's own Aadhaar on file, a PEN —
 * lib/udiseCompliance apaarReadiness) AND the portal list just read says
 * their Aadhaar is verified and they have no APAAR ID yet.
 *
 * Body: { students: [portal current-year rows] } — only studentId,
 * studentName, studentCodeNat, classId, sectionId, uuidStatus, apaarId,
 * apaarIdStatusDesc are read. Compliance · edit. Reads only.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis, studentsInSession } from "@/lib/sis";
import { apaarReadiness } from "@/lib/udiseCompliance";
import { buildApaarQueue, type PortalApaarChild } from "@/lib/udiseApaarFill";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  let body: { students?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.students) || !body.students.length) {
    return NextResponse.json({ ok: false, error: "Send the portal's student list with the request." }, { status: 400 });
  }
  const portal: PortalApaarChild[] = (body.students as Record<string, unknown>[])
    .filter((p) => p && typeof p === "object")
    .map((p) => ({
      studentId: p.studentId as string,
      studentName: String(p.studentName || ""),
      studentCodeNat: String(p.studentCodeNat || ""),
      classId: p.classId as string,
      sectionId: p.sectionId as string,
      uuidStatus: p.uuidStatus as string,
      apaarId: String(p.apaarId || ""),
      apaarIdStatusDesc: String(p.apaarIdStatusDesc || ""),
    }));
  await ensureSchoolMirrorHydrated();
  const sis = loadSis();
  const ready = new Set(
    studentsInSession(sis, auth.ctx.session.academicYearCode)
      .filter((s) => s.status === "active" && apaarReadiness(s).ready)
      .map((s) => s.pen.replace(/\D/g, ""))
      .filter(Boolean),
  );
  return NextResponse.json({ ok: true, ...buildApaarQueue(portal, ready) });
}
