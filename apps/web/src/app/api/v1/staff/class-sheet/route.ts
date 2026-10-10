import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { sectionKey, staffSectionScope } from "@/lib/api/v1/staffScope";
import { checkSheetRow, type SheetValues } from "@/lib/classDetailsSheet";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSisForStaff, studentsInSession } from "@/lib/sis";
import { setStudentSheetValues } from "@/lib/sisClassTeacher.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";

export const runtime = "nodejs";

type RowIn = { id?: string; revisionAt?: string; values?: Record<string, unknown> };

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * POST /api/v1/staff/class-sheet
 * { rows: [{ id, revisionAt, values: { heightCm, weightKg, bloodGroup, … } }],
 *   measuredOn?: "YYYY-MM-DD" }
 *
 * My class → Class sheet: the class teacher's round of UDISE+ details for
 * the whole class (lib/classDetailsSheet). Each child's values are checked
 * the same way the phone checks them and saved to that child's record only;
 * a child whose record was saved by someone else in between is refused, not
 * overwritten. One audit line for the round. The class teacher of the
 * child's section, or the office / leadership.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const scope = await staffSectionScope(ctx);
    if (!scope.unrestricted && scope.classTeacherOf.size === 0) {
      throw new ApiError("forbidden", "Only a class teacher can fill their class's sheet", 403);
    }
    const body = (await request.json().catch(() => ({}))) as { rows?: RowIn[]; measuredOn?: string };
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 80) : [];
    if (!rows.length) throw new ApiError("bad_request", "Nothing to save", 400);
    const today = istToday();
    const measuredOn = /^\d{4}-\d{2}-\d{2}$/.test(body.measuredOn || "") ? body.measuredOn! : today;
    if (measuredOn > today) throw new ApiError("bad_request", "The measuring date cannot be in the future", 400);

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const inSession = studentsInSession(loadSisForStaff(), scope.academicYearCode);

    const results: { id: string; ok: boolean; error?: string; conflict?: boolean; updatedAt?: string }[] = [];
    const savedRows: { id: string; values: SheetValues }[] = [];
    for (const r of rows) {
      const id = String(r.id || "").trim();
      const s = inSession.find((x) => x.id === id);
      if (!s || !(scope.unrestricted || scope.classTeacherOf.has(sectionKey(s.classId, s.sectionId)))) {
        results.push({ id, ok: false, error: "This child is not in your class" });
        continue;
      }
      const checked = checkSheetRow(r.values && typeof r.values === "object" ? r.values : {}, {
        bloodGroup: s.bloodGroup,
        religion: s.religion,
        fatherQualification: s.fatherQualification,
        motherQualification: s.motherQualification,
      });
      if (!checked.ok) {
        results.push({ id, ok: false, error: checked.error });
        continue;
      }
      const v = checked.values;
      if ("heightCm" in v && !v.heightCm && !v.weightKg && !s.heightCm && !s.weightKg) {
        // Two blank boxes for a child never measured is not a measurement.
        delete v.heightCm;
        delete v.weightKg;
      }
      if (!Object.keys(v).length) {
        results.push({ id, ok: false, error: "Nothing typed for this child" });
        continue;
      }
      const w = await setStudentSheetValues(id, v, measuredOn, r.revisionAt);
      if (w.ok) savedRows.push({ id, values: v });
      results.push(w.ok ? { id, ok: true, updatedAt: w.updatedAt } : { id, ok: false, error: w.error, conflict: w.conflict });
    }

    if (savedRows.length) {
      const meta = requestMeta(request);
      const fields = [...new Set(savedRows.flatMap((x) => Object.keys(x.values)))];
      await writeAudit({
        session: ctx.session,
        module: "students",
        action: "edit",
        entityType: "student",
        entityId: savedRows.map((x) => x.id).join(","),
        summary: `Class sheet (${fields.join(", ")}): ${savedRows.length} child${savedRows.length === 1 ? "" : "ren"}`,
        after: { measuredOn, rows: savedRows },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }
    return apiOk({ measuredOn, saved: savedRows.length, results });
  } catch (e) {
    return apiErr(e);
  }
}
