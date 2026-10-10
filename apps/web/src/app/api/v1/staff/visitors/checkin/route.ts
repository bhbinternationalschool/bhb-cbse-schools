import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import {
  gateCheckIn,
  isVisitorPurpose,
  toGateVisitor,
} from "@/lib/api/v1/staffVisitors.server";

export const runtime = "nodejs";

type Body = {
  visitorName?: string;
  mobile?: string;
  purpose?: string;
  personToMeet?: string;
  idProofNote?: string;
  linkedTo?: string;
};

/**
 * POST /api/v1/staff/visitors/checkin — let somebody in.
 *
 * If that mobile is already on campus the open visit comes back with
 * `alreadyIn: true` rather than a second row: a guard tapping twice on a bad
 * connection must not put the same person in the log twice.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "visitor_gate");

    const body = (await request.json().catch(() => ({}))) as Body;
    const purpose = (body.purpose || "").trim();
    if (!isVisitorPurpose(purpose)) {
      throw new ApiError("bad_request", "Pick why they are here", 400);
    }

    const { entry, alreadyIn } = await gateCheckIn(ctx, {
      visitorName: body.visitorName || "",
      mobile: body.mobile || "",
      purpose,
      personToMeet: body.personToMeet,
      idProofNote: body.idProofNote,
      linkedTo: body.linkedTo,
    });

    if (!alreadyIn) {
      const meta = requestMeta(request);
      await writeAudit({
        session: ctx.session,
        module: "visitors",
        action: "create",
        entityType: "visitor_entry",
        entityId: entry.id,
        summary: `Checked in ${entry.visitorNo || entry.id} · ${entry.visitorName} (${entry.purpose}) at the gate`,
        after: {
          visitorNo: entry.visitorNo,
          mobile: entry.mobile,
          purpose: entry.purpose,
          personToMeet: entry.personToMeet,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    return apiOk({ visitor: toGateVisitor(entry), alreadyIn });
  } catch (e) {
    return apiErr(e);
  }
}
