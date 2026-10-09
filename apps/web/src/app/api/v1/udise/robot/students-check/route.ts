/**
 * POST { rows: [{ pen, name, dob }] } — the children listed on the UDISE+
 * page the office has open (release requests, Dropbox, inactive list), each
 * checked against the ERP: still studying here / left / not in the ERP
 * (lib/udiseStudentsCheck). Reads only. Compliance · edit.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { loadMasters } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSisForStaff } from "@/lib/sis";
import { checkPageChildren, type PageChild } from "@/lib/udiseStudentsCheck";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => ({}))) as { rows?: unknown };
  const rows: PageChild[] = (Array.isArray(body.rows) ? (body.rows as Record<string, unknown>[]) : [])
    .slice(0, 300)
    .filter((r) => r && typeof r === "object")
    .map((r) => ({ pen: String(r.pen ?? "").slice(0, 20), name: String(r.name ?? "").slice(0, 120), dob: String(r.dob ?? "").slice(0, 12) }));
  if (!rows.length) return NextResponse.json({ ok: false, error: "No children found on this page" }, { status: 400 });
  await ensureSchoolMirrorHydrated();
  const sis = loadSisForStaff();
  const masters = loadMasters();
  const cls = (s: { classId: string; sectionId: string }) =>
    [masters.classes.find((c) => c.id === s.classId)?.name, masters.sections.find((x) => x.id === s.sectionId)?.name].filter(Boolean).join(" ") || "class not set";
  return NextResponse.json({ ok: true, results: checkPageChildren(rows, sis.students, auth.ctx.session.academicYearCode, cls) });
}
