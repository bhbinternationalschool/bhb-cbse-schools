/**
 * GET — the ERP children (this session, active) with no real PEN, with what
 * the robot needs to search the whole of UDISE+ for them: name, birth date
 * (DD/MM/YYYY, the portal's shape), parents, and the Aadhaar's last four when
 * the ERP has it. Reads only. Compliance · edit.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { isRealPortalId, loadSisForStaff, studentsInSession } from "@/lib/sis";

export const runtime = "nodejs";

const dmy = (iso: string) => {
  const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  await ensureSchoolMirrorHydrated();
  const sis = loadSisForStaff();
  const children = studentsInSession(sis, auth.ctx.session.academicYearCode)
    .filter((s) => s.status === "active" && !isRealPortalId(s.pen))
    .map((s) => ({
      erpId: s.id,
      name: s.fullName,
      dob: dmy(s.dob || ""),
      father: s.fatherName,
      mother: s.motherName,
      aadhaarLast4: /^\d{4}$/.test(s.aadhaarLast4 || "") ? s.aadhaarLast4 : "",
    }));
  return NextResponse.json({ ok: true, children });
}
