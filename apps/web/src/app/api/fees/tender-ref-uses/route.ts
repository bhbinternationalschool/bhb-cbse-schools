import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import type { RefUse } from "@/lib/feeTenderRefCheck";

export const runtime = "nodejs";

/**
 * GET ?refs=a,b — live fee receipts that already carry any of these payment
 * references, on a tender or as the receipt's transaction id.
 *
 * The counter asks before saving a receipt. Its own browser holds only the
 * fee book it last loaded, so a receipt entered on another computer would
 * be missed; the database is the one place every receipt is.
 *
 * `ok: false` means the check could not be made. The counter says so rather
 * than treating it as "no other receipt uses this reference".
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "view");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const refs = [
    ...new Set(
      (url.searchParams.get("refs") || "")
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r.length >= 3 && r.length <= 80),
    ),
  ].slice(0, 20);
  if (refs.length === 0) return NextResponse.json({ ok: true, uses: [] });

  const ctx = await getServerTenantContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "database unavailable" }, { status: 503 });
  const { sb, tenantId } = ctx;

  const [byTender, byTxn] = await Promise.all([
    sb
      .from("fee_desk_voucher_tenders")
      .select("voucher_id, ref")
      .eq("tenant_id", tenantId)
      .in("ref", refs)
      .limit(200),
    sb
      .from("fee_desk_vouchers")
      .select("id, transaction_id")
      .eq("tenant_id", tenantId)
      .is("voided_at", null)
      .in("transaction_id", refs)
      .limit(200),
  ]);
  if (byTender.error || byTxn.error) {
    return NextResponse.json(
      { ok: false, error: byTender.error?.message || byTxn.error?.message },
      { status: 502 },
    );
  }

  const refOf = new Map<string, string>();
  for (const t of byTender.data ?? []) refOf.set(t.voucher_id as string, t.ref as string);
  for (const v of byTxn.data ?? []) {
    if (!refOf.has(v.id as string)) refOf.set(v.id as string, v.transaction_id as string);
  }
  if (refOf.size === 0) return NextResponse.json({ ok: true, uses: [] });

  const { data, error } = await sb
    .from("fee_desk_vouchers")
    .select("id, receipt_no, household_id, collection_date, total_paise")
    .eq("tenant_id", tenantId)
    .is("voided_at", null)
    .in("id", [...refOf.keys()]);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }

  const uses: RefUse[] = (data ?? []).map((v) => ({
    ref: refOf.get(v.id as string) ?? "",
    voucherId: v.id as string,
    receiptNo: (v.receipt_no as string) || "",
    householdId: (v.household_id as string) || "",
    collectionDate: String(v.collection_date ?? ""),
    totalPaise: Number(v.total_paise) || 0,
  }));
  return NextResponse.json({ ok: true, uses });
}
