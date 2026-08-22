import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { appendBoardingEventToDb } from "@/lib/transportNormalized.server";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * POST /api/v1/transport/boarding
 *
 * A driver or attendant marks one child on or off the bus, with the phone's
 * location at that moment.
 *
 * The pin is the point of this. "Marked boarded at 07:42" is a claim; "marked
 * boarded at 07:42, 40 m from Ayar Mod" is evidence, and it is what answers a
 * parent asking where their child was picked up.
 *
 * Location is required for a boarding or offboarding mark and refused without
 * it — a mark with no pin looks identical to one with a pin on the roster, and
 * the whole record would quietly become untrustworthy. "absent" needs no pin,
 * because nobody got on.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff" && ctx.session.persona !== "field") {
      throw new ApiError("forbidden", "Driver or attendant sign-in required", 403);
    }

    let body: {
      routeId?: string;
      studentId?: string;
      trip?: string;
      kind?: string;
      lat?: number;
      lng?: number;
      accuracyM?: number;
      note?: string;
      date?: string;
    };
    try {
      body = await request.json();
    } catch {
      throw new ApiError("bad_request", "Invalid JSON", 400);
    }

    const routeId = (body.routeId || "").trim();
    const studentId = (body.studentId || "").trim();
    if (!routeId || !studentId) {
      throw new ApiError("bad_request", "routeId and studentId are required", 400);
    }

    const trip = body.trip === "PM" ? "PM" : "AM";
    const kind =
      body.kind === "offboarded"
        ? "offboarded"
        : body.kind === "absent"
          ? "absent"
          : "boarded";
    const date = (body.date || new Date().toISOString().slice(0, 10)).slice(0, 10);

    const hasGeo =
      typeof body.lat === "number" &&
      typeof body.lng === "number" &&
      Number.isFinite(body.lat) &&
      Number.isFinite(body.lng) &&
      (body.lat !== 0 || body.lng !== 0);

    if (kind !== "absent" && !hasGeo) {
      throw new ApiError(
        "bad_request",
        "Location is required to mark a child on or off the bus",
        400,
      );
    }

    const capture = hasGeo
      ? {
          lat: body.lat as number,
          lng: body.lng as number,
          accuracyM:
            typeof body.accuracyM === "number" ? body.accuracyM : null,
          at: new Date().toISOString(),
          distanceFromSchoolKm:
            Math.round(
              haversineKm(
                body.lat as number,
                body.lng as number,
                TENANT.schoolLat,
                TENANT.schoolLng,
              ) * 10,
            ) / 10,
        }
      : null;

    const result = await appendBoardingEventToDb({
      id: `brd_${Math.random().toString(36).slice(2, 10)}`,
      date,
      routeId,
      trip,
      studentId,
      status: kind === "absent" ? "absent" : "boarded",
      note: (body.note || "").slice(0, 200),
      createdAt: new Date().toISOString(),
      boardedLocation: kind === "boarded" ? capture : undefined,
      offboardedLocation: kind === "offboarded" ? capture : undefined,
    });

    if (!result.ok) {
      throw new ApiError("server_error", result.error || "Could not save", 502);
    }

    return apiOk({ saved: true, date, trip, studentId, kind });
  } catch (e) {
    return apiErr(e);
  }
}
