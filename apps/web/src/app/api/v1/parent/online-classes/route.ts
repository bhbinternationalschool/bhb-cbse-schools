import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";
import { loadMasters } from "@/lib/masters";
import { canJoinNow, istNow, onlineClassPhase } from "@/lib/onlineClasses";
import { joinedSessionIdsFor, listSessions } from "@/lib/onlineClasses.server";

export const runtime = "nodejs";

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * GET /api/v1/parent/online-classes?studentId= — the child's section's
 * classes: today and the next two weeks, plus the last week for the
 * record. The link is only sent once the class can be joined; before
 * that the row says when.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const url = new URL(request.url);
    const studentId = url.searchParams.get("studentId")?.trim() || "";
    if (!studentId) throw new ApiError("bad_request", "studentId required", 400);

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const sis = loadSis();
    const student = sis.students.find((s) => s.id === studentId);
    if (!student) throw new ApiError("not_found", "Student not found", 404);
    if (ctx.session.persona === "parent") {
      if (ctx.session.householdId && student.householdId !== ctx.session.householdId) {
        throw new ApiError("forbidden", "Not your child", 403);
      }
    } else {
      assertPermission(ctx, "online_classes", "view");
    }

    const today = istNow().date;
    const rows = await listSessions({
      fromDate: addDays(today, -7),
      toDate: addDays(today, 14),
      sectionIds: [student.sectionId],
    });
    const joined = await joinedSessionIdsFor(studentId, rows.map((r) => r.id));
    const m = loadMasters();
    const sessions = rows
      .filter((s) => s.status !== "cancelled" || s.date >= today)
      .map((s) => {
        const phase = onlineClassPhase(s);
        return {
          id: s.id,
          title:
            s.title ||
            m.subjects.find((x) => x.id === s.subjectId)?.nameEn ||
            "Online class",
          subjectName: m.subjects.find((x) => x.id === s.subjectId)?.nameEn || "",
          teacherName: m.staff.find((x) => x.id === s.teacherId)?.fullName || "",
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          provider: s.provider,
          status: s.status,
          phase,
          canJoin: canJoinNow(s),
          joined: joined.has(s.id),
          note: s.note,
        };
      });
    return apiOk({
      studentId,
      today,
      sessions: sessions.sort(
        (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime),
      ),
    });
  } catch (e) {
    return apiErr(e);
  }
}
