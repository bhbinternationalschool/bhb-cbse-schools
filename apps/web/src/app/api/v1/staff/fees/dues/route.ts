import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import {
  classLabelOf,
  householdContact,
  loadFeeContext,
  openDuesFor,
} from "@/lib/api/v1/staffFees";
import { TENDER_MODES, formatInr } from "@/lib/fees";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/fees/dues?studentId= — the counter screen: every child
 * in that household with their open dues, plus the tender modes this build
 * accepts. Siblings come along because a family pays once at the window.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "fee_take");
    const studentId = new URL(request.url).searchParams.get("studentId")?.trim() || "";
    if (!studentId) throw new ApiError("bad_request", "studentId required", 400);

    const { sis, fees, masters } = await loadFeeContext();
    const student = sis.students.find((s) => s.id === studentId);
    if (!student) throw new ApiError("not_found", "Student not found", 404);

    const ay = ctx.session.academicYearCode;
    const siblings = sis.students.filter(
      (s) =>
        s.householdId === student.householdId &&
        s.status === "active" &&
        s.academicYearCode === ay,
    );
    const contact = householdContact(sis, student.householdId);

    const children = siblings.map((s) => {
      const dues = openDuesFor(s, masters, fees);
      const openPaise = dues.reduce((n, d) => n + d.balancePaise, 0);
      return {
        studentId: s.id,
        fullName: s.fullName,
        admissionNo: s.admissionNo || "",
        classLabel: classLabelOf(ctx, s),
        isPrimary: s.id === studentId,
        openPaise,
        openLabel: formatInr(openPaise),
        dues,
      };
    });
    const totalPaise = children.reduce((n, c) => n + c.openPaise, 0);

    return apiOk({
      householdId: student.householdId,
      guardianName: contact.guardianName,
      mobile: contact.mobile,
      academicYearCode: ay,
      collectionDate: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
      children,
      totalPaise,
      totalLabel: formatInr(totalPaise),
      tenderModes: TENDER_MODES.map((m) => ({
        value: m.value,
        label: m.label,
        refLabel: m.refLabel,
        needsRef: m.needsRef,
        needsInstrumentDate: m.needsInstrumentDate,
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
