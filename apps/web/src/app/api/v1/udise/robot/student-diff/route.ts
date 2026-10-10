/**
 * GET — the portal ↔ ERP comparison for every child this session
 * (lib/udisePortalStudentSync): what the portal knows that the ERP is
 * missing, where they disagree, which portal children the ERP has no one
 * for, and the PEN finder's results. Reads only. Compliance · edit.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { loadMasters } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { householdOf, isRealPortalId, loadSisForStaff, studentsInSession } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import { readPenCandidates, readPortalStudents } from "@/lib/udisePortalStudents.server";
import { reconcilePortalWithErp } from "@/lib/udisePortalReconcile";
import { diffStudent, matchCopies } from "@/lib/udisePortalStudentSync";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const ay = auth.ctx.session.academicYearCode;
  const [copyYear, pens] = await Promise.all([readPortalStudents(ay), readPenCandidates()]);
  if (!copyYear || !pens) return NextResponse.json({ ok: false, error: "Could not read the robot's copy — try again." }, { status: 503 });
  await ensureSchoolMirrorHydrated();
  const sis = loadSisForStaff();
  const masters = loadMasters();
  const cls = (id: string, sec: string) =>
    [masters.classes.find((c) => c.id === id)?.name, masters.sections.find((x) => x.id === sec)?.name].filter(Boolean).join(" ");
  const active = studentsInSession(sis, ay).filter((s) => s.status === "active");
  const hhOf = (s: (typeof active)[number]) => (s.householdId ? householdOf(sis, s.householdId) : undefined);
  const { matched, unmatched } = matchCopies(Object.values(copyYear.byPen), active, (s) => {
    const h = hhOf(s);
    return h ? [h.whatsappMobile, h.mobile, h.altMobile] : [];
  });

  const children = active
    .map((s) => {
      const m = matched.get(s.id);
      const diffs = m ? diffStudent(m.copy, s, hhOf(s)) : [];
      return {
        erpId: s.id,
        name: s.fullName,
        className: cls(s.classId, s.sectionId),
        admissionNo: s.admissionNo,
        pen: isRealPortalId(s.pen) ? s.pen : "",
        revisionAt: s.revisionAt || "",
        onPortal: !!m,
        matchedBy: m?.by || "",
        why: m?.why || "",
        portalName: m ? String(m.copy.gp.studentName || "") : "",
        epRead: !!m?.copy.epAt,
        diffs,
        penSearch: pens[s.id] || null,
      };
    })
    .sort((a, b) => a.className.localeCompare(b.className) || a.name.localeCompare(b.name));

  // Who on UDISE+ left the school per the ERP (→ Dropbox when the portal
  // allows it), and one child entered twice on UDISE+ — the same evidence
  // rules as the robot's list check (lib/udisePortalReconcile).
  const rec = reconcilePortalWithErp({
    portal: Object.values(copyYear.byPen).map((c) => c.gp),
    erpAll: sis.students,
    activeIds: new Set(active.map((s) => s.id)),
    householdMobiles: (s) => {
      const h = hhOf(s);
      return h ? [h.whatsappMobile, h.mobile, h.altMobile] : [];
    },
  });

  return NextResponse.json({
    ok: true,
    leftSchool: rec.leftSchool,
    portalDuplicates: rec.portalDuplicates,
    academicYearCode: ay,
    ourUdiseCode: String(masters.schoolProfile?.udiseCode || TENANT.udiseCode || "").replace(/\D/g, ""),
    fetchedAt: copyYear.fetchedAt,
    portalCount: Object.keys(copyYear.byPen).length,
    children,
    notInErp: unmatched.map((c) => ({ pen: c.pen.startsWith("sid:") ? "" : c.pen, name: String(c.gp.studentName || ""), classDesc: String(c.gp.classDesc || "") })),
  });
}
