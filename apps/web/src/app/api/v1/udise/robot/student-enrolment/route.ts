/**
 * POST — one child's Enrolment Profile, read by the robot off the open form
 * after the office saved it: { academicYearCode, pen, studentId, ep }. The
 * portal's own enrolment API does not answer a plain request, so the form is
 * the source. Kept with the child's portal copy; nothing else changes.
 * Compliance · edit.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { isRealPortalId } from "@/lib/sis";
import { setPortalEnrolment } from "@/lib/udisePortalStudents.server";
import { pickEp } from "@/lib/udisePortalStudentSync";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as { academicYearCode?: string; pen?: string; studentId?: string; ep?: unknown };
  const ay = String(body.academicYearCode || "").trim();
  const pen = String(body.pen || "").replace(/\D/g, "");
  const studentId = String(body.studentId || "").replace(/\D/g, "");
  if (!/^20\d{2}-\d{2}$/.test(ay) || !studentId) return NextResponse.json({ ok: false, error: "Year and portal student id needed" }, { status: 400 });
  const ep = pickEp(body.ep);
  if (!Object.keys(ep).length) return NextResponse.json({ ok: false, error: "No enrolment fields on the form" }, { status: 400 });
  const res = await setPortalEnrolment(ay, isRealPortalId(pen) ? pen : `sid:${studentId}`, studentId, ep);
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 503 });
  return NextResponse.json({ ok: true });
}
