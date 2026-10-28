import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import {
  classLabelOf,
  feeDiscountsKnown,
  householdContact,
  loadFeeContext,
  openDueLinesFor,
  openDuesFor,
} from "@/lib/api/v1/staffFees";
import { allocationRanks, dueRefKey } from "@/lib/staffFeeCollect";
import { TENDER_MODES, formatInr } from "@/lib/fees";
import { academicYearStartOn } from "@/lib/masters";
import { canBackdateReceipt } from "@/lib/rbac";
import {
  DEFAULT_FEE_BACKDATE_POLICY,
  earliestCollectionDate,
} from "@/lib/feeBackdate";

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
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });
    const siblings = sis.students.filter(
      (s) =>
        s.householdId === student.householdId &&
        s.status === "active" &&
        s.academicYearCode === ay,
    );
    const contact = householdContact(sis, student.householdId);

    // A discount is only shown as a figure when every source behind it was
    // read; otherwise the phone says "not loaded" rather than ₹0.
    const discountsKnown = await feeDiscountsKnown(fees);
    // The order a "total paying now" fills dues in — the web counter's own
    // comparator over the whole household, so the phone need not re-implement
    // it. The collect route re-derives the split and refuses a mismatch.
    const ranks = allocationRanks(
      siblings.flatMap((s) => openDueLinesFor(s, masters, fees, today)),
    );

    const children = siblings.map((s) => {
      const dues = openDuesFor(s, masters, fees, today, discountsKnown).map((d) => ({
        ...d,
        allocationRank: ranks.get(dueRefKey(s.id, d.dueKey)) ?? null,
      }));
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
      collectionDate: today,
      /**
       * The oldest date this person may put on a receipt.
       *
       * Equal to `collectionDate` means same-day only, and the app pins the
       * field instead of offering a picker. The school's setting and this
       * person's authority are resolved here so the app cannot offer a date
       * the server would then refuse.
       */
      earliestCollectionDate: earliestCollectionDate({
        today,
        sessionStartOn: academicYearStartOn(ay) ?? "",
        policy: masters?.feeBackdatePolicy ?? DEFAULT_FEE_BACKDATE_POLICY,
        mayOverride: canBackdateReceipt(ctx.session, masters),
      }),
      children,
      discountsKnown,
      totalPaise,
      totalLabel: formatInr(totalPaise),
      tenderModes: TENDER_MODES.map((m) => ({
        value: m.value,
        label: m.label,
        refLabel: m.refLabel,
        needsRef: m.needsRef,
        needsInstrumentDate: m.needsInstrumentDate,
        needsBank: m.needsBank,
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
