import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import type { ExamsState } from "@/lib/exams";
import { examsDualWriteDbEnabled } from "@/lib/examsDbConfig";
import {
  fetchExamDeskFromDb,
  pushExamDeskToDb,
} from "@/lib/examsNormalized.server";

export const runtime = "nodejs";

/** GET — pull exam desk from normalized tables */
export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["exams-desk"], "GET");
  if (!auth.ok) return auth.response
  const { bundle, meta } = await fetchExamDeskFromDb();
  return NextResponse.json({
    ok: true,
    terms: bundle.terms,
    subjects: bundle.subjects,
    dateSheet: bundle.dateSheet,
    sheets: bundle.sheets,
    policy: bundle.policy,
    promotions: bundle.promotions,
    sheetCount: bundle.sheets.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

type ExamsDeskPostBody = Partial<
  Pick<ExamsState, "terms" | "subjects" | "dateSheet" | "sheets" | "policy" | "promotions" | "rooms" | "seating">
>;

/**
 * POST — push the exam SETUP: terms, subjects, date sheet, policy and
 * promotion decisions.
 *
 * Mark sheets are not accepted here any more. A payload's `sheets` used to
 * replace every sheet on the server — including deleting the ones this
 * browser had never seen — which is how one teacher's save erased another's
 * marks. Sheets go one at a time through ./sheet, where the version and the
 * lock are checked. A `sheets` array in the body is ignored; older tabs
 * still send one.
 *
 * Setup is school-wide, so only a school-wide login may write it. A class
 * teacher's copy of the term list is whatever their tab last hydrated, and
 * pushing it would prune terms the office added since.
 */
export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["exams-desk"], "POST");
  if (!auth.ok) return auth.response
  if (!examsDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "EXAMS_DUAL_WRITE_DB disabled",
    });
  }
  if (!auth.viaMirrorSecret) {
    const scope = await staffSectionScope(auth.ctx);
    if (!scope.unrestricted) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Exam setup (terms, subjects, policy, date sheet, promotions) is saved by the office, principal or owner. Your marks are saved separately and are not affected.",
        },
        { status: 403 },
      );
    }
  }

  let body: ExamsDeskPostBody;
  try {
    body = (await req.json()) as ExamsDeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (Array.isArray(body.sheets) && body.sheets.length > 0) {
    console.warn(
      `[exams-desk] ignoring ${body.sheets.length} sheet(s) in a setup push — sheets are saved through /sheet`,
    );
  }

  const result = await pushExamDeskToDb({
    version: 1,
    terms: Array.isArray(body.terms) ? body.terms : [],
    subjects: Array.isArray(body.subjects) ? body.subjects : [],
    dateSheet: Array.isArray(body.dateSheet) ? body.dateSheet : [],
    // Carried through, or a setup push would wipe the rooms and the seating
    // plan built on them.
    rooms: Array.isArray(body.rooms) ? body.rooms : [],
    seating: Array.isArray(body.seating) ? body.seating : [],
    sheets: [],
    policy: body.policy!,
    promotions: Array.isArray(body.promotions) ? body.promotions : [],
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  const { bundle } = await fetchExamDeskFromDb();
  return NextResponse.json({
    ok: true,
    sheetCount: bundle.sheets.length,
    updatedAt: new Date().toISOString(),
  });
}
