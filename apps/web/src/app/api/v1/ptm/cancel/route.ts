import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensurePtmHydratedServer } from "@/lib/ptmPersistence";
import { cancelPtmBooking, loadPtm, writePtmLocalRaw } from "@/lib/ptm";

export const runtime = "nodejs";

/** POST /api/v1/ptm/cancel — parent cancels their own PTM booking */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "parent") {
      throw new ApiError("forbidden", "Parent session required", 403);
    }

    const body = (await request.json()) as { bookingId?: string };
    const bookingId = body.bookingId?.trim() || "";
    if (!bookingId) throw new ApiError("bad_request", "bookingId required", 400);

    await ensureSchoolMirrorHydrated();
    await ensurePtmHydratedServer();

    const booking = loadPtm().bookings.find((b) => b.id === bookingId);
    if (!booking) throw new ApiError("not_found", "Booking not found", 404);
    if (
      ctx.session.householdId &&
      booking.householdId !== ctx.session.householdId
    ) {
      throw new ApiError("forbidden", "Not your booking", 403);
    }

    const result = cancelPtmBooking(bookingId);
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);

    // cancelPtmBooking's savePtm is a server no-op — apply the status
    // change to the server cache explicitly before pushing.
    const prior = loadPtm();
    const state = {
      ...prior,
      bookings: prior.bookings.map((b) =>
        b.id === bookingId ? { ...b, status: "cancelled" as const } : b,
      ),
    };
    writePtmLocalRaw(state);

    const { pushPtmDeskToDb } = await import("@/lib/ptmNormalized.server");
    const dbPush = await pushPtmDeskToDb({
      version: 1,
      events: state.events,
      slots: state.slots,
      bookings: state.bookings,
      feedback: state.feedback,
    });
    if (!dbPush.ok) console.warn("[ptm-v1] db push failed", dbPush.error);

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "ptm",
      action: "edit",
      entityType: "booking",
      entityId: bookingId,
      summary: `Cancelled PTM booking ${bookingId}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({ bookingId, status: "cancelled" });
  } catch (e) {
    return apiErr(e);
  }
}
