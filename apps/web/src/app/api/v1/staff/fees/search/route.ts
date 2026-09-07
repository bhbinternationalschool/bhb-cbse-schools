import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import {
  classLabelOf,
  householdContact,
  loadFeeContext,
  openDuesFor,
  searchStudents,
} from "@/lib/api/v1/staffFees";
import { formatInr } from "@/lib/fees";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/fees/search?q= — find a child to collect from, by name,
 * admission number, roll or the household's mobile. Each hit carries the
 * open balance so the cashier can confirm before opening the counter.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "fee_defaulters");
    const q = new URL(request.url).searchParams.get("q")?.trim() || "";
    if (q.length < 2) return apiOk({ q, students: [] });

    const { sis, fees, masters } = await loadFeeContext();
    const ay = ctx.session.academicYearCode;
    const students = searchStudents(sis, ay, q);

    return apiOk({
      q,
      students: students.map((s) => {
        const dues = openDuesFor(s, masters, fees);
        const openPaise = dues.reduce((n, d) => n + d.balancePaise, 0);
        const contact = householdContact(sis, s.householdId);
        return {
          id: s.id,
          fullName: s.fullName,
          admissionNo: s.admissionNo || "",
          rollNo: s.rollNo || "",
          classLabel: classLabelOf(ctx, s),
          householdId: s.householdId,
          guardianName: contact.guardianName,
          mobile: contact.mobile,
          openPaise,
          openLabel: formatInr(openPaise),
          dueCount: dues.length,
        };
      }),
    });
  } catch (e) {
    return apiErr(e);
  }
}
