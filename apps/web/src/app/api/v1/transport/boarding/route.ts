import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import {
  appendBoardingEventToDb,
  fetchTransportDeskFromDb,
} from "@/lib/transportNormalized.server";
import { fetchSisFromDb } from "@/lib/sisNormalized.server";
import { notifyNotBoarded } from "@/lib/transportParentNotify.server";
import type { SisState } from "@/lib/sis";
import type { TransportState } from "@/lib/transport";
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
 *
 * Gated on `transport.view`, not `transport.create`. That looks lax for a
 * write and is deliberate: the built-in Driver role is view-only on the
 * transport desk ("Field / transport self-service"), so demanding `create`
 * would 403 the exact people the feature exists for. Marking a child aboard
 * is field self-service, not desk editing — anyone trusted to see the roster
 * is trusted to mark it, and everyone else (teacher, parent) holds no
 * transport grant at all. Tightening this to `create` means granting the
 * Driver role `create` in Settings -> Roles first; the built-in default never
 * reaches an already-persisted role, whose grants are merged by module and
 * never by action.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertPermission(ctx, "transport", "view");

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

    // The mark is saved. Telling the parent is a courtesy on top of it, so a
    // messaging failure is reported alongside the save and never replaces it —
    // an attendant must not see "failed" and re-mark a child who is already
    // recorded absent.
    let notified: Awaited<ReturnType<typeof notifyNotBoarded>> | null = null;
    if (kind === "absent") {
      try {
        const [{ bundle: tBundle }, sisRes] = await Promise.all([
          fetchTransportDeskFromDb(),
          fetchSisFromDb(),
        ]);
        notified = sisRes.ok
          ? await notifyNotBoarded({
              studentId,
              routeId,
              stopId:
                tBundle.assignments.find(
                  (a) => a.studentId === studentId && a.effectiveTo == null,
                )?.stopId ?? "",
              at: new Date().toISOString(),
              transport: tBundle as unknown as TransportState,
              sis: sisRes.bundle as unknown as SisState,
            })
          : { sent: false, skipped: "student roster unavailable" };
      } catch (e) {
        notified = {
          sent: false,
          error: e instanceof Error ? e.message : "notify failed",
        };
      }
      if (notified && !notified.sent) {
        console.warn("[transport/boarding] parent not notified", notified);
      }
    }

    return apiOk({ saved: true, date, trip, studentId, kind, notified });
  } catch (e) {
    return apiErr(e);
  }
}
