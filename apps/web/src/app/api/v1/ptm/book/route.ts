import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { bookPtmSlotServer } from "@/lib/ptmBook.server";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

type BookBody = { eventId: string; slotId: string; studentId: string };

/** POST /api/v1/ptm/book — parent books a PTM slot for their child */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "parent") {
      throw new ApiError("forbidden", "Parent session required", 403);
    }

    const body = (await request.json()) as BookBody;
    if (!body.eventId || !body.slotId || !body.studentId) {
      throw new ApiError(
        "bad_request",
        "eventId, slotId, studentId required",
        400,
      );
    }

    await ensureSchoolMirrorHydrated();

    const sis = loadSis();
    const student = sis.students.find((s) => s.id === body.studentId);
    if (!student) throw new ApiError("not_found", "Student not found", 404);
    if (
      ctx.session.householdId &&
      student.householdId !== ctx.session.householdId
    ) {
      throw new ApiError("forbidden", "Not your child", 403);
    }

    // The parent is doing this themselves, so there is nobody to notify.
    const result = await bookPtmSlotServer({
      studentId: body.studentId,
      eventId: body.eventId,
      slotId: body.slotId,
      parentName: ctx.session.fullName,
      householdId: ctx.session.householdId || student.householdId || "",
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "ptm",
      action: "edit",
      entityType: "booking",
      entityId: result.booking.id,
      summary: `Booked PTM slot ${body.slotId} for ${student.fullName}`,
      after: { eventId: body.eventId, slotId: body.slotId },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({
      bookingId: result.booking.id,
      slotId: result.booking.slotId,
      status: result.booking.status,
      bookedAt: result.booking.bookedAt,
    });
  } catch (e) {
    return apiErr(e);
  }
}
