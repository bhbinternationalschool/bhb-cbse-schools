/**
 * POST — the robot's "add missing children" queue (lib/udisePortalAdd).
 *
 * Body: { students: [{ studentName, dob, fatherName, motherName,
 * primaryMobile, studentCodeNat }] } — the portal's own
 * list, so a child who is already on UDISE+ (but whose PEN was never applied
 * in the ERP — or is there under another name) is not offered for a second,
 * duplicate record. Only those fields are read. Compliance · edit. Reads only.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { householdOf, loadSis, studentsInSession } from "@/lib/sis";
import { listUdiseAddCandidates, type PortalListEntry } from "@/lib/udisePortalAdd";

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
    // Without the portal's list there is no telling who is already on it.
    return NextResponse.json({ ok: false, error: "Send the portal's student list with the request." }, { status: 400 });
  }
  const portal: PortalListEntry[] = (body.students as Record<string, unknown>[])
    .filter((p) => p && typeof p === "object")
    .map((p) => ({
      studentName: p.studentName,
      dob: p.dob,
      fatherName: p.fatherName,
      motherName: p.motherName,
      primaryMobile: p.primaryMobile,
      studentCodeNat: p.studentCodeNat,
    }));

  await ensureSchoolMirrorHydrated();
  const sis = loadSis();
  const masters = loadMasters();
  const res = listUdiseAddCandidates({
    students: studentsInSession(sis, auth.ctx.session.academicYearCode),
    portal,
    classLabelOf: (s) => ({
      className: masters.classes.find((c) => c.id === s.classId)?.name || "",
      sectionName: masters.sections.find((x) => x.id === s.sectionId)?.name || "",
    }),
    householdOf: (s) => (s.householdId ? householdOf(sis, s.householdId) : undefined),
  });
  return NextResponse.json({ ok: true, ...res });
}
