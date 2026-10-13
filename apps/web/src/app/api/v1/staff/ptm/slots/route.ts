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

function toMinutes(hhmm: string): number {
  const [hh, mm] = hhmm.split(":").map(Number);
  return (hh || 0) * 60 + (mm || 0);
}

function fromMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Slot end, or "" when the slot would run past midnight. */
function endOf(startAt: string, dur: number): string {
  const total = toMinutes(startAt) + dur;
  return total >= 24 * 60 ? "" : fromMinutes(total);
}

/**
 * The first of [mine] that [startAt, endAt) overlaps (13 Oct 2026). One
 * teacher cannot sit in two meetings at once; until now only an identical
 * start time was refused, so 10:00–10:15 and 10:10–10:25 both went in.
 */
function overlapping(
  startAt: string,
  endAt: string,
  mine: { startAt: string; endAt: string }[],
): { startAt: string; endAt: string } | undefined {
  const a = toMinutes(startAt);
  const b = toMinutes(endAt);
  return mine.find((s) => {
    if (!HHMM.test(s.startAt) || !HHMM.test(s.endAt)) return s.startAt === startAt;
    return a < toMinutes(s.endAt) && toMinutes(s.startAt) < b;
  });
}

const activeBooking = (status: string) => status === "booked" || status === "completed";

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

/** Writes only the slots named (the rest of this copy may be stale). */
async function save(
  next: PtmState,
  change: { only: { slots: string[] }; deletes?: Record<string, string[]> },
) {
  writePtmLocalRaw(next);
  const pushed = await pushPtmRemoteServer(next, change);
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
    const mine = state.slots.filter((s) => s.eventId === eventId && s.teacherStaffId === me.id);
    const taken = new Set(mine.map((s) => s.startAt));
    const dup = starts.find((s) => taken.has(s));
    if (dup) throw new ApiError("conflict", `You already have a slot at ${dup} in this PTM`, 409);
    const late = starts.find((s) => !endOf(s, dur));
    if (late) throw new ApiError("bad_request", `A ${dur}-minute slot at ${late} would run past midnight`, 400);
    // Against my existing slots, and against each other.
    const planned: { startAt: string; endAt: string }[] = [...mine];
    for (const startAt of [...starts].sort()) {
      const endAt = endOf(startAt, dur);
      const clash = overlapping(startAt, endAt, planned);
      if (clash) {
        throw new ApiError(
          "conflict",
          `${startAt}–${endAt} overlaps your slot ${clash.startAt}–${clash.endAt}`,
          409,
        );
      }
      planned.push({ startAt, endAt });
    }

    const created: PtmSlot[] = starts.map((startAt) => {
      const endAt = endOf(startAt, dur);
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
    await save({ ...state, slots: [...created, ...state.slots] }, { only: { slots: created.map((x) => x.id) } });

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
    const booked = state.bookings.some((b) => b.slotId === slotId && activeBooking(b.status));
    if (booked) {
      throw new ApiError("conflict", "A parent has booked this slot — ask the office to move them first", 409);
    }
    await save({
      ...state,
      slots: state.slots.filter((s) => s.id !== slotId),
      bookings: state.bookings.filter((b) => b.slotId !== slotId),
    }, {
      // Named: a desk save never deletes by absence, so without this the
      // slot stayed in the database. Its cancelled bookings go by cascade.
      only: { slots: [] },
      deletes: { ptm_desk_slots: [slotId] },
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

type PatchBody = {
  slotId?: string;
  startAt?: string;
  durationMinutes?: number;
  capacity?: number;
  roomOrLink?: string;
};

/**
 * PATCH /api/v1/staff/ptm/slots — a teacher changes one of their OWN slots
 * (time, length, capacity, room/link) while nobody has booked it
 * (13 Oct 2026). A booked slot is the family's appointment: it is not
 * moved under them — the office moves the family first, as with DELETE.
 */
export async function PATCH(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "ptm", "edit");
    const me = staffOf(ctx);
    const body = (await request.json().catch(() => ({}))) as PatchBody;
    const slotId = (body.slotId || "").trim();
    if (!slotId) throw new ApiError("bad_request", "slotId required", 400);

    await ensureSchoolMirrorHydrated();
    await ensurePtmHydratedServer();
    const state = loadPtm();
    const slot = state.slots.find((s) => s.id === slotId);
    if (!slot) throw new ApiError("not_found", "Slot not found", 404);
    if (slot.teacherStaffId !== me.id) {
      throw new ApiError("forbidden", "Not your PTM slot", 403);
    }
    const event = state.events.find((e) => e.id === slot.eventId);
    if (!event) throw new ApiError("not_found", "PTM event not found", 404);
    if (!event.isActive) throw new ApiError("bad_request", "This PTM event is closed", 400);
    if (state.bookings.some((b) => b.slotId === slotId && activeBooking(b.status))) {
      throw new ApiError("conflict", "A parent has booked this slot — ask the office to move them first", 409);
    }

    const startAt = body.startAt === undefined ? slot.startAt : String(body.startAt).trim();
    if (!HHMM.test(startAt)) {
      throw new ApiError("bad_request", `"${startAt}" is not a time — use HH:MM, e.g. 10:15`, 400);
    }
    const currentDur =
      HHMM.test(slot.startAt) && HHMM.test(slot.endAt)
        ? toMinutes(slot.endAt) - toMinutes(slot.startAt)
        : 15;
    const dur =
      body.durationMinutes === undefined
        ? Math.min(120, Math.max(5, currentDur))
        : Math.min(120, Math.max(5, Math.round(Number(body.durationMinutes) || 15)));
    const endAt = endOf(startAt, dur);
    if (!endAt) throw new ApiError("bad_request", `A ${dur}-minute slot at ${startAt} would run past midnight`, 400);
    const capacity =
      body.capacity === undefined
        ? slot.capacity
        : Math.min(20, Math.max(1, Math.round(Number(body.capacity) || 1)));
    const roomOrLink =
      body.roomOrLink === undefined ? slot.roomOrLink : String(body.roomOrLink).trim().slice(0, 300);

    const others = state.slots.filter(
      (s) => s.eventId === slot.eventId && s.teacherStaffId === me.id && s.id !== slotId,
    );
    const clash = overlapping(startAt, endAt, others);
    if (clash) {
      throw new ApiError("conflict", `${startAt}–${endAt} overlaps your slot ${clash.startAt}–${clash.endAt}`, 409);
    }

    const next: PtmSlot = { ...slot, startAt, endAt, capacity, roomOrLink, teacherName: me.name };
    await save(
      { ...state, slots: state.slots.map((s) => (s.id === slotId ? next : s)) },
      { only: { slots: [slotId] } },
    );

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "ptm",
      action: "edit",
      entityType: "ptm_slot",
      entityId: slotId,
      summary: `Changed own PTM slot ${slot.startAt}–${slot.endAt} → ${startAt}–${endAt}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ slot: next });
  } catch (e) {
    return apiErr(e);
  }
}
