import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { releaseOnGatePass } from "@/lib/api/v1/staffVisitors.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";
import { classLabelOf } from "@/lib/api/v1/staffFees";

export const runtime = "nodejs";

type Body = { id?: string; pickedUpByName?: string };

/**
 * POST /api/v1/staff/visitors/gate-pass — hand the child over.
 *
 * The checks live in releaseOnGatePass: approved only, today only, once
 * only, and never without the name of whoever collected them. Those are the
 * four things somebody will ask about afterwards.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "gate_pass_release");

    const body = (await request.json().catch(() => ({}))) as Body;
    const id = (body.id || "").trim();
    if (!id) throw new ApiError("bad_request", "id required", 400);

    const pass = await releaseOnGatePass(id, body.pickedUpByName || "");

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const student = loadSis().students.find(
      (s) =>
        s.id === pass.studentId &&
        s.academicYearCode === ctx.session.academicYearCode,
    );
    const studentName = student?.fullName || pass.studentId;

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "visitors",
      action: "edit",
      entityType: "gate_pass",
      entityId: pass.id,
      summary: `${studentName}${student ? ` (${classLabelOf(ctx, student)})` : ""} released to ${pass.pickedUpByName} at the gate`,
      after: {
        status: pass.status,
        pickedUpByName: pass.pickedUpByName,
        actualPickupTime: pass.actualPickupTime,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({
      pass: {
        id: pass.id,
        studentId: pass.studentId,
        studentName,
        status: pass.status,
        pickedUpByName: pass.pickedUpByName,
        actualPickupTime: pass.actualPickupTime,
      },
    });
  } catch (e) {
    return apiErr(e);
  }
}
