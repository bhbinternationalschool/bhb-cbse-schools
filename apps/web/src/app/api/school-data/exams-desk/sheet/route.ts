import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import { requestMeta } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { assertSectionScope } from "@/lib/api/v1/staffScope";
import { auditArrayDiff } from "@/lib/auditDeskDiff.server";
import { writeAudit } from "@/lib/audit.server";
import {
  flattenAbsences,
  flattenCoScholastic,
  flattenExamMarks,
  flattenItemScores,
  flattenOverallRemarks,
  LOCKED_SHEET_MESSAGE,
  normalizeRemarkSource,
  type ExamSubject,
  type MarkSheet,
  type SheetWriteIntent,
} from "@/lib/exams";
import { examsDualWriteDbEnabled } from "@/lib/examsDbConfig";
import {
  fetchExamSheetFromDb,
  pushExamSheetToDb,
} from "@/lib/examsNormalized.server";
import { hasPermission, inferRoleCodes } from "@/lib/rbac";

export const runtime = "nodejs";

type Body = {
  sheet?: Partial<MarkSheet>;
  /** The version this browser edited from; null when it created the sheet. */
  expectedUpdatedAt?: string | null;
  intents?: SheetWriteIntent[];
  reason?: string;
  subjectsUsed?: ExamSubject[];
};

const INTENTS = new Set<SheetWriteIntent>(["marks", "lock", "unlock", "remarks", "itemScores"]);

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * POST — save ONE section's mark sheet.
 *
 * This is the only path that writes marks. It refuses, in this order:
 *   403  the login does not teach this section (class teacher, timetable,
 *        or a school-wide role) — the web desk used to accept any teacher
 *        for any class;
 *   409  someone saved this sheet after the caller opened it — the caller
 *        reloads and re-enters rather than overwriting them;
 *   423  the sheet is locked and the write is not a remark or an unlock;
 *   403  an unlock from a login that may not unlock.
 * The lock is decided from the STORED sheet, never from the payload: a
 * client cannot clear it by sending lockedAt: null.
 */
export async function POST(req: Request) {
  try {
    return await saveSheet(req);
  } catch (e) {
    // A thrown error used to surface as a bare "Internal Server Error" with
    // no body, so the desk could only say "HTTP 500". Say what happened.
    const message = e instanceof Error ? e.message : String(e);
    console.error("[exams-desk/sheet] save failed:", message);
    return bad(500, `The server could not save the mark sheet: ${message}`);
  }
}

async function saveSheet(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["exams-desk"], "POST");
  if (!auth.ok) return auth.response;
  if (!examsDualWriteDbEnabled()) {
    // Not "ok, skipped": the browser would record a success for marks the
    // database never received. Say plainly that nothing was saved.
    return bad(503, "Exam marks cannot be saved on this server right now (EXAMS_DUAL_WRITE_DB is off). Your marks are held in this browser.");
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad(400, "Invalid JSON");
  }
  const sheet = body.sheet;
  if (
    !sheet ||
    typeof sheet.id !== "string" ||
    !sheet.id ||
    !sheet.academicYearCode ||
    !sheet.examTermId ||
    !sheet.classId ||
    !sheet.sectionId
  ) {
    return bad(400, "A mark sheet needs id, academic year, exam, class and section");
  }
  const intents = (Array.isArray(body.intents) ? body.intents : []).filter((i) =>
    INTENTS.has(i),
  );
  if (intents.length === 0) intents.push("marks");
  const wantsUnlock = intents.includes("unlock");
  const wantsLock = intents.includes("lock");
  const remarksOnly = intents.every((i) => i === "remarks");
  const reason = String(body.reason || "").trim();

  if (!auth.viaMirrorSecret) {
    try {
      await assertSectionScope(auth.ctx, sheet.classId, sheet.sectionId);
    } catch (e) {
      if (e instanceof ApiError) return bad(e.status, e.message);
      throw e;
    }
  }

  const existing = await fetchExamSheetFromDb(sheet.id);
  const expected = body.expectedUpdatedAt ?? null;

  let next: MarkSheet = {
    id: sheet.id,
    academicYearCode: sheet.academicYearCode,
    examTermId: sheet.examTermId,
    classId: sheet.classId,
    sectionId: sheet.sectionId,
    marks: Array.isArray(sheet.marks) ? sheet.marks : [],
    absences: Array.isArray(sheet.absences) ? sheet.absences : [],
    coScholastic: Array.isArray(sheet.coScholastic) ? sheet.coScholastic : [],
    overallRemarks: Array.isArray(sheet.overallRemarks) ? sheet.overallRemarks : [],
    itemScores: Array.isArray(sheet.itemScores) ? sheet.itemScores : [],
    lockedAt: existing?.lockedAt ?? null,
    enteredBy: String(sheet.enteredBy || auth.ctx.session.fullName || ""),
    updatedAt: String(sheet.updatedAt || new Date().toISOString()),
  };

  if (existing?.lockedAt) {
    if (wantsUnlock) {
      if (!auth.viaMirrorSecret && !canUnlock(auth)) {
        return bad(403, "Only the owner, principal, admin or office can unlock a mark sheet");
      }
      if (reason.length < 4) return bad(400, "Give a reason for unlocking the mark sheet");
      next = { ...next, lockedAt: null };
    } else if (remarksOnly) {
      // Remarks are written after moderation; marks, ratings and item
      // scores stay exactly as locked, whatever the payload carries.
      const remarkByKey = new Map(
        next.marks.map((m) => [`${m.studentId}:${m.subjectId}`, m]),
      );
      next = {
        ...next,
        lockedAt: existing.lockedAt,
        marks: existing.marks.map((m) => {
          const r = remarkByKey.get(`${m.studentId}:${m.subjectId}`);
          return r
            ? {
                ...m,
                remark: String(r.remark || ""),
                remarkSource: normalizeRemarkSource(r.remarkSource),
              }
            : m;
        }),
        absences: existing.absences,
        coScholastic: existing.coScholastic,
        itemScores: existing.itemScores,
      };
    } else {
      return bad(423, LOCKED_SHEET_MESSAGE);
    }
  } else if (wantsLock) {
    next = { ...next, lockedAt: sheet.lockedAt || new Date().toISOString() };
  }

  const pushed = await pushExamSheetToDb(next, {
    subjectsUsed: Array.isArray(body.subjectsUsed) ? body.subjectsUsed : [],
    expectedUpdatedAt: auth.viaMirrorSecret ? undefined : expected,
  });
  if (!pushed.ok) {
    return bad(pushed.conflict ? 409 : 502, pushed.error || "Sync failed");
  }

  const before = existing ? [existing] : [];
  const after = [next];
  const { ip, userAgent } = requestMeta(req);
  const session = auth.ctx.session;
  await auditArrayDiff({ session, module: "exams", entityType: "student_subject_mark", before: flattenExamMarks(before), after: flattenExamMarks(after), ip, userAgent });
  await auditArrayDiff({ session, module: "exams", entityType: "exam_absence", before: flattenAbsences(before), after: flattenAbsences(after), ip, userAgent });
  await auditArrayDiff({ session, module: "exams", entityType: "co_scholastic_rating", before: flattenCoScholastic(before), after: flattenCoScholastic(after), ip, userAgent });
  await auditArrayDiff({ session, module: "exams", entityType: "report_card_remark", before: flattenOverallRemarks(before), after: flattenOverallRemarks(after), ip, userAgent });
  await auditArrayDiff({ session, module: "exams", entityType: "exam_item_score", before: flattenItemScores(before), after: flattenItemScores(after), ip, userAgent });
  if (existing?.lockedAt && wantsUnlock) {
    await writeAudit({
      session,
      module: "exams",
      action: "edit",
      entityType: "mark_sheet",
      entityId: next.id,
      summary: `Mark sheet unlocked (${next.classId}/${next.sectionId}, exam ${next.examTermId}): ${reason}`,
      before: { lockedAt: existing.lockedAt },
      after: { lockedAt: null, reason },
      ip,
      userAgent,
    });
  } else if (!existing?.lockedAt && next.lockedAt) {
    await writeAudit({
      session,
      module: "exams",
      action: "edit",
      entityType: "mark_sheet",
      entityId: next.id,
      summary: `Mark sheet locked (${next.classId}/${next.sectionId}, exam ${next.examTermId})`,
      after: { lockedAt: next.lockedAt },
      ip,
      userAgent,
    });
  }

  return NextResponse.json({
    ok: true,
    sheet: { id: next.id, updatedAt: next.updatedAt, lockedAt: next.lockedAt },
  });
}

function canUnlock(auth: { ctx: { session: Parameters<typeof hasPermission>[0]; masters: Parameters<typeof hasPermission>[1]; rbac: Parameters<typeof hasPermission>[4] } }): boolean {
  const { session, masters, rbac } = auth.ctx;
  try {
    if (hasPermission(session, masters, "exams", "approve", rbac)) return true;
  } catch {
    /* fall through to role codes */
  }
  try {
    const codes = inferRoleCodes(session, masters);
    return codes.some((c) => c === "owner" || c === "principal" || c === "admin" || c === "office");
  } catch {
    return false;
  }
}
