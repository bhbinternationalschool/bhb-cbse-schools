import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";
import {
  HEALTH_VISIT_REASONS,
  emptyHealthState,
  healthVisitReasonLabel,
  normalizeHealthState,
  upsertVisit,
  type HealthState,
  type HealthVisitReason,
} from "@/lib/health";
import { readModuleLocalState, writeModuleLocalState } from "@/lib/moduleLocalState.server";
import { scopeAllows, staffSectionScope } from "@/lib/api/v1/staffScope";
import { sendPushToSubject } from "@/lib/webPush.server";

export const runtime = "nodejs";

const REASON_CODES = new Set(HEALTH_VISIT_REASONS.map((r) => r.value));
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

async function loadState(): Promise<HealthState> {
  const row = await readModuleLocalState<unknown>("health");
  if (row === null) throw new ApiError("server_error", "Health records are unavailable right now", 503);
  return row.state ? normalizeHealthState(row.state) : emptyHealthState();
}

function istNow(): { date: string; time: string } {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return { date: ist.toISOString().slice(0, 10), time: ist.toISOString().slice(11, 16) };
}

/** GET /api/v1/staff/health?classId=&sectionId=[&studentId=] — recent sick-room visits, in scope. */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "health", "view");
    const url = new URL(request.url);
    const classId = url.searchParams.get("classId")?.trim() || "";
    const sectionId = url.searchParams.get("sectionId")?.trim() || "";
    const studentId = url.searchParams.get("studentId")?.trim() || "";
    const scope = await staffSectionScope(ctx);

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const sis = loadSis();
    const ay = ctx.session.academicYearCode;
    const wanted = sis.students.filter(
      (s) =>
        s.academicYearCode === ay &&
        (studentId ? s.id === studentId : s.classId === classId && s.sectionId === sectionId) &&
        scopeAllows(scope, s.classId, s.sectionId),
    );
    if (!wanted.length && (studentId || classId)) {
      throw new ApiError("forbidden", "Not a student of your class", 403);
    }
    const ids = new Set(wanted.map((s) => s.id));
    const nameOf = new Map(wanted.map((s) => [s.id, s.fullName]));
    const staffNameOf = (id: string) =>
      ctx.masters.staff.find((s) => s.id === id)?.fullName || "";

    const state = await loadState();
    const visits = state.visits
      .filter((v) => ids.has(v.studentId) && (!v.academicYearCode || v.academicYearCode === ay))
      .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time))
      .slice(0, 100)
      .map((v) => ({
        id: v.id,
        studentId: v.studentId,
        studentName: nameOf.get(v.studentId) || "",
        date: v.date,
        time: v.time,
        reason: v.reason,
        reasonLabel: healthVisitReasonLabel(v.reason),
        symptoms: v.symptoms,
        actionTaken: v.actionTaken,
        referredToHospital: v.referredToHospital,
        reportedBy: staffNameOf(v.reportedByStaffId),
        notifiedParentAt: v.notifiedParentAt,
      }));
    return apiOk({ reasons: HEALTH_VISIT_REASONS, visits });
  } catch (e) {
    return apiErr(e);
  }
}

type Body = {
  studentId?: string;
  date?: string;
  time?: string;
  reason?: string;
  symptoms?: string;
  actionTaken?: string;
  referredToHospital?: boolean;
  notifyParent?: boolean;
};

/** POST /api/v1/staff/health — record a sick-room / first-aid visit for one child. */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "health", "create");
    const body = (await request.json().catch(() => ({}))) as Body;
    const now = istNow();
    const studentId = (body.studentId || "").trim();
    const date = (body.date || "").trim() || now.date;
    const time = (body.time || "").trim() || now.time;
    const reason = (body.reason || "").trim() as HealthVisitReason;
    const symptoms = (body.symptoms || "").trim().slice(0, 500);
    const actionTaken = (body.actionTaken || "").trim().slice(0, 500);
    if (!studentId) throw new ApiError("bad_request", "studentId required", 400);
    if (!ISO_DAY.test(date)) throw new ApiError("bad_request", "date must be YYYY-MM-DD", 400);
    if (!HHMM.test(time)) throw new ApiError("bad_request", "time must be HH:MM", 400);
    if (!REASON_CODES.has(reason)) throw new ApiError("bad_request", "Unknown reason", 400);
    if (symptoms.length < 3) throw new ApiError("bad_request", "Say what the child reported", 400);

    const scope = await staffSectionScope(ctx);
    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const sis = loadSis();
    const student = sis.students.find((s) => s.id === studentId);
    if (!student) throw new ApiError("not_found", "Student not found", 404);
    if (!scopeAllows(scope, student.classId, student.sectionId)) {
      throw new ApiError("forbidden", "Not a student of your class", 403);
    }

    const state = await loadState();
    const notifiedAt = body.notifyParent && student.householdId ? new Date().toISOString() : null;
    const { state: next, visit } = upsertVisit(state, {
      studentId,
      academicYearCode: ctx.session.academicYearCode,
      date,
      time,
      reason,
      symptoms,
      actionTaken,
      referredToHospital: !!body.referredToHospital,
      reportedByStaffId: ctx.session.staffId || "",
      notifiedParentAt: notifiedAt,
    });
    const written = await writeModuleLocalState("health", next);
    if (!written.ok) throw new ApiError("server_error", "Could not save — try again", 503);

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "health",
      action: "create",
      entityType: "health_visit",
      entityId: visit.id,
      summary: `Health visit for ${student.fullName}: ${healthVisitReasonLabel(reason)} ${date} ${time}${body.referredToHospital ? " (referred)" : ""}`,
      after: { studentId, date, time, reason, referredToHospital: !!body.referredToHospital },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    let parentNotified = false;
    if (body.notifyParent && student.householdId) {
      const r = await sendPushToSubject("parent", student.householdId, {
        title: body.referredToHospital
          ? `${student.fullName} — please call the school`
          : `${student.fullName} visited the sick room`,
        body: `${healthVisitReasonLabel(reason)} at ${time}: ${symptoms.slice(0, 100)}${actionTaken ? ` · ${actionTaken.slice(0, 80)}` : ""}`,
        url: `/profile?studentId=${encodeURIComponent(student.id)}`,
        data: { kind: "health", studentId: student.id, visitId: visit.id },
      }).catch(() => ({ sent: 0, expired: 0, failed: 0 }));
      parentNotified = r.sent > 0;
    }
    return apiOk({ id: visit.id, parentNotified });
  } catch (e) {
    return apiErr(e);
  }
}
