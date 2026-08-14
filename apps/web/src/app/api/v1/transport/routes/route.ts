import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { fetchTransportDeskFromDb } from "@/lib/transportNormalized.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/transport/routes — active routes with ordered stops and the
 * linked vehicle. Reads the transport desk bundle straight from the DB:
 * unlike attendance/homework, transport's loadTransport() has no server
 * cache (it returns empty off-browser), so hydrate-then-load silently
 * yields nothing.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    // Route/stop/vehicle info carries no per-student assignment (that data
    // doesn't exist yet either — transport_assignments is empty), so it's
    // safe for parents to see the same list drivers do: which buses exist,
    // what they cost, and where they stop.
    if (
      ctx.session.persona !== "staff" &&
      ctx.session.persona !== "field" &&
      ctx.session.persona !== "parent"
    ) {
      throw new ApiError("forbidden", "Sign in required", 403);
    }

    const { bundle, ok } = await fetchTransportDeskFromDb();
    if (!ok) {
      throw new ApiError("server_error", "Transport data unavailable", 503);
    }

    const vehicleById = new Map(bundle.vehicles.map((v) => [v.id, v]));

    const routes = bundle.routes
      .filter((r) => r.isActive !== false)
      .map((r) => {
        const vehicle = r.vehicleId ? vehicleById.get(r.vehicleId) : undefined;
        return {
          id: r.id,
          code: r.code,
          name: r.name,
          monthlyFeePaise: r.monthlyFeePaise,
          stops: [...r.stops]
            .sort((a, b) => a.sequence - b.sequence)
            .map((s) => ({
              id: s.id,
              name: s.name,
              sequence: s.sequence,
              distanceKm: s.distanceKm,
            })),
          vehicle: vehicle
            ? {
                id: vehicle.id,
                name: vehicle.name,
                registrationNo: vehicle.registrationNo,
                type: vehicle.type,
                seatCapacity: vehicle.seatCapacity,
                driverName: vehicle.driverName || null,
              }
            : r.vehicleReg
              ? {
                  id: null,
                  name: r.busNo,
                  registrationNo: r.vehicleReg,
                  type: null,
                  seatCapacity: null,
                  driverName: null,
                }
              : null,
        };
      });

    return apiOk({ routes });
  } catch (e) {
    return apiErr(e);
  }
}
