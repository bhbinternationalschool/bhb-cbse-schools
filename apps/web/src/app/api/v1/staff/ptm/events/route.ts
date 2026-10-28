import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature, hasMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { ensurePtmHydratedServer, pushPtmRemoteServer } from "@/lib/ptmPersistence";
import { loadPtm, writePtmLocalRaw } from "@/lib/ptm";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { planPtmEvent, ptmScheduleClasses, type PtmScheduleInput } from "@/lib/ptmSchedule";
import { todayIst } from "@/lib/attendanceCover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Scheduling a PTM from the staff app (request mr_mv9yydt031or).
 *
 * GET  — the classes this person may put in a PTM (a teacher: classes they
 *        teach a section of; the office / leadership: every class) and
 *        whether they may schedule at all.
 * POST {name, date, endDate?, classIds[], mode?, note?} — ONE event covering
 *        every class picked, the web desk's own model (lib/ptm.ts). Only that
 *        event row is written; nothing else on the desk is touched.
 *
 * Gates: the app's PTM screen (`ptm_meet`), ptm·edit, and the teacher's
 * section scope (lib/ptmSchedule.ts).
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "ptm", "view");
    let canEdit = false;
    try {
      assertPermission(ctx, "ptm", "edit");
      canEdit = true;
    } catch {
      canEdit = false;
    }
    const scope = await staffSectionScope(ctx);
    const classes = ptmScheduleClasses(scope, ctx.masters.classes ?? []);
    const canSchedule = canEdit && hasMobileFeature(ctx, "ptm_meet") && classes.length > 0;
    return apiOk({
      canSchedule,
      unrestricted: scope.unrestricted,
      today: todayIst(),
      classes: canSchedule ? classes : [],
    });
  } catch (e) {
    return apiErr(e);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertMobileFeature(ctx, "ptm_meet");
    assertPermission(ctx, "ptm", "edit");
    const body = (await request.json().catch(() => ({}))) as PtmScheduleInput;
    // Scope reads Masters (ctx) and the timetable itself; the PTM desk is
    // hydrated on its own below — no whole-school replica is needed.
    const scope = await staffSectionScope(ctx);
    const planned = planPtmEvent({
      body,
      scope,
      classes: ctx.masters.classes ?? [],
      academicYearCode: scope.academicYearCode || ctx.session.academicYearCode,
      today: todayIst(),
      id: nid("ptme"),
      now: new Date().toISOString(),
    });
    if (!planned.ok) {
      throw new ApiError(planned.status === 403 ? "forbidden" : "bad_request", planned.error, planned.status);
    }
    const event = planned.event;

    await ensurePtmHydratedServer();
    const state = loadPtm();
    const next = { ...state, events: [event, ...state.events] };
    writePtmLocalRaw(next);
    // Names the one new row: a server writer never re-writes what it did
    // not change (lib/ptmNormalized.server.ts).
    const pushed = await pushPtmRemoteServer(next, { only: { events: [event.id] } });
    if (!pushed.ok) {
      console.warn("[staff-ptm-events-v1] db push failed", pushed.error);
      throw new ApiError("server_error", "Could not save — try again", 503);
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "ptm",
      action: "create",
      entityType: "ptm_event",
      entityId: event.id,
      summary: `Scheduled PTM "${event.name}" on ${event.date} for ${event.classIds.length} class(es) from the app`,
      after: { date: event.date, endDate: event.endDate, classIds: event.classIds, mode: event.mode },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ event });
  } catch (e) {
    return apiErr(e);
  }
}
