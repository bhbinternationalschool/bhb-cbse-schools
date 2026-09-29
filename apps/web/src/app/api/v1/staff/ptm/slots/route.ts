import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth, type ApiAuthContext } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensurePtmHydratedServer, pushPtmRemoteServer } from "@/lib/ptmPersistence";
import { loadPtm, writePtmLocalRaw, type PtmSlot, type PtmState } from "@/lib/ptm";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { ptmEventReachesScope } from "@/lib/ptmTeacherScope.server";

export const runtime = "nodejs";

type PostBody = {
  eventId?: string;
  starts?: string[];
  durationMinutes?: number;
  capacity?: number;
  roomOrLink?: string;
};

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function staffOf(ctx: ApiAuthContext): { id: string; name: string } {
  const id = ctx.session.staffId || "";
  if (!id) {
    throw new ApiError(
      "forbidden",
      "Your login is not linked to a staff record — ask the office to link it",
      403,
    );
  }
  const name =
    (ctx.masters.staff ?? []).find((s) => s.id === id)?.fullName ||
    ctx.session.fullName ||
    "Teacher";
  return { id, name };
}

async function save(next: PtmState) {
  writePtmLocalRaw(next);
  const pushed = await pushPtmRemoteServer(next);
  if (!pushed.ok) {
    console.warn("[staff-ptm-slots-v1] db push failed", pushed.error);
    throw new ApiError("server_error", "Could not save — try again", 503);
  }
}

/**
 * POST /api/v1/staff/ptm/slots — a teacher adds their OWN slots to a PTM
 * event that includes one of their classes. The slot's teacher is always
 * the signed-in member of staff: the web desk used to let anyone with
 * ptm.edit add slots in any teacher's name (2026-09-29).
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "ptm", "edit");
    const me = staffOf(ctx);
    const body = (await request.json().catch(() => ({}))) as PostBody;
    const eventId = (body.eventId || "").trim();
    if (!eventId) throw new ApiError("bad_request", "eventId required", 400);
    const starts = Array.from(
      new Set((Array.isArray(body.starts) ? body.starts : []).map((s) => String(s).trim())),
    ).filter(Boolean);
    if (!starts.length) throw new ApiError("bad_request", "Add at least one start time", 400);
    const bad = starts.find((s) => !HHMM.test(s));
    if (bad) throw new ApiError("bad_request", `"${bad}" is not a time — use HH:MM, e.g. 10:15`, 400);
    if (starts.length > 40) throw new ApiError("bad_request", "At most 40 slots at a time", 400);
    const dur = Math.min(120, Math.max(5, Math.round(Number(body.durationMinutes) || 15)));
    const capacity = Math.min(20, Math.max(1, Math.round(Number(body.capacity) || 1)));
    const roomOrLink = (body.roomOrLink || "").trim().slice(0, 300);

    const scope = await staffSectionScope(ctx);
    await ensureSchoolMirrorHydrated();
    await ensurePtmHydratedServer();
    const state = loadPtm();
    const event = state.events.find((e) => e.id === eventId);
    if (!event) throw new ApiError("not_found", "PTM event not found", 404);
    if (!event.isActive) throw new ApiError("bad_request", "This PTM event is closed", 400);
    if (!ptmEventReachesScope(event, scope)) {
      throw new ApiError("forbidden", "This PTM is not for any of your classes", 403);
    }
    const taken = new Set(
      state.slots
        .filter((s) => s.eventId === eventId && s.teacherStaffId === me.id)
        .map((s) => s.startAt),
    );
    const dup = starts.find((s) => taken.has(s));
    if (dup) throw new ApiError("conflict", `You already have a slot at ${dup} in this PTM`, 409);

    const created: PtmSlot[] = starts.map((startAt) => {
      const [hh, mm] = startAt.split(":").map(Number);
      const total = (hh || 0) * 60 + (mm || 0) + dur;
      const endAt = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
      return {
        id: nid("ptms"),
        eventId,
        teacherStaffId: me.id,
        teacherName: me.name,
        startAt,
        endAt,
        capacity,
        roomOrLink,
      };
    });
    await save({ ...state, slots: [...created, ...state.slots] });

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "ptm",
      action: "create",
      entityType: "ptm_slot",
      entityId: eventId,
      summary: `Added ${created.length} own PTM slot(s) to ${event.name}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ slots: created });
  } catch (e) {
    return apiErr(e);
  }
}

/**
 * DELETE /api/v1/staff/ptm/slots?slotId= — a teacher removes one of their
 * own slots that nobody has booked. Anyone else's slot is refused.
 */
export async function DELETE(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "ptm", "edit");
    const me = staffOf(ctx);
    const slotId = (new URL(request.url).searchParams.get("slotId") || "").trim();
    if (!slotId) throw new ApiError("bad_request", "slotId required", 400);

    await ensureSchoolMirrorHydrated();
    await ensurePtmHydratedServer();
    const state = loadPtm();
    const slot = state.slots.find((s) => s.id === slotId);
    if (!slot) throw new ApiError("not_found", "Slot not found", 404);
    if (slot.teacherStaffId !== me.id) {
      throw new ApiError("forbidden", "Not your PTM slot", 403);
    }
    const booked = state.bookings.some(
      (b) => b.slotId === slotId && (b.status === "booked" || b.status === "completed"),
    );
    if (booked) {
      throw new ApiError("conflict", "A parent has booked this slot — ask the office to move them first", 409);
    }
    await save({
      ...state,
      slots: state.slots.filter((s) => s.id !== slotId),
      bookings: state.bookings.filter((b) => b.slotId !== slotId),
    });

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "ptm",
      action: "delete",
      entityType: "ptm_slot",
      entityId: slotId,
      summary: `Removed own PTM slot ${slot.startAt}–${slot.endAt}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ slotId });
  } catch (e) {
    return apiErr(e);
  }
}
