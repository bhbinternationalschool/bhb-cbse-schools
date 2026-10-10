import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { childOfHousehold, requireParentHousehold } from "@/lib/api/v1/household";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { createTransportRequest, listHouseholdTransportRequests } from "@/lib/transportRequests.server";
import { loadMasters } from "@/lib/masters";
import { classLabelForStudent } from "@/lib/parentPortal";
import { householdWhatsApp, loadSis } from "@/lib/sis";

export const runtime = "nodejs";

type Body = {
  studentId?: string;
  pickupAddress?: string;
  locality?: string;
  landmark?: string;
  preferredStop?: string;
  note?: string;
};

/** POST /api/v1/transport/request — a parent asks for the school bus for one child. */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const body = (await request.json().catch(() => ({}))) as Body;
    const s = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
    const studentId = s(body.studentId, 80);
    const pickupAddress = s(body.pickupAddress, 300);
    if (!studentId) throw new ApiError("bad_request", "studentId required", 400);
    if (!pickupAddress) throw new ApiError("bad_request", "Tell us the pickup address", 400);

    await ensureSchoolMirrorHydrated();
    const sis = loadSis();
    const student = childOfHousehold(sis, studentId, householdId);
    const household = sis.households.find((h) => h.id === householdId);

    const existing = ((await listHouseholdTransportRequests(householdId)) ?? []).find(
      (r) => r.studentId === studentId && (r.status === "open" || r.status === "contacted"),
    );
    if (existing) {
      throw new ApiError("conflict", "A request for this child is already with the office", 409);
    }

    const created = await createTransportRequest({
      householdId,
      studentId,
      studentName: student.fullName,
      classLabel: classLabelForStudent(student, loadMasters()),
      contactName: ctx.session.fullName || household?.guardianName || "Parent",
      contactMobile: household ? householdWhatsApp(household) || household.mobile || "" : "",
      pickupAddress,
      locality: s(body.locality, 120),
      landmark: s(body.landmark, 120),
      preferredStop: s(body.preferredStop, 120),
      note: s(body.note, 500),
    });
    if (!created.ok) throw new ApiError("server_error", "Could not save the request — try again", 503);

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "transport",
      action: "create",
      entityType: "transport_request",
      entityId: created.request.id,
      summary: `Transport requested from the app for ${student.fullName} (${pickupAddress})`,
      after: { studentId, pickupAddress, locality: created.request.locality },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ id: created.request.id, status: created.request.status, createdAt: created.request.createdAt });
  } catch (e) {
    return apiErr(e);
  }
}
