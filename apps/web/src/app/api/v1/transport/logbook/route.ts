import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import {
  assertEditableDate,
  assertVehicle,
  dayParam,
  editableDaysBack,
  loadTransportDesk,
  mayUseVehicle,
  readDayLogs,
  readFuelFills,
  readGpsOdometers,
  registerAccess,
  saveDayLog,
} from "@/lib/transportBoardingLog.server";
import {
  dayKm,
  fuelUnitFor,
  istDate,
  parseKm,
  type OdoSource,
} from "@/lib/transportBoardingLog";

export const runtime = "nodejs";

/**
 * GET /api/v1/transport/logbook?date=
 *
 * The driver's log book for one day: every vehicle in the caller's reach with
 * its saved start/end odometer, fuel filled, remarks — and the Fleet Edge
 * odometer for that day where the vehicle has a tracker, so the form can
 * offer it (labelled GPS) before anybody types.
 *
 * `gps.state` is one of ok / no_data / untracked / unavailable. "unavailable"
 * means the feed could not be read and is never shown as "no tracker".
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const today = istDate();
    const date = dayParam(new URL(request.url).searchParams.get("date"), today);

    const transport = await loadTransportDesk();
    const access = registerAccess(ctx, transport, date);
    const vehicles = transport.vehicles.filter((v) => v.isActive !== false && mayUseVehicle(access, v.id));

    const [logsRes, fillsRes, gps] = await Promise.all([
      readDayLogs({ from: date, to: date }),
      readFuelFills({ from: date, to: date }),
      readGpsOdometers(vehicles, date),
    ]);
    if (!logsRes.ok) throw new ApiError("server_error", `Could not read the log book: ${logsRes.error}`, 503);
    if (!fillsRes.ok) throw new ApiError("server_error", `Could not read fuel entries: ${fillsRes.error}`, 503);

    const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
    return apiOk({
      date,
      today,
      fleetWide: access.fleetWide,
      unlinked: !access.fleetWide && vehicles.length === 0,
      editable: days >= 0 && days <= editableDaysBack(access),
      staffId: access.staffId,
      vehicles: vehicles.map((v) => {
        const log = logsRes.logs.find((l) => l.vehicleId === v.id) ?? null;
        return {
          id: v.id,
          name: v.name,
          registrationNo: v.registrationNo,
          driverName: v.driverName || "",
          fuelUnit: fuelUnitFor(v.fuelUnit),
          routes: transport.routes
            .filter((r) => r.vehicleId === v.id && r.isActive !== false)
            .map((r) => r.name),
          log,
          km: log ? dayKm(log) : null,
          gps: gps.get(v.id) ?? { state: "unavailable" },
          fills: fillsRes.fills.filter((f) => f.vehicleId === v.id),
        };
      }),
    });
  } catch (e) {
    return apiErr(e);
  }
}

/**
 * POST /api/v1/transport/logbook
 * { vehicleId, date, startKm, startSource, endKm, endSource, driverName?,
 *   remarks?, expectedVersion: number | null }
 *
 * Saves one vehicle-day. Blank km = not recorded (null), never 0. Each figure
 * carries where it came from — "gps" only when it is still the untouched
 * Fleet Edge reading. `expectedVersion` is what the form loaded; a mismatch
 * means another phone saved first and answers 409.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new ApiError("bad_request", "Invalid JSON", 400);
    }
    const today = istDate();
    const date = dayParam(body.date, today);
    const vehicleId = String(body.vehicleId ?? "").trim();
    if (!vehicleId) throw new ApiError("bad_request", "vehicleId is required", 400);

    const transport = await loadTransportDesk();
    const access = registerAccess(ctx, transport, date);
    assertVehicle(access, vehicleId);
    assertEditableDate(access, date, today);
    if (!transport.vehicles.some((v) => v.id === vehicleId)) {
      throw new ApiError("not_found", "Vehicle not found", 404);
    }

    const startKm = parseKm(body.startKm);
    const endKm = parseKm(body.endKm);
    if (startKm === "invalid" || endKm === "invalid") {
      throw new ApiError("bad_request", "Odometer must be a number of km (or blank)", 400);
    }
    if (startKm != null && endKm != null && endKm < startKm) {
      throw new ApiError("bad_request", `End odometer (${endKm}) is below start (${startKm}). Check the reading.`, 400);
    }
    const src = (v: unknown): OdoSource => (v === "gps" ? "gps" : "typed");
    const expected = body.expectedVersion;
    const expectedVersion =
      expected == null ? null : Number.isInteger(expected) && (expected as number) > 0 ? (expected as number) : NaN;
    if (Number.isNaN(expectedVersion)) throw new ApiError("bad_request", "expectedVersion must be a whole number or null", 400);

    const log = await saveDayLog({
      vehicleId,
      logDate: date,
      startKm,
      startSource: src(body.startSource),
      endKm,
      endSource: src(body.endSource),
      driverName: String(body.driverName ?? ""),
      remarks: String(body.remarks ?? ""),
      expectedVersion,
      staffId: access.staffId,
      name: access.name,
    });
    return apiOk({ log, km: dayKm(log) });
  } catch (e) {
    return apiErr(e);
  }
}
