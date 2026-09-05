import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensurePtmHydratedServer, pushPtmRemoteServer } from "@/lib/ptmPersistence";
import { loadPtm, writePtmLocalRaw, type PtmBookingStatus, type PtmFeedback, type PtmState } from "@/lib/ptm";
import { staffSectionScope } from "@/lib/api/v1/staffScope";

export const runtime = "nodejs";

type Body = {
  bookingId?: string;
  status?: "completed" | "no_show" | "booked";
  feedback?: { strengths?: string; areas?: string; followUp?: string };
};

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * POST /api/v1/staff/ptm/booking — the teacher marks a booking met /
 * no-show and, when met, records the meeting note (strengths, areas,
 * follow-up) the desk's PTM feedback form takes. Own slots only, unless
 * leadership.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "ptm", "edit");
    const body = (await request.json().catch(() => ({}))) as Body;
    const bookingId = (body.bookingId || "").trim();
    if (!bookingId) throw new ApiError("bad_request", "bookingId required", 400);
    const status: PtmBookingStatus =
      body.status === "no_show" ? "no_show" : body.status === "booked" ? "booked" : "completed";

    const scope = await staffSectionScope(ctx);
    await ensureSchoolMirrorHydrated();
    await ensurePtmHydratedServer();
    const state = loadPtm();
    const booking = state.bookings.find((b) => b.id === bookingId);
    if (!booking) throw new ApiError("not_found", "Booking not found", 404);
    const slot = state.slots.find((s) => s.id === booking.slotId);
    if (!scope.unrestricted && slot?.teacherStaffId !== ctx.session.staffId) {
      throw new ApiError("forbidden", "Not your PTM slot", 403);
    }
    if (booking.status === "cancelled") {
      throw new ApiError("bad_request", "The parent cancelled this booking", 400);
    }

    const fb = body.feedback;
    const hasFeedback =
      !!fb && !!((fb.strengths || "").trim() || (fb.areas || "").trim() || (fb.followUp || "").trim());
    let feedback = state.feedback;
    if (hasFeedback && fb) {
      const record: PtmFeedback = {
        id: nid("ptmf"),
        bookingId,
        studentId: booking.studentId,
        strengths: (fb.strengths || "").trim().slice(0, 600),
        areas: (fb.areas || "").trim().slice(0, 600),
        followUp: (fb.followUp || "").trim().slice(0, 600),
        createdAt: new Date().toISOString(),
        createdBy: ctx.session.fullName || "Teacher",
      };
      feedback = [record, ...feedback.filter((f) => f.bookingId !== bookingId)];
    }
    const finalStatus: PtmBookingStatus = hasFeedback ? "completed" : status;
    const next: PtmState = {
      ...state,
      bookings: state.bookings.map((b) =>
        b.id === bookingId ? { ...b, status: finalStatus } : b,
      ),
      feedback,
    };
    writePtmLocalRaw(next);
    const pushed = await pushPtmRemoteServer(next);
    if (!pushed.ok) {
      console.warn("[staff-ptm-v1] db push failed", pushed.error);
      throw new ApiError("server_error", "Could not save — try again", 503);
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "ptm",
      action: "edit",
      entityType: "ptm_booking",
      entityId: bookingId,
      summary: `PTM booking ${hasFeedback ? "completed with feedback" : status}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ bookingId, status: hasFeedback ? "completed" : status, feedbackSaved: hasFeedback });
  } catch (e) {
    return apiErr(e);
  }
}
