import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensurePtmHydratedServer } from "@/lib/ptmPersistence";
import { loadPtm, modeLabel, ptmBookingMobile } from "@/lib/ptm";
import { loadSis } from "@/lib/sis";
import { staffSectionScope } from "@/lib/api/v1/staffScope";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/ptm — the teacher's side of PTM: every active event
 * with the slots that are theirs and who has booked each one (child, class,
 * parent, WhatsApp number), plus feedback already written. Leadership sees
 * every teacher's slots.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "ptm", "view");
    const staffId = ctx.session.staffId || "";
    const scope = await staffSectionScope(ctx);

    await ensureSchoolMirrorHydrated();
    await Promise.all([ensureSisHydratedServer(), ensurePtmHydratedServer()]);
    const ay = ctx.session.academicYearCode;
    const state = loadPtm();
    const sis = loadSis();
    const studentById = new Map(sis.students.map((s) => [s.id, s]));
    const classNameOf = (id: string) =>
      ctx.masters.classes.find((c) => c.id === id)?.name || "";
    const sectionNameOf = (id: string) =>
      ctx.masters.sections.find((s) => s.id === id)?.name || "";
    const feedbackByBooking = new Map(state.feedback.map((f) => [f.bookingId, f]));

    const events = state.events
      .filter((e) => e.isActive && (!e.academicYearCode || e.academicYearCode === ay))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((event) => {
        const slots = state.slots
          .filter(
            (s) =>
              s.eventId === event.id &&
              (s.teacherStaffId === staffId || (scope.unrestricted && !staffId)),
          )
          .sort((a, b) => a.startAt.localeCompare(b.startAt))
          .map((s) => {
            const bookings = state.bookings
              .filter((b) => b.slotId === s.id && b.status !== "cancelled")
              .map((b) => {
                const st = studentById.get(b.studentId);
                const fb = feedbackByBooking.get(b.id);
                return {
                  id: b.id,
                  status: b.status,
                  studentId: b.studentId,
                  studentName: st?.fullName || "",
                  classLabel: st
                    ? `${classNameOf(st.classId)} ${sectionNameOf(st.sectionId)}`.trim()
                    : "",
                  parentName: b.parentName,
                  mobile: ptmBookingMobile(b, sis),
                  bookedAt: b.bookedAt,
                  feedback: fb
                    ? { strengths: fb.strengths, areas: fb.areas, followUp: fb.followUp }
                    : null,
                };
              });
            return {
              id: s.id,
              teacherName: s.teacherName,
              isMine: s.teacherStaffId === staffId,
              startAt: s.startAt,
              endAt: s.endAt,
              roomOrLink: s.roomOrLink,
              capacity: s.capacity,
              bookings,
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
          slots,
          bookingCount: slots.reduce((n, s) => n + s.bookings.length, 0),
        };
      })
      .filter((e) => e.slots.length > 0 || scope.unrestricted);

    return apiOk({ staffId, events });
  } catch (e) {
    return apiErr(e);
  }
}
