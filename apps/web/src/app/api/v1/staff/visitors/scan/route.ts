import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { handleStaffScan, staffScanLimiter } from "@/lib/api/v1/staffScan.server";
import { readStaffScanImage } from "@/lib/aiLlm.server";
import { istDate } from "@/lib/transportBoardingLog";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/v1/staff/visitors/scan — read a photo at the gate.
 *
 *   { kind: "visitor_id" | "vehicle_plate", imageBase64, mimeType }
 *
 * Returns a draft for the check-in form: name, ID type, the ID number (an
 * Aadhaar only ever as "XXXX XXXX 1234") and address from an ID card; the
 * plate as "UP 32 AB 1234" from a number plate. Saves nothing — and the
 * photo is not kept: the visitor log has never stored photos.
 *
 * Same gate as checking a visitor in: the Visitor gate app screen and
 * visitors·create.
 */
export async function POST(request: Request) {
  return handleStaffScan(request, ["visitor_id", "vehicle_plate"], {
    auth: resolveApiAuth,
    authorize: (ctx) => {
      assertMobileFeature(ctx, "visitor_gate");
      assertPermission(ctx, "visitors", "create");
    },
    read: readStaffScanImage,
    limiter: staffScanLimiter,
    today: () => istDate(),
  });
}
