import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { loadFeeContext, istToday } from "@/lib/api/v1/staffFees";
import { formatInr } from "@/lib/fees";
import { assertSchoolWide } from "@/lib/api/v1/staffScope";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/fees/collections?date=YYYY-MM-DD — what this cashier
 * has taken on a day, receipt by receipt, with a mode-wise total. This is
 * what they hand over at the end of the day, so it counts only their own
 * receipts and excludes anything voided.
 *
 * `scope=all` is the whole school's day — what the principal's "Collected
 * today" card opens (request mr_mv9y9nazs38w). School-wide sessions only;
 * with `academicYearCode` it counts that session's receipts, the same
 * filter as the card's figure (lib/principalSnapshot.server), so the list
 * adds up to the number that was tapped.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "fee_collections");
    const url = new URL(request.url);
    const date = url.searchParams.get("date")?.trim() || istToday();
    const mine = url.searchParams.get("scope") !== "all";
    // Every cashier's receipts, with the families' names: leadership and the
    // office only, as the principal's snapshot itself.
    if (!mine) await assertSchoolWide(ctx);
    const ay = mine ? "" : url.searchParams.get("academicYearCode")?.trim() || "";

    const { fees, sis } = await loadFeeContext();
    const me = (ctx.session.fullName || "").trim().toLowerCase();
    const guardianOf = (householdId: string) =>
      sis.households.find((h) => h.id === householdId)?.guardianName || "Guardian";

    const rows = fees.vouchers
      .filter((v) => !v.voidedAt && v.collectionDate === date)
      .filter((v) => (mine ? (v.cashierName || "").trim().toLowerCase() === me : true))
      .filter((v) => !ay || v.academicYearCode === ay)
      .sort((a, b) => (b.collectedAt || "").localeCompare(a.collectedAt || ""));

    const byMode = new Map<string, number>();
    for (const v of rows) {
      for (const t of v.tenders) {
        byMode.set(t.mode, (byMode.get(t.mode) ?? 0) + t.amountPaise);
      }
    }
    const totalPaise = rows.reduce((n, v) => n + v.totalPaise, 0);

    return apiOk({
      date,
      scope: mine ? "mine" : "all",
      cashierName: ctx.session.fullName,
      count: rows.length,
      totalPaise,
      totalLabel: formatInr(totalPaise),
      byMode: [...byMode.entries()].map(([mode, paise]) => ({
        mode,
        paise,
        label: formatInr(paise),
      })),
      receipts: rows.slice(0, 200).map((v) => ({
        voucherId: v.id,
        receiptNo: v.receiptNo,
        householdId: v.householdId,
        guardianName: guardianOf(v.householdId),
        studentNames: [...new Set(v.lines.map((l) => l.studentName))].join(", "),
        totalPaise: v.totalPaise,
        totalLabel: formatInr(v.totalPaise),
        modes: [...new Set(v.tenders.map((t) => t.mode))],
        collectedAt: v.collectedAt,
        cashierName: v.cashierName,
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
