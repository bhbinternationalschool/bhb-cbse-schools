import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { sanitizeStoredMediaUrl } from "@/lib/media";
import {
  addFuelFill,
  assertEditableDate,
  assertVehicle,
  dayParam,
  loadTransportDesk,
  readFuelFill,
  registerAccess,
  voidFuelFill,
} from "@/lib/transportBoardingLog.server";
import { fuelUnitFor, istDate, parseKm, rupeesToPaise } from "@/lib/transportBoardingLog";

export const runtime = "nodejs";

/**
 * POST /api/v1/transport/logbook/fuel
 *
 *   { action: "add", id, vehicleId, date, quantity, amountRupees,
 *     odometerKm?, receiptUrl?, note? }
 *   { action: "void", id, reason }
 *
 * `id` is made by the phone, so a retried save cannot record one fill twice.
 * The receipt photo is uploaded first to the private school-files bucket
 * (uploadMedia) and arrives here as its /api/file/… URL — never as a data:
 * URL, which the media guard refuses.
 *
 * A wrong entry is voided with a reason, never deleted. The person who made
 * it may void it on the days they may still edit; the office any time.
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
    const id = String(body.id ?? "").trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new ApiError("bad_request", "A valid entry id is required", 400);
    const transport = await loadTransportDesk();

    if (body.action === "void") {
      const fill = await readFuelFill(id);
      if (!fill) throw new ApiError("not_found", "Fuel entry not found", 404);
      const access = registerAccess(ctx, transport, fill.fillDate);
      assertVehicle(access, fill.vehicleId);
      if (!access.fleetWide) {
        if (!access.staffId || fill.createdByStaffId !== access.staffId) {
          throw new ApiError("forbidden", "Only the office can void someone else's entry.", 403);
        }
        assertEditableDate(access, fill.fillDate, today);
      }
      const reason = String(body.reason ?? "").trim();
      if (!reason) throw new ApiError("bad_request", "Say why this entry is wrong", 400);
      return apiOk({ fill: await voidFuelFill(id, reason, access.name) });
    }

    if (body.action !== "add") throw new ApiError("bad_request", "action must be add or void", 400);
    const date = dayParam(body.date, today);
    const vehicleId = String(body.vehicleId ?? "").trim();
    const vehicle = transport.vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) throw new ApiError("not_found", "Vehicle not found", 404);
    const access = registerAccess(ctx, transport, date);
    assertVehicle(access, vehicleId);
    assertEditableDate(access, date, today);

    const quantity = Number(String(body.quantity ?? "").trim());
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 2000) {
      throw new ApiError("bad_request", "Enter the quantity filled", 400);
    }
    const amountPaise = rupeesToPaise(body.amountRupees);
    if (amountPaise == null) throw new ApiError("bad_request", "Enter the amount paid in ₹", 400);
    const odo = parseKm(body.odometerKm);
    if (odo === "invalid") throw new ApiError("bad_request", "Odometer must be a number of km (or blank)", 400);

    const receiptUrl = sanitizeStoredMediaUrl(String(body.receiptUrl ?? ""), "fuel-receipt");
    if (receiptUrl && !receiptUrl.startsWith("/api/file/")) {
      throw new ApiError("bad_request", "Upload the receipt photo first", 400);
    }

    const fill = await addFuelFill({
      id,
      vehicleId,
      fillDate: date,
      quantity: Math.round(quantity * 100) / 100,
      unit: fuelUnitFor(vehicle.fuelUnit),
      amountPaise,
      odometerKm: odo,
      receiptPath: receiptUrl,
      note: String(body.note ?? ""),
      createdByStaffId: access.staffId,
      createdByName: access.name,
    });
    return apiOk({ fill });
  } catch (e) {
    return apiErr(e);
  }
}
