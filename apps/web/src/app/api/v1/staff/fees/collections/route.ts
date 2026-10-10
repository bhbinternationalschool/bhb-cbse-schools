import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { loadFeeContext, istToday } from "@/lib/api/v1/staffFees";
import { formatInr } from "@/lib/fees";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/fees/collections?date=YYYY-MM-DD — what this cashier
 * has taken on a day, receipt by receipt, with a mode-wise total. This is
 * what they hand over at the end of the day, so it counts only their own
 * receipts and excludes anything voided.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "fee_collections");
    const url = new URL(request.url);
    const date = url.searchParams.get("date")?.trim() || istToday();
    const mine = url.searchParams.get("scope") !== "all";

    const { fees, sis } = await loadFeeContext();
    const me = (ctx.session.fullName || "").trim().toLowerCase();
    const guardianOf = (householdId: string) =>
      sis.households.find((h) => h.id === householdId)?.guardianName || "Guardian";

    const rows = fees.vouchers
      .filter((v) => !v.voidedAt && v.collectionDate === date)
      .filter((v) => (mine ? (v.cashierName || "").trim().toLowerCase() === me : true))
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
