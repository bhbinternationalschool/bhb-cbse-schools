/**
 * POST — the robot's "Fetch all children from portal": a batch of children's
 * full UDISE+ records { academicYearCode, students: [{ studentId, gp, fp }] }
 * (General Profile + Facility Profile, read in the portal tab). Only the
 * fields in lib/udisePortalStudentSync are kept — never an Aadhaar number.
 * Stored as the ERP's copy for the office to compare (GET student-diff);
 * nothing in the student records changes here. Compliance · edit.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { isRealPortalId } from "@/lib/sis";
import { mergePortalStudents } from "@/lib/udisePortalStudents.server";
import { pickFp, pickGp, type PortalStudentCopy } from "@/lib/udisePortalStudentSync";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  let body: { academicYearCode?: unknown; students?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  const ay = typeof body.academicYearCode === "string" ? body.academicYearCode.trim() : "";
  if (!/^20\d{2}-\d{2}$/.test(ay)) return NextResponse.json({ ok: false, error: "Which academic year? Open the portal's current year." }, { status: 400 });
  const rows = Array.isArray(body.students) ? (body.students as Record<string, unknown>[]).slice(0, 100) : [];
  const now = new Date().toISOString();
  const copies: PortalStudentCopy[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const gp = pickGp(r.gp);
    const studentId = String(gp.studentId ?? r.studentId ?? "").replace(/\D/g, "");
    if (!studentId) continue;
    const pen = String(gp.studentCodeNat ?? "").replace(/\D/g, "");
    // A child the portal has not given a PEN yet is kept under its portal id.
    copies.push({ studentId, pen: isRealPortalId(pen) ? pen : `sid:${studentId}`, gp, fp: pickFp(r.fp), fetchedAt: now });
  }
  if (!copies.length) return NextResponse.json({ ok: false, error: "No children in the batch" }, { status: 400 });
  const res = await mergePortalStudents(ay, copies);
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 503 });
  return NextResponse.json({ ok: true, received: copies.length, total: res.total });
}
