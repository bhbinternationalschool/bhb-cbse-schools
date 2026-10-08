/**
 * GET ?pen=<PEN> — what the UDISE robot may type into this child's open
 * UDISE+ profile form (lib/udisePortalFill). Looked up by PEN only: the
 * portal form names the child by PEN, and a name is not an identity.
 * Compliance · edit, the grant the UDISE+ desk needs. Reads only.
 *
 * Also used: the office's confirmed school answers, the child's own ERP row
 * for the previous academic year, and the family village's road distance.
 * `v=2` (extension 1.2+) = the robot can fill fields the portal shows only
 * after another choice (previous class / result).
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadMasters } from "@/lib/masters";
import { householdOf, isRealPortalId, loadSis, studentsInSession, type SisStudent } from "@/lib/sis";
import { portalClassIdFor } from "@/lib/udisePortalAdd";
import { buildUdiseFillPlan, type UdiseFillExtras } from "@/lib/udisePortalFill";
import { householdRoadDistance, readUdiseSchoolAnswers } from "@/lib/udiseSchoolAnswers.server";

/** "2026-27" → "2025-26". */
function previousAy(code: string): string {
  const m = (code || "").match(/^(20\d{2})-(\d{2})$/);
  if (!m) return "";
  const start = Number(m[1]) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "compliance", "edit");
  if (!auth.ok) return auth.response;
  const pen = (new URL(req.url).searchParams.get("pen") || "").replace(/\D/g, "");
  if (!isRealPortalId(pen) || pen.length < 8) {
    return NextResponse.json({ ok: false, error: "The form shows no PEN for this child." }, { status: 400 });
  }
  await ensureSchoolMirrorHydrated();
  const sis = loadSis();
  // One row per child (studentsInSession) — never the raw list, which holds
  // a row per year and would make every child look like two.
  const matches = studentsInSession(sis, auth.ctx.session.academicYearCode).filter(
    (s) => s.status === "active" && s.pen.replace(/\D/g, "") === pen,
  );
  if (!matches.length) {
    return NextResponse.json({ ok: false, error: `No active ERP student has PEN ${pen}. Pull from the portal and apply it in the ERP first.` }, { status: 404 });
  }
  if (matches.length > 1) {
    return NextResponse.json(
      { ok: false, error: `${matches.length} ERP students carry PEN ${pen} (${matches.map((m) => m.fullName).join(", ")}). Fix that in the ERP first.` },
      { status: 409 },
    );
  }
  const s = matches[0]!;
  const v2 = new URL(req.url).searchParams.get("v") === "2";

  // The same child last year: same admission number AND name (the SIS
  // identity rule — studentsInSession), in exactly the previous year.
  const masters = loadMasters();
  const classNameOf = (x: SisStudent) => masters.classes.find((c) => c.id === x.classId)?.name || "";
  const lastAy = previousAy(auth.ctx.session.academicYearCode);
  const key = (x: SisStudent) => `${(x.admissionNo || "").trim().toUpperCase()}::${(x.fullName || "").trim().toUpperCase()}`;
  const prevRows = s.admissionNo.trim()
    ? sis.students.filter((x) => x.id !== s.id && x.academicYearCode === lastAy && key(x) === key(s))
    : [];
  let previousYear: UdiseFillExtras["previousYear"] = null;
  if (prevRows.length === 1) {
    const prevClass = classNameOf(prevRows[0]!);
    const prevId = portalClassIdFor(prevClass);
    if (prevId !== null) {
      previousYear = { yearCode: lastAy, className: prevClass, portalClassId: prevId, currentPortalClassId: portalClassIdFor(classNameOf(s)) };
    }
  }

  const [school, distance] = await Promise.all([
    readUdiseSchoolAnswers(),
    s.householdId ? householdRoadDistance(s.householdId) : Promise.resolve(null),
  ]);
  const plan = buildUdiseFillPlan(s, s.householdId ? householdOf(sis, s.householdId) : undefined, {
    school: school?.answers,
    previousYear,
    distance,
    dependentFields: v2,
  });
  return NextResponse.json({
    ok: true,
    student: { name: s.fullName, admissionNo: s.admissionNo, pen },
    ...plan,
    // Said aloud so the office knows why so much is still theirs to type.
    schoolAnswersConfirmed: !!school?.answers.confirmedAt,
  });
}
