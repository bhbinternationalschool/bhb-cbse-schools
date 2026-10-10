import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { fetchHouseholdVouchersFromDb } from "@/lib/feesNormalized.server";
import { formatInr, tenderModeLabel } from "@/lib/fees";
import { getServerTenantContext } from "@/lib/serverTenant";

export const runtime = "nodejs";

/**
 * GET /api/v1/receipts — the household's fee receipts, newest first, each
 * with a link to its PDF. `archived` says whether the PDF already sits in
 * the school's Drive; the pdf route renders on demand either way.
 *
 * VOIDED receipts are not sent to a parent. This used to return them with
 * `voided: true`, and the app drew them struck through under "VOID —
 * cancelled by the office": a cancelled receipt in a parent's app is a
 * document they can screenshot, forward and argue from, and the office
 * cancels one for reasons — a wrong head, a bounced cheque, a duplicate
 * entry — that are the school's business to correct, not the parent's to
 * discover in a list. The office still sees every void on the student
 * profile and at the counter, which is where a cancellation is explained.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const all = await fetchHouseholdVouchersFromDb(householdId);
    if (!all.ok) return apiOk({ receipts: [], note: "Receipts are unavailable right now" }, { status: 503 });
    const vouchers = all.vouchers.filter((v) => !v.voidedAt);

    const tctx = await getServerTenantContext();
    const archived = new Set<string>();
    if (tctx && vouchers.length) {
      const { data } = await tctx.sb
        .from("drive_archive")
        .select("ref")
        .eq("tenant_id", tctx.tenantId)
        .eq("kind", "receipt")
        .neq("drive_file_id", "")
        .in("ref", vouchers.map((v) => v.id));
      for (const r of (data ?? []) as { ref: string }[]) archived.add(r.ref);
    }

    return apiOk({
      receipts: vouchers.map((v) => ({
        id: v.id,
        receiptNo: v.receiptNo,
        date: v.collectionDate,
        totalPaise: v.totalPaise,
        totalLabel: formatInr(v.totalPaise),
        students: [...new Set(v.lines.map((l) => l.studentName).filter(Boolean))],
        particulars: v.lines.map((l) => l.label).slice(0, 6),
        paidBy: [...new Set(v.tenders.map((t) => tenderModeLabel(t.mode)))].join(", "),
        // Always false now — kept so an installed app that reads the field
        // does not have to be updated in the same breath.
        voided: false,
        archived: archived.has(v.id),
        pdfUrl: `/api/v1/receipts/${encodeURIComponent(v.id)}/pdf`,
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
