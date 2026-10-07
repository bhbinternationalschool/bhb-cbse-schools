import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { sectionKey, staffSectionScope } from "@/lib/api/v1/staffScope";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis, studentsInSession } from "@/lib/sis";
import { setStudentMeasurements } from "@/lib/sisClassTeacher.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { checkMeasurement } from "@/lib/studentMeasurements";

export const runtime = "nodejs";

type RowIn = { id?: string; revisionAt?: string; heightCm?: string; weightKg?: string };

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * POST /api/v1/staff/class-measurements
 * { rows: [{ id, revisionAt, heightCm, weightKg }], measuredOn?: "YYYY-MM-DD" }
 *
 * The class teacher's tape-and-scale round (My class → Height & weight):
 * each child's figures saved to that child's record only, checked the same
 * way the phone checks them, refused per child if someone saved the record
 * in between. One audit line for the round. The class teacher of the
 * child's section, or the office / leadership.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const scope = await staffSectionScope(ctx);
    if (!scope.unrestricted && scope.classTeacherOf.size === 0) {
      throw new ApiError("forbidden", "Only a class teacher can enter their class's measurements", 403);
    }
    const body = (await request.json().catch(() => ({}))) as { rows?: RowIn[]; measuredOn?: string };
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 80) : [];
    if (!rows.length) throw new ApiError("bad_request", "Nothing to save", 400);
    const today = istToday();
    const measuredOn = /^\d{4}-\d{2}-\d{2}$/.test(body.measuredOn || "") ? body.measuredOn! : today;
    if (measuredOn > today) throw new ApiError("bad_request", "The measuring date cannot be in the future", 400);

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const inSession = studentsInSession(loadSis(), scope.academicYearCode);

    const results: { id: string; ok: boolean; error?: string; conflict?: boolean; updatedAt?: string }[] = [];
    for (const r of rows) {
      const id = String(r.id || "").trim();
      const s = inSession.find((x) => x.id === id);
      if (!s || !(scope.unrestricted || scope.classTeacherOf.has(sectionKey(s.classId, s.sectionId)))) {
        results.push({ id, ok: false, error: "This child is not in your class" });
        continue;
      }
      const checked = checkMeasurement(String(r.heightCm ?? ""), String(r.weightKg ?? ""));
      if (!checked.ok) {
        results.push({ id, ok: false, error: checked.error });
        continue;
      }
      if (!checked.heightCm && !checked.weightKg) {
        results.push({ id, ok: false, error: "Nothing typed for this child" });
        continue;
      }
      const w = await setStudentMeasurements(
        id,
        { heightCm: checked.heightCm, weightKg: checked.weightKg, measuredOn },
        r.revisionAt,
      );
      results.push(w.ok ? { id, ok: true, updatedAt: w.updatedAt } : { id, ok: false, error: w.error, conflict: w.conflict });
    }

    const saved = results.filter((x) => x.ok).length;
    if (saved) {
      const meta = requestMeta(request);
      await writeAudit({
        session: ctx.session,
        module: "students",
        action: "edit",
        entityType: "student",
        entityId: results.filter((x) => x.ok).map((x) => x.id).join(","),
        summary: `Height & weight measured ${measuredOn}: ${saved} child${saved === 1 ? "" : "ren"}`,
        after: { measuredOn, rows: rows.filter((r) => results.find((x) => x.id === r.id && x.ok)) },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }
    return apiOk({ measuredOn, saved, results });
  } catch (e) {
    return apiErr(e);
  }
}
