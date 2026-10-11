import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import {
  loadTransportDesk,
  mayUseVehicle,
  readDayLogs,
  readFuelFills,
  registerAccess,
} from "@/lib/transportBoardingLog.server";
import { isMonth, istDate, monthDates, vehicleMonthReport } from "@/lib/transportBoardingLog";

export const runtime = "nodejs";

/**
 * GET /api/v1/transport/logbook/month?month=YYYY-MM
 *
 * Vehicle km and fuel for a month: km from the log book (only days with both
 * readings and end ≥ start count; the rest are listed as problem days), fuel
 * quantity and ₹ from the fuel entries (voided ones left out), and ₹/km —
 * null when no km counted. Crew see only their own vehicle.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const today = istDate();
    const month = (new URL(request.url).searchParams.get("month") || today.slice(0, 7)).trim();
    if (!isMonth(month)) throw new ApiError("bad_request", "month must be YYYY-MM", 400);
    const dates = monthDates(month);
    const from = dates[0]!;
    const to = dates[dates.length - 1]!;

    const transport = await loadTransportDesk();
    const access = registerAccess(ctx, transport, to < today ? to : today);
    const vehicles = transport.vehicles.filter((v) => mayUseVehicle(access, v.id));
    const ids = new Set(vehicles.map((v) => v.id));

    const [logsRes, fillsRes] = await Promise.all([readDayLogs({ from, to }), readFuelFills({ from, to })]);
    if (!logsRes.ok) throw new ApiError("server_error", `Could not read the log book: ${logsRes.error}`, 503);
    if (!fillsRes.ok) throw new ApiError("server_error", `Could not read fuel entries: ${fillsRes.error}`, 503);
    const logs = logsRes.logs.filter((l) => ids.has(l.vehicleId));
    const fills = fillsRes.fills.filter((f) => ids.has(f.vehicleId));

    return apiOk({
      month,
      fleetWide: access.fleetWide,
      rows: vehicleMonthReport({
        vehicles: vehicles.map((v) => ({ id: v.id, name: v.name, registrationNo: v.registrationNo })),
        logs: logs.map((l) => ({
          vehicleId: l.vehicleId,
          logDate: l.logDate,
          startKm: l.startKm,
          endKm: l.endKm,
          startSource: l.startSource,
          endSource: l.endSource,
        })),
        fills,
      }),
      logs,
      fills,
    });
  } catch (e) {
    return apiErr(e);
  }
}
