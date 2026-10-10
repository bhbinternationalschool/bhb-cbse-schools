import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureTimetableHydratedServer } from "@/lib/timetablePersistence";
import { loadTimetable, teachingPeriods } from "@/lib/timetable";
import {
  assertSectionScope,
  sectionKey,
  staffSectionScope,
} from "@/lib/api/v1/staffScope";
import {
  getStaffConnection,
  staffConnectionKey,
} from "@/lib/googleClassroom.store.server";
import {
  googleClassroomOAuthConfigured,
  scopesAllowMeet,
} from "@/lib/googleOAuth.server";
import {
  istNow,
  onlineClassInputMessage,
  onlineClassPhase,
  readOnlineClassInput,
  type OnlineClassSession,
} from "@/lib/onlineClasses";
import {
  announceSession,
  applySessionAction,
  createSession,
  getSession,
  joinCountsFor,
  listSessions,
  updateSessionDetails,
  type SessionAction,
} from "@/lib/onlineClasses.server";
import type { ApiAuthContext } from "@/lib/api/v1/auth";

export const runtime = "nodejs";

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function sessionJson(ctx: ApiAuthContext, s: OnlineClassSession, joined = 0) {
  const m = ctx.masters;
  return {
    ...s,
    className: m.classes.find((c) => c.id === s.classId)?.name || "",
    sectionName: m.sections.find((x) => x.id === s.sectionId)?.name || "",
    subjectName: m.subjects.find((x) => x.id === s.subjectId)?.nameEn || "",
    teacherName: m.staff.find((x) => x.id === s.teacherId)?.fullName || "",
    phase: onlineClassPhase(s),
    joinedCount: joined,
  };
}

async function googleStatus(ctx: ApiAuthContext, staffId: string) {
  const own = !staffId || staffId === (ctx.session.staffId || "");
  const key = staffConnectionKey({
    staffId: staffId || ctx.session.staffId,
    email: own ? ctx.session.email : undefined,
    fullName: own ? ctx.session.fullName : undefined,
  });
  const conn = await getStaffConnection(key);
  return {
    oauthConfigured: googleClassroomOAuthConfigured(),
    connected: !!conn,
    email: conn?.email || "",
    // '' scopes = legacy disk row; let Meet try and report.
    canMeet: !!conn && (!conn.scopes || scopesAllowMeet(conn.scopes)),
    connectUrl: "/api/integrations/google/classroom/connect?returnTo=online-classes",
  };
}

/**
 * GET /api/v1/staff/online-classes?range=today|week|upcoming|past
 *   &sectionId=&teacherId=
 *
 * Teachers see the sections they teach; leadership and the office see the
 * school. Carries everything the scheduling form needs (sections in scope,
 * subjects, teachers, bell periods, this person's Google status) so the
 * phone makes one call.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "online_classes", "view");
    await ensureSchoolMirrorHydrated();
    const scope = await staffSectionScope(ctx);

    const url = new URL(request.url);
    const range = url.searchParams.get("range") || "week";
    const sectionFilter = url.searchParams.get("sectionId")?.trim() || "";
    const teacherFilter = url.searchParams.get("teacherId")?.trim() || "";
    const today = istNow().date;
    let fromDate = today;
    let toDate = today;
    if (range === "week") toDate = addDays(today, 6);
    else if (range === "upcoming") toDate = addDays(today, 60);
    else if (range === "past") {
      fromDate = addDays(today, -60);
      toDate = addDays(today, -1);
    } else if (range === "all") {
      fromDate = addDays(today, -60);
      toDate = addDays(today, 60);
    }

    const sectionsInScope = ctx.masters.sections
      .filter((s) => s.isActive !== false)
      .filter((s) => scope.unrestricted || scope.sections.has(sectionKey(s.classId, s.id)))
      .map((s) => ({
        classId: s.classId,
        sectionId: s.id,
        className: ctx.masters.classes.find((c) => c.id === s.classId)?.name || "",
        sectionName: s.name,
      }))
      .sort((a, b) => a.className.localeCompare(b.className, undefined, { numeric: true }) || a.sectionName.localeCompare(b.sectionName));

    const sessions = await listSessions({
      fromDate,
      toDate,
      sectionIds: scope.unrestricted
        ? sectionFilter
          ? [sectionFilter]
          : undefined
        : sectionsInScope
            .map((s) => s.sectionId)
            .filter((id) => !sectionFilter || id === sectionFilter),
      teacherId: teacherFilter || undefined,
    });
    const counts = await joinCountsFor(sessions.map((s) => s.id));

    await ensureTimetableHydratedServer();
    const tt = loadTimetable();
    const bell = teachingPeriods(tt.bellTemplate).map((b) => ({
      no: b.no,
      label: b.label || `Period ${b.no}`,
      startTime: b.startTime,
      endTime: b.endTime,
    }));

    const teachers = scope.unrestricted
      ? ctx.masters.staff
          .filter((s) => s.status === "active")
          .map((s) => ({ id: s.id, fullName: s.fullName }))
          .sort((a, b) => a.fullName.localeCompare(b.fullName))
      : [];

    return apiOk({
      today,
      range,
      staffId: ctx.session.staffId || "",
      unrestricted: scope.unrestricted,
      canSchedule: (() => {
        try {
          assertPermission(ctx, "online_classes", "create");
          return true;
        } catch {
          return false;
        }
      })(),
      sessions: sessions.map((s) => sessionJson(ctx, s, counts.get(s.id) || 0)),
      sections: sectionsInScope,
      subjects: ctx.masters.subjects
        .map((s) => ({ id: s.id, name: s.nameEn }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      teachers,
      bell,
      google: await googleStatus(ctx, ""),
    });
  } catch (e) {
    return apiErr(e);
  }
}

/**
 * POST /api/v1/staff/online-classes — schedule one. Body is an
 * OnlineClassInput plus `announce` (default true). A teacher can only host
 * their own; the office may name any teacher.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "online_classes", "create");
    await ensureSchoolMirrorHydrated();

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = readOnlineClassInput(body);
    if (!parsed.ok) {
      throw new ApiError("bad_request", onlineClassInputMessage(parsed.error), 400);
    }
    const input = parsed.value;
    const scope = await assertSectionScope(ctx, input.classId, input.sectionId);
    const own = ctx.session.staffId || "";
    if (!scope.unrestricted) {
      if (input.teacherId && input.teacherId !== own) {
        throw new ApiError("forbidden", "You can only schedule classes you host yourself", 403);
      }
      input.teacherId = own;
    } else if (!input.teacherId) {
      input.teacherId = own;
    }
    if (input.teacherId && !ctx.masters.staff.some((s) => s.id === input.teacherId)) {
      throw new ApiError("bad_request", "Unknown teacher", 400);
    }

    const created = await createSession(input, {
      academicYearCode: ctx.session.academicYearCode,
      createdBy: ctx.session.fullName || ctx.session.email || own,
      teacherEmail: input.teacherId === own ? ctx.session.email : undefined,
    });
    if (!created.ok) {
      throw new ApiError(
        created.reconnect ? "conflict" : "bad_request",
        created.error,
        created.reconnect ? 409 : 400,
        created.reconnect ? { reason: "google_reconnect" } : undefined,
      );
    }
    const announce = body.announce !== false;
    const announced = announce ? await announceSession(created.value) : null;
    const fresh = (await getSession(created.value.id)) || created.value;
    return apiOk({ session: sessionJson(ctx, fresh), announced });
  } catch (e) {
    return apiErr(e);
  }
}

const ACTIONS: SessionAction[] = ["start", "end", "cancel", "reopen"];

/**
 * PATCH /api/v1/staff/online-classes — { id, action } to start / end /
 * cancel / reopen, or { id, patch: {...} } to move an unstarted class.
 * Teachers may only touch classes in their sections.
 */
export async function PATCH(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "online_classes", "edit");
    await ensureSchoolMirrorHydrated();
    const body = (await request.json().catch(() => ({}))) as {
      id?: unknown;
      action?: unknown;
      patch?: Record<string, unknown>;
      announce?: unknown;
    };
    const id = String(body.id ?? "").trim();
    if (!id) throw new ApiError("bad_request", "id required", 400);
    const current = await getSession(id);
    if (!current) throw new ApiError("not_found", "Class not found", 404);
    await assertSectionScope(ctx, current.classId, current.sectionId);

    if (body.action !== undefined) {
      const action = String(body.action) as SessionAction;
      if (!ACTIONS.includes(action)) {
        throw new ApiError("bad_request", `action must be one of ${ACTIONS.join(", ")}`, 400);
      }
      const r = await applySessionAction(id, action);
      if (!r.ok) throw new ApiError("bad_request", r.error, 400);
      return apiOk({ session: sessionJson(ctx, r.value) });
    }

    if (body.announce === true) {
      const announced = await announceSession(current);
      return apiOk({ session: sessionJson(ctx, current), announced });
    }

    const patch = body.patch || {};
    const merged = readOnlineClassInput({
      classId: current.classId,
      sectionId: current.sectionId,
      subjectId: patch.subjectId ?? current.subjectId,
      teacherId: patch.teacherId ?? current.teacherId,
      title: patch.title ?? current.title,
      date: patch.date ?? current.date,
      startTime: patch.startTime ?? current.startTime,
      endTime: patch.endTime ?? current.endTime,
      periodNo: current.periodNo,
      provider: current.provider,
      joinUrl: patch.joinUrl ?? current.joinUrl,
      note: patch.note ?? current.note,
    });
    if (!merged.ok) {
      throw new ApiError("bad_request", onlineClassInputMessage(merged.error), 400);
    }
    const scope = await staffSectionScope(ctx);
    if (!scope.unrestricted && merged.value.teacherId !== (ctx.session.staffId || "")) {
      throw new ApiError("forbidden", "You can only edit classes you host", 403);
    }
    const r = await updateSessionDetails(id, {
      title: merged.value.title,
      date: merged.value.date,
      startTime: merged.value.startTime,
      endTime: merged.value.endTime,
      note: merged.value.note,
      subjectId: merged.value.subjectId,
      teacherId: merged.value.teacherId,
      joinUrl: current.provider === "link" ? merged.value.joinUrl : undefined,
    });
    if (!r.ok) throw new ApiError("bad_request", r.error, 400);
    return apiOk({ session: sessionJson(ctx, r.value) });
  } catch (e) {
    return apiErr(e);
  }
}
