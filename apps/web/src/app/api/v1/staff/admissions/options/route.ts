import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { registrationFeeHeads } from "@/lib/admissions";
import { TENDER_MODES } from "@/lib/fees";
import { APP_TENDER_MODES } from "@/lib/staffAdmissionsApp";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/admissions/options — what the walk-in and registration
 * forms on the phone pick from: the school's active classes, the fee heads
 * the web's Registration desk offers (registrationFeeHeads), and the ways
 * of paying with whether each needs a reference.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "admission_leads");
    const classes = (ctx.masters.classes || [])
      .filter((c) => c.isActive)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({ id: c.id, name: c.name }));
    return apiOk({
      classes,
      registrationFeeHeads: registrationFeeHeads(ctx.masters).map((h) => ({
        id: h.id,
        name: h.name,
      })),
      tenderModes: APP_TENDER_MODES.map((m) => {
        const meta = TENDER_MODES.find((t) => t.value === m);
        return {
          id: m,
          label: meta?.label || m,
          needsRef: m !== "cash",
          refLabel: meta?.refLabel || "Reference",
        };
      }),
    });
  } catch (e) {
    return apiErr(e);
  }
}
