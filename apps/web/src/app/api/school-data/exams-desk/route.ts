import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import { requestMeta } from "@/lib/api/v1/auth";
import { auditArrayDiff } from "@/lib/auditDeskDiff.server";
import {
  flattenCoScholastic,
  flattenExamMarks,
  flattenItemScores,
  flattenOverallRemarks,
  type ExamsState,
} from "@/lib/exams";
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

type ExamsDeskPostBody = Pick<
  ExamsState,
  "terms" | "subjects" | "dateSheet" | "sheets" | "policy" | "promotions"
>;

/** POST — push full exam desk snapshot */
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

  let body: ExamsDeskPostBody;
  try {
    body = (await req.json()) as ExamsDeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { bundle: priorBundle } = await fetchExamDeskFromDb();
  const beforeMarks = flattenExamMarks(priorBundle.sheets);
  const beforeCoScholastic = flattenCoScholastic(priorBundle.sheets);
  const beforeRemarks = flattenOverallRemarks(priorBundle.sheets);
  const beforeItemScores = flattenItemScores(priorBundle.sheets);

  const result = await pushExamDeskToDb({
    version: 1,
    terms: Array.isArray(body.terms) ? body.terms : [],
    subjects: Array.isArray(body.subjects) ? body.subjects : [],
    dateSheet: Array.isArray(body.dateSheet) ? body.dateSheet : [],
    sheets: Array.isArray(body.sheets) ? body.sheets : [],
    policy: body.policy!,
    promotions: Array.isArray(body.promotions) ? body.promotions : [],
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  const pushedSheets = Array.isArray(body.sheets) ? body.sheets : [];
  const afterMarks = flattenExamMarks(pushedSheets);
  const afterCoScholastic = flattenCoScholastic(pushedSheets);
  const afterRemarks = flattenOverallRemarks(pushedSheets);
  const afterItemScores = flattenItemScores(pushedSheets);
  const { ip, userAgent } = requestMeta(req);
  await auditArrayDiff({
    session: auth.ctx.session,
    module: "exams",
    entityType: "student_subject_mark",
    before: beforeMarks,
    after: afterMarks,
    ip,
    userAgent,
  });
  await auditArrayDiff({
    session: auth.ctx.session,
    module: "exams",
    entityType: "co_scholastic_rating",
    before: beforeCoScholastic,
    after: afterCoScholastic,
    ip,
    userAgent,
  });
  await auditArrayDiff({
    session: auth.ctx.session,
    module: "exams",
    entityType: "report_card_remark",
    before: beforeRemarks,
    after: afterRemarks,
    ip,
    userAgent,
  });
  await auditArrayDiff({
    session: auth.ctx.session,
    module: "exams",
    entityType: "exam_item_score",
    before: beforeItemScores,
    after: afterItemScores,
    ip,
    userAgent,
  });

  return NextResponse.json({
    ok: true,
    sheetCount: body.sheets?.length ?? 0,
    updatedAt: new Date().toISOString(),
  });
}
