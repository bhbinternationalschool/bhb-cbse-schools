import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { assertSectionScope } from "@/lib/api/v1/staffScope";
import {
  getSession,
  listJoins,
  sectionRoster,
  syncMeetAttendance,
} from "@/lib/onlineClasses.server";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/staff/online-classes/:id/attendance — the section roster
 * with who joined, from the app's own Join taps and any Meet sync.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "online_classes", "view");
    await ensureSchoolMirrorHydrated();
    const { id } = await params;
    const s = await getSession(id);
    if (!s) throw new ApiError("not_found", "Class not found", 404);
    await assertSectionScope(ctx, s.classId, s.sectionId);

    const [roster, joins] = await Promise.all([
      sectionRoster(s.classId, s.sectionId, s.academicYearCode),
      listJoins(id),
    ]);
    const byStudent = new Map(joins.map((j) => [j.studentId, j]));
    const rows = roster.map((c) => {
      const j = byStudent.get(c.studentId);
      return {
        studentId: c.studentId,
        fullName: c.fullName,
        rollNo: c.rollNo,
        joined: !!j,
        source: j?.source || "",
        firstJoinedAt: j?.firstJoinedAt || "",
        minutes: j?.minutes || 0,
      };
    });
    return apiOk({
      sessionId: id,
      status: s.status,
      provider: s.provider,
      canSync: s.provider === "google_meet" && !!s.meetSpaceName,
      attendanceSyncedAt: s.attendanceSyncedAt,
      total: rows.length,
      joined: rows.filter((r) => r.joined).length,
      rows,
    });
  } catch (e) {
    return apiErr(e);
  }
}

/** POST — pull the participant list from Google Meet and match it to the roster. */
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "online_classes", "edit");
    await ensureSchoolMirrorHydrated();
    const { id } = await params;
    const s = await getSession(id);
    if (!s) throw new ApiError("not_found", "Class not found", 404);
    await assertSectionScope(ctx, s.classId, s.sectionId);
    const r = await syncMeetAttendance(s, {
      teacherEmail: s.teacherId === (ctx.session.staffId || "") ? ctx.session.email : undefined,
    });
    if (!r.ok) {
      throw new ApiError(
        r.reconnect ? "conflict" : "bad_request",
        r.error,
        r.reconnect ? 409 : 400,
        r.reconnect ? { reason: "google_reconnect" } : undefined,
      );
    }
    return apiOk(r.value);
  } catch (e) {
    return apiErr(e);
  }
}
