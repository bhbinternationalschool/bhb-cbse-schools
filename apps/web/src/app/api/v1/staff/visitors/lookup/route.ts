import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import {
  lookupVisitorMobile,
  normalizeMobile10,
} from "@/lib/visitorSelfService.server";
import { toGateVisitor } from "@/lib/api/v1/staffVisitors.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/visitors/lookup?mobile= — who is this, before they are
 * let in? Answers "father of Aarav, IV-A" or "enquired about Class I last
 * week", so the guard writes a name the school can recognise later instead
 * of whatever was said at the gate.
 *
 * Also returns an open visit for the same number, so the app offers Check
 * out instead of a second check-in.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "visitor_gate");

    const raw = new URL(request.url).searchParams.get("mobile")?.trim() || "";
    const mobile = normalizeMobile10(raw);
    if (mobile.length !== 10) {
      throw new ApiError("bad_request", "Enter a valid 10-digit mobile number", 400);
    }

    const hit = await lookupVisitorMobile(mobile);
    if (!hit) {
      throw new ApiError("server_error", "Lookup is unavailable right now", 503);
    }

    return apiOk({
      mobile: hit.mobile,
      suggestedName: hit.suggestedName,
      parentOf: hit.parentOf,
      leads: hit.leads,
      openVisit: hit.openVisit ? toGateVisitor(hit.openVisit) : null,
      /** A one-line "who they are" the guard can accept as the link note. */
      linkedTo:
        hit.parentOf.length > 0
          ? `Parent of ${hit.parentOf
              .map((p) => `${p.studentName}${p.classLabel ? ` (${p.classLabel})` : ""}`)
              .join(", ")}`
          : hit.leads.length > 0
            ? `Admission enquiry for ${hit.leads.map((l) => l.childName).join(", ")}`
            : "",
    });
  } catch (e) {
    return apiErr(e);
  }
}
