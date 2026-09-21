/**
 * GET ?student=<id> — the printable record of the parent's APAAR ID answer
 * (lib/apaarConsentPdf). The copy filed in Drive when the parent tapped is
 * served as it was made; when it could not be filed, the record is rendered
 * from the answer saved on the student. Staff with students · view only: it
 * names a child and a parent's mobile.
 */

import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { hasPermission } from "@/lib/rbac";
import { loadServerRbac } from "@/lib/api/v1/auth";
import { getServerTenantContext } from "@/lib/serverTenant";
import { rowToStudent } from "@/lib/sisNormalized.server";

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

  const ctx = await getServerTenantContext();
  if (!ctx) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const { data } = await ctx.sb.from("sis_students").select("*").eq("tenant_id", ctx.tenantId).eq("id", studentId).maybeSingle();
  if (!data) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  const s = rowToStudent(data as Parameters<typeof rowToStudent>[0]);
  if (s.apaarConsent !== "given" && s.apaarConsent !== "refused") {
    return NextResponse.json({ error: "No APAAR consent answer has been received for this student" }, { status: 404 });
  }

  const { apaarConsentRecordFileName } = await import("@/lib/apaarConsentPdf");
  const fileName = apaarConsentRecordFileName(s.fullName, s.apaarConsentAt);
  if (s.apaarConsentFileId) {
    const { getDriveFileContent } = await import("@/lib/googleDrive.server");
    const content = await getDriveFileContent(s.apaarConsentFileId);
    if (content.ok) {
      return new Response(content.body, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    // Drive unreachable: the same record, rendered from the saved answer.
    console.warn("[apaar-consent] Drive copy unavailable, rendering", studentId, content.error);
  }

  const { loadSis, householdOf } = await import("@/lib/sis");
  const { waTemplateLanguageFor } = await import("@/lib/householdPrefs");
  const hh = s.householdId ? householdOf(loadSis(), s.householdId) : undefined;
  const { apaarConsentRecordInput } = await import("@/lib/apaarConsent.server");
  const { renderApaarConsentRecordPdf } = await import("@/lib/apaarConsentPdf");
  const pdf = renderApaarConsentRecordPdf(
    await apaarConsentRecordInput(s, s.apaarConsent, s.apaarConsentAt, s.apaarConsentBy, hh ? waTemplateLanguageFor(hh) === "hi" : true),
  );
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
