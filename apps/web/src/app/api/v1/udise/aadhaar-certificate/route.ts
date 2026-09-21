/**
 * GET ?student=<id> — the child's UIDAI "Certificate for Aadhaar Enrolment/
 * Update", filled from the ERP, as a PDF to print. Staff with students ·
 * view only: it carries a child's name and home address. The principal
 * pastes the photo, signs and stamps it; see aadhaarCertificate.ts.
 */

import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { loadServerRbac } from "@/lib/api/v1/auth";
import { buildAadhaarCertificate } from "@/lib/aadhaarCertificate.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  await ensureSchoolMirrorHydrated();
  const masters = loadMasters();
  const rbac = await loadServerRbac();
  if (!hasPermission(auth.ctx.session, masters, "students", "view", rbac)) {
    return NextResponse.json({ error: "Students view permission required" }, { status: 403 });
  }
  const studentId = new URL(req.url).searchParams.get("student") || "";
  if (!studentId) return NextResponse.json({ error: "student is required" }, { status: 400 });
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  // A reprint from the certificates register keeps the date it was issued
  // on: its three months of validity run from that date. Never a future one.
  const asked = new URL(req.url).searchParams.get("date") || "";
  const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today;
  const r = await buildAadhaarCertificate(studentId, issueDate);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 404 });
  return new NextResponse(new Uint8Array(r.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${r.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
