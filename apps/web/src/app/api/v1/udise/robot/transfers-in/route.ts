/**
 * GET — ERP children the PEN finder found on UDISE+ at ANOTHER school: the
 * transfers to import from the Dropbox once that school releases them. The
 * robot's "Fill import search from ERP" walks this list on the portal's
 * import page (PEN + birth date). Reads only. Compliance · edit.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { loadMasters } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { isRealPortalId, loadSisForStaff, studentsInSession } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import { readPenCandidates } from "@/lib/udisePortalStudents.server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const pens = await readPenCandidates();
  if (!pens) return NextResponse.json({ ok: false, error: "Could not read the PEN finder results — try again." }, { status: 503 });
  await ensureSchoolMirrorHydrated();
  const ours = String(loadMasters().schoolProfile?.udiseCode || TENANT.udiseCode || "").replace(/\D/g, "");
  const children = studentsInSession(loadSisForStaff(), auth.ctx.session.academicYearCode)
    .filter((s) => s.status === "active" && !isRealPortalId(s.pen) && pens[s.id]?.searched)
    .flatMap((s) =>
      (pens[s.id]?.hits ?? [])
        .filter((h) => h.pen && (!ours || h.udiseCode.replace(/\D/g, "") !== ours))
        .map((h) => ({ erpId: s.id, name: s.fullName, pen: h.pen, dob: h.dob, school: h.schoolName, udiseCode: h.udiseCode })),
    );
  return NextResponse.json({ ok: true, children });
}
