import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import {
  promoteStudentToNextYear,
  type PromoteStudentResult,
} from "@/lib/sisPromotion.server";

export const runtime = "nodejs";

type PromoteBody = {
  studentIds: string[];
  toAcademicYearCode: string;
  toClassId: string;
  toSectionId: string;
  toStudentType?: string;
};

/**
 * POST — promote a batch of students to the next academic year.
 *
 * Runs one at a time, not in parallel: each promotion is two sequential
 * writes (sis_promote_enrollment, then the live sis_students update — see
 * lib/sisPromotion.server.ts), and running a batch concurrently would
 * make failures harder to attribute to a specific student. Returns a
 * result per student — this can partially succeed, and the caller needs
 * to know exactly which ones did.
 */
export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(
    req,
    SCHOOL_DATA_DESK_RBAC["sis-roster"],
    "POST",
  );
  if (!auth.ok) return auth.response;

  let body: PromoteBody;
  try {
    body = (await req.json()) as PromoteBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const studentIds = Array.isArray(body.studentIds) ? body.studentIds : [];
  if (studentIds.length === 0) {
    return NextResponse.json({ ok: false, error: "No students given" }, { status: 400 });
  }
  if (!body.toAcademicYearCode || !body.toClassId || !body.toSectionId) {
    return NextResponse.json(
      { ok: false, error: "Target year, class and section are all required" },
      { status: 400 },
    );
  }
  if (studentIds.length > 200) {
    return NextResponse.json(
      { ok: false, error: `${studentIds.length} students in one request — split into smaller batches` },
      { status: 400 },
    );
  }

  const results: PromoteStudentResult[] = [];
  for (const studentId of studentIds) {
    results.push(
      await promoteStudentToNextYear({
        studentId,
        toAcademicYearCode: body.toAcademicYearCode,
        toClassId: body.toClassId,
        toSectionId: body.toSectionId,
        toStudentType: body.toStudentType,
      }),
    );
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  return NextResponse.json({
    ok: failed === 0,
    succeeded,
    failed,
    results,
  });
}
