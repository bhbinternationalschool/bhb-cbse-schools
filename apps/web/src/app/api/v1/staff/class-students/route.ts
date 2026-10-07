import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { sectionKey, staffSectionScope, type StaffScope } from "@/lib/api/v1/staffScope";
import { loadSis, studentsInSession, type SisStudent } from "@/lib/sis";
import { readWaNumberVerdicts } from "@/lib/waNumberVerdicts.server";
import {
  CLASS_TEACHER_HOUSEHOLD_FIELDS,
  CLASS_TEACHER_STUDENT_FIELDS,
  cleanClassTeacherPatch,
  mobile10,
} from "@/lib/sisClassTeacher";
import {
  setStudentPhotoByClassTeacher,
  updateHouseholdByClassTeacher,
  updateStudentByClassTeacher,
} from "@/lib/sisClassTeacher.server";
import { sanitizeStoredMediaUrl } from "@/lib/media";

export const runtime = "nodejs";

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Class teacher of this child's section — or the office / leadership. */
function mayEdit(scope: StaffScope, s: Pick<SisStudent, "classId" | "sectionId">): boolean {
  return scope.unrestricted || scope.classTeacherOf.has(sectionKey(s.classId, s.sectionId));
}

async function context(request: Request) {
  const ctx = await resolveApiAuth(request);
  const scope = await staffSectionScope(ctx);
  if (!scope.unrestricted && scope.classTeacherOf.size === 0) {
    throw new ApiError(
      "forbidden",
      "Only a class teacher can update their class's records — ask the office to link you to your class (Staff → Duties)",
      403,
    );
  }
  await ensureSchoolMirrorHydrated();
  await ensureSisHydratedServer();
  return { ctx, scope };
}

/**
 * GET /api/v1/staff/class-students[?sectionId=]
 *
 * The class teacher's children with what they may edit, the family's
 * numbers, and whether the school can reach the family on WhatsApp:
 *   missing      — no WhatsApp / mobile number at all
 *   not_on       — Meta says the number is not on WhatsApp
 *   unchecked    — a number, never confirmed either way
 *   on           — confirmed on WhatsApp
 * The office / leadership pass ?sectionId= to look at any section.
 */
export async function GET(request: Request) {
  try {
    const { ctx, scope } = await context(request);
    const url = new URL(request.url);
    const only = url.searchParams.get("sectionId")?.trim() || "";
    const sis = loadSis();
    const verdictRead = await readWaNumberVerdicts();

    const students = studentsInSession(sis, scope.academicYearCode)
      .filter((s) => (only ? s.sectionId === only : true))
      .filter((s) =>
        scope.unrestricted ? !!only : scope.classTeacherOf.has(sectionKey(s.classId, s.sectionId)),
      )
      .sort(
        (a, b) =>
          (parseInt(a.rollNo, 10) || 9999) - (parseInt(b.rollNo, 10) || 9999) ||
          a.fullName.localeCompare(b.fullName),
      );

    const className = (id: string) => ctx.masters.classes.find((c) => c.id === id)?.name || "";
    const sectionName = (id: string) => ctx.masters.sections.find((s) => s.id === id)?.name || "";

    const rows = students.map((s) => {
      const hh = sis.households.find((h) => h.id === s.householdId) || null;
      const wa = mobile10(hh?.whatsappMobile || hh?.mobile || "");
      const verdict = wa ? verdictRead.verdicts[wa] : undefined;
      const waStatus: "missing" | "not_on" | "unchecked" | "on" = !wa
        ? "missing"
        : verdict?.onWhatsApp === true
          ? "on"
          : verdict?.onWhatsApp === false
            ? "not_on"
            : "unchecked";
      const student: Record<string, string> = {};
      for (const k of Object.keys(CLASS_TEACHER_STUDENT_FIELDS)) {
        student[k] = String((s as unknown as Record<string, unknown>)[k] ?? "");
      }
      const household: Record<string, string> = {};
      if (hh) {
        for (const k of Object.keys(CLASS_TEACHER_HOUSEHOLD_FIELDS)) {
          household[k] = String((hh as unknown as Record<string, unknown>)[k] ?? "");
        }
      }
      return {
        id: s.id,
        admissionNo: s.admissionNo,
        classLabel: `${className(s.classId)} ${sectionName(s.sectionId)}`.trim(),
        photoUrl: s.photoUrl || "",
        revisionAt: s.revisionAt || "",
        fields: student,
        household: hh
          ? { id: hh.id, revisionAt: hh.revisionAt || "", fields: household }
          : null,
        measure: { heightCm: s.heightCm || "", weightKg: s.weightKg || "", measuredOn: s.measuredOn || "" },
        // My class → Class sheet (bloodGroup, religion, category and
        // motherTongue are already in `fields`).
        sheet: {
          fatherQualification: s.fatherQualification || "",
          motherQualification: s.motherQualification || "",
          isCwsn: !!s.isCwsn,
        },
        whatsapp: { number: wa || "", status: waStatus },
      };
    });

    // The office / leadership see a section only when they pick one.
    const taught = scope.unrestricted
      ? new Set(studentsInSession(sis, scope.academicYearCode).map((st) => st.sectionId))
      : new Set<string>();
    const sections = scope.unrestricted
      ? ctx.masters.sections
          .map((x) => ({ id: x.id, label: `${className(x.classId)} ${x.name}`.trim(), classId: x.classId }))
          .filter((x) => taught.has(x.id))
          .sort((a, b) => {
            const ia = ctx.masters.classes.findIndex((c) => c.id === a.classId);
            const ib = ctx.masters.classes.findIndex((c) => c.id === b.classId);
            return ia - ib || a.label.localeCompare(b.label);
          })
          .map(({ id, label }) => ({ id, label }))
      : [];

    return apiOk({
      academicYearCode: scope.academicYearCode,
      sections,
      sectionId: only,
      // "unknown" is not "unchecked": say when the verdicts could not be read.
      verdictsAvailable: verdictRead.ok,
      students: rows,
      summary: {
        total: rows.length,
        missing: rows.filter((r) => r.whatsapp.status === "missing").length,
        notOn: rows.filter((r) => r.whatsapp.status === "not_on").length,
        unchecked: rows.filter((r) => r.whatsapp.status === "unchecked").length,
      },
    });
  } catch (e) {
    return apiErr(e);
  }
}

type Body = {
  kind?: "student" | "household" | "photo";
  id?: string;
  revisionAt?: string;
  patch?: Record<string, unknown>;
  photoUrl?: string;
};

/**
 * PATCH /api/v1/staff/class-students — the class teacher changes one
 * child's record, one family's numbers (incl. the WhatsApp number the
 * school messages), or the child's photo. Written to that row only,
 * refused if someone saved it in between, audited.
 */
export async function PATCH(request: Request) {
  try {
    const { ctx, scope } = await context(request);
    const body = (await request.json().catch(() => ({}))) as Body;
    const id = (body.id || "").trim();
    if (!id) throw new ApiError("bad_request", "id required", 400);
    const sis = loadSis();
    const inSession = studentsInSession(sis, scope.academicYearCode);

    let summary = "";
    let result;
    if (body.kind === "household") {
      const kids = inSession.filter((s) => s.householdId === id);
      if (!kids.length || !kids.some((s) => mayEdit(scope, s))) {
        throw new ApiError("forbidden", "This family has no child in your class", 403);
      }
      const cleaned = cleanClassTeacherPatch("household", body.patch || {}, istToday());
      if (!cleaned.ok) throw new ApiError("bad_request", cleaned.error, 400);
      result = await updateHouseholdByClassTeacher(id, cleaned.values, body.revisionAt);
      summary = `Class teacher updated family ${id}: ${Object.keys(cleaned.values).join(", ")}`;
    } else if (body.kind === "student" || body.kind === "photo") {
      const s = inSession.find((x) => x.id === id);
      if (!s || !mayEdit(scope, s)) {
        throw new ApiError("forbidden", "This child is not in your class", 403);
      }
      if (body.kind === "photo") {
        const url = sanitizeStoredMediaUrl(body.photoUrl, "class-teacher-photo");
        if (!url || !url.startsWith("/api/file/")) {
          throw new ApiError("bad_request", "Upload the photo first, then save it", 400);
        }
        result = await setStudentPhotoByClassTeacher(id, url, body.revisionAt);
        summary = `Class teacher set photo for ${s.fullName}`;
      } else {
        const cleaned = cleanClassTeacherPatch("student", body.patch || {}, istToday());
        if (!cleaned.ok) throw new ApiError("bad_request", cleaned.error, 400);
        result = await updateStudentByClassTeacher(id, cleaned.values, body.revisionAt);
        summary = `Class teacher updated ${s.fullName}: ${Object.keys(cleaned.values).join(", ")}`;
      }
    } else {
      throw new ApiError("bad_request", "kind must be student, household or photo", 400);
    }

    if (!result.ok) {
      throw new ApiError(result.conflict ? "conflict" : "bad_request", result.error, result.conflict ? 409 : 400);
    }
    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "students",
      action: "edit",
      entityType: body.kind === "household" ? "household" : "student",
      entityId: id,
      summary,
      after: body.kind === "photo" ? { photoUrl: body.photoUrl } : body.patch,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ id, kind: body.kind, updatedAt: result.updatedAt });
  } catch (e) {
    return apiErr(e);
  }
}
