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
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const { vouchers, ok } = await fetchHouseholdVouchersFromDb(householdId);
    if (!ok) return apiOk({ receipts: [], note: "Receipts are unavailable right now" }, { status: 503 });

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
        voided: !!v.voidedAt,
        archived: archived.has(v.id),
        pdfUrl: `/api/v1/receipts/${encodeURIComponent(v.id)}/pdf`,
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
