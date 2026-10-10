import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import { loadAttendance } from "@/lib/attendance";
import { assertSectionScope } from "@/lib/api/v1/staffScope";
import { proposeRegisterStatus } from "@/lib/onlineClasses";
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
 * with who joined (the app's own Join taps plus any Meet sync), the
 * register already marked for that date if there is one, and a proposed
 * register mark per child. The proposal is what "Mark register from this
 * class" starts from; the teacher edits it before it is saved.
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
      ensureAttendanceHydratedServer(),
    ]);
    const ay = s.academicYearCode || ctx.session.academicYearCode;
    const register = loadAttendance().registers.find(
      (r) => r.sectionId === s.sectionId && r.date === s.date && r.academicYearCode === ay,
    );
    const existing = new Map((register?.marks ?? []).map((m) => [m.studentId, m.status]));
    const byStudent = new Map(joins.map((j) => [j.studentId, j]));
    const rows = roster.map((c) => {
      const j = byStudent.get(c.studentId);
      const registerStatus = existing.get(c.studentId) || "";
      return {
        studentId: c.studentId,
        fullName: c.fullName,
        rollNo: c.rollNo,
        joined: !!j,
        source: j?.source || "",
        firstJoinedAt: j?.firstJoinedAt || "",
        minutes: j?.minutes || 0,
        registerStatus,
        proposedStatus: proposeRegisterStatus(!!j, registerStatus || null),
      };
    });
    let canMarkRegister = false;
    try {
      assertPermission(ctx, "attendance", "edit");
      canMarkRegister = true;
    } catch {
      /* view only */
    }
    return apiOk({
      sessionId: id,
      date: s.date,
      status: s.status,
      provider: s.provider,
      canSync: s.provider === "google_meet" && !!s.meetSpaceName,
      attendanceSyncedAt: s.attendanceSyncedAt,
      total: rows.length,
      joined: rows.filter((r) => r.joined).length,
      register: register
        ? {
            markedBy: register.markedBy,
            markedAt: register.markedAt,
            present: register.marks.filter((m) => m.status === "P").length,
            count: register.marks.length,
          }
        : null,
      canMarkRegister,
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
