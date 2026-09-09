import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";
import { canJoinNow, JOIN_OPENS_BEFORE_MIN } from "@/lib/onlineClasses";
import { getSession, recordJoin } from "@/lib/onlineClasses.server";

export const runtime = "nodejs";

/**
 * POST /api/v1/parent/online-classes/join { sessionId, studentId } — hand
 * over the link and record that this child went in. The link is released
 * only inside the join window: the same URL sent an hour early is a room
 * with nobody in it, and a child who "joined" at 9 AM for an 11 AM class
 * is not attendance.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: unknown;
      studentId?: unknown;
    };
    const sessionId = String(body.sessionId ?? "").trim();
    const studentId = String(body.studentId ?? "").trim();
    if (!sessionId || !studentId) {
      throw new ApiError("bad_request", "sessionId and studentId required", 400);
    }

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const student = loadSis().students.find((s) => s.id === studentId);
    if (!student) throw new ApiError("not_found", "Student not found", 404);
    if (ctx.session.persona === "parent") {
      if (ctx.session.householdId && student.householdId !== ctx.session.householdId) {
        throw new ApiError("forbidden", "Not your child", 403);
      }
    } else if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Parent session required", 403);
    }

    const s = await getSession(sessionId);
    if (!s) throw new ApiError("not_found", "Class not found", 404);
    if (s.sectionId !== student.sectionId) {
      throw new ApiError("forbidden", "This class is for another section", 403);
    }
    if (s.status === "cancelled") {
      throw new ApiError("bad_request", "This class was cancelled", 400);
    }
    if (!canJoinNow(s)) {
      throw new ApiError(
        "conflict",
        `The link opens ${JOIN_OPENS_BEFORE_MIN} minutes before the class starts`,
        409,
        { reason: "too_early" },
      );
    }
    if (!s.joinUrl) throw new ApiError("bad_request", "This class has no link yet", 400);

    if (ctx.session.persona === "parent") {
      await recordJoin({
        sessionId,
        studentId,
        householdId: student.householdId || "",
        source: request.headers.get("x-app-platform") ? "app" : "web",
        displayName: student.fullName,
      });
    }
    return apiOk({ joinUrl: s.joinUrl, provider: s.provider });
  } catch (e) {
    return apiErr(e);
  }
}
