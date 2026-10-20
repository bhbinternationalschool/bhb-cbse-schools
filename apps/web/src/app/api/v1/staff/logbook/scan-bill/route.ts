import { ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { handleStaffScan, staffScanLimiter } from "@/lib/api/v1/staffScan.server";
import { readStaffScanImage } from "@/lib/aiLlm.server";
import {
  assertEditableDate,
  assertVehicle,
  dayParam,
  loadTransportDesk,
  registerAccess,
} from "@/lib/transportBoardingLog.server";
import { istDate } from "@/lib/transportBoardingLog";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/v1/staff/logbook/scan-bill — read a fuel bill photo.
 *
 *   { kind: "fuel_bill", vehicleId, date, imageBase64, mimeType }
 *
 * Returns a draft for the log book's fuel form: amount, date, quantity, rate,
 * odometer, pump and bill number, each empty when it could not be read. Saves
 * nothing; the photo itself is still uploaded and stored by the fuel form the
 * way it always was (/api/upload → school-files).
 *
 * Gated exactly like adding the fill (POST /api/v1/transport/logbook/fuel):
 * the Route & log book app screen, then registerAccess — transport·view, a
 * driver only for their own vehicle, and only on a date they may still edit.
 */
export async function POST(request: Request) {
  return handleStaffScan(request, ["fuel_bill"], {
    auth: resolveApiAuth,
    authorize: async (ctx, input) => {
      assertMobileFeature(ctx, "route_manifest");
      const today = istDate();
      const date = dayParam(input.date, today);
      const transport = await loadTransportDesk();
      if (!transport.vehicles.some((v) => v.id === input.vehicleId)) {
        throw new ApiError("not_found", "Vehicle not found", 404);
      }
      const access = registerAccess(ctx, transport, date);
      assertVehicle(access, input.vehicleId);
      assertEditableDate(access, date, today);
    },
    read: readStaffScanImage,
    limiter: staffScanLimiter,
    today: () => istDate(),
  });
}
