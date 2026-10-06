/**
 * POST — the UDISE robot extension's pull from the UDISE+ portal.
 *
 * Body: { academicYearCode: "2026-27", students: [...portal records] }.
 * Lands on the session's UDISE+ working sheet (lib/udiseRobotSync.server);
 * the office reviews and applies it from Students → UDISE+ as with an
 * uploaded export. Compliance · edit, the same grant the import panel needs.
 *
 * GET — a cheap "am I signed in, and as whom" for the extension's popup.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { syncUdisePortalPull } from "@/lib/udiseRobotSync.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { householdOf, loadSis, studentsInSession } from "@/lib/sis";
import { reconcilePortalWithErp, type PortalChild } from "@/lib/udisePortalReconcile";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const s = auth.ctx.session;
  return NextResponse.json({
    ok: true,
    name: s.fullName || s.staffId || "",
    academicYearCode: s.academicYearCode || "",
  });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  let body: { academicYearCode?: unknown; students?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }
  const s = auth.ctx.session;
  const res = await syncUdisePortalPull({
    academicYearCode: typeof body.academicYearCode === "string" ? body.academicYearCode : "",
    students: Array.isArray(body.students) ? body.students : [],
    actor: `UDISE robot · ${s.fullName || s.staffId || "staff"}`,
  });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status });
  // Who on the portal is who in the ERP, even under another name — read
  // only, for the office to act on (never applied by the robot).
  await ensureSchoolMirrorHydrated();
  const sis = loadSis();
  const active = studentsInSession(sis, s.academicYearCode).filter((x) => x.status === "active");
  const reconcile = reconcilePortalWithErp({
    portal: (body.students as PortalChild[]).filter((p) => p && typeof p === "object"),
    erpAll: sis.students,
    activeIds: new Set(active.map((x) => x.id)),
    householdMobiles: (x) => {
      const h = x.householdId ? householdOf(sis, x.householdId) : undefined;
      return h ? [h.whatsappMobile, h.mobile, h.altMobile] : [];
    },
  });
  return NextResponse.json({ ...res, reconcile });
}
