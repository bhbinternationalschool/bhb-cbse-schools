import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensurePtmHydratedServer } from "@/lib/ptmPersistence";
import {
  activeBookingForStudent,
  loadPtm,
  modeLabel,
  slotBookedCount,
} from "@/lib/ptm";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

/**
 * GET /api/v1/ptm/overview?studentId= — active PTM events for the child's
 * class with every teacher slot (capacity, seats left) and the family's own
 * booking, if any. Staff may omit studentId to see all active events.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);

    const url = new URL(request.url);
    const studentId = url.searchParams.get("studentId")?.trim() || "";

    await ensureSchoolMirrorHydrated();
    await ensurePtmHydratedServer();

    let classId = "";
    if (ctx.session.persona === "parent") {
      if (!studentId) {
        throw new ApiError("bad_request", "studentId required", 400);
      }
      const sis = loadSis();
      const student = sis.students.find((s) => s.id === studentId);
      if (!student) throw new ApiError("not_found", "Student not found", 404);
      if (
        ctx.session.householdId &&
        student.householdId !== ctx.session.householdId
      ) {
        throw new ApiError("forbidden", "Not your child", 403);
      }
      classId = student.classId;
    }

    const ay = ctx.session.academicYearCode;
    const state = loadPtm();

    const events = state.events
      .filter(
        (e) =>
          e.isActive &&
          (!e.academicYearCode || e.academicYearCode === ay) &&
          (!classId || e.classIds.length === 0 || e.classIds.includes(classId)),
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((event) => {
        const booking = studentId
          ? activeBookingForStudent(state, event.id, studentId)
          : null;
        const slots = state.slots
          .filter((s) => s.eventId === event.id)
          .sort((a, b) => a.startAt.localeCompare(b.startAt))
          .map((s) => {
            const booked = slotBookedCount(state, s.id);
            return {
              id: s.id,
              teacherName: s.teacherName,
              startAt: s.startAt,
              endAt: s.endAt,
              roomOrLink: s.roomOrLink,
              capacity: s.capacity,
              seatsLeft: Math.max(0, s.capacity - booked),
            };
          });
        return {
          id: event.id,
          name: event.name,
          date: event.date,
          endDate: event.endDate,
          mode: event.mode,
          modeLabel: modeLabel(event.mode),
          note: event.note,
          myBooking: booking
            ? {
                id: booking.id,
                slotId: booking.slotId,
                status: booking.status,
                bookedAt: booking.bookedAt,
              }
            : null,
          slots,
        };
      });

    return apiOk({ studentId: studentId || null, events });
  } catch (e) {
    return apiErr(e);
  }
}
