import { NextResponse } from "next/server";
import { cachedDeskJson, deskJsonResponse } from "@/lib/deskProbeCache.server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import { requestMeta } from "@/lib/api/v1/auth";
import { auditArrayDiff } from "@/lib/auditDeskDiff.server";
import type { CollectionVoucher, FeesState } from "@/lib/fees";
import type { FeeDeskAncillary } from "@/lib/feesDeskAncillary.server";
import {
  fetchFeeDeskFromDb,
  feesDualWriteDbEnabled,
  pushFeeDeskToDb,
} from "@/lib/feesNormalized.server";

function voucherAuditSummary(
  v: CollectionVoucher,
  action: "create" | "update" | "delete",
): string {
  const amount = `₹${(v.totalPaise / 100).toLocaleString("en-IN")}`;
  const verb =
    action === "create" ? "Collected" : action === "delete" ? "Removed" : "Updated";
  const voided = v.voidedAt ? " · VOIDED" : "";
  return `${verb} receipt ${v.receiptNo || v.id} · ${amount}${voided}`;
}

export const runtime = "nodejs";

/** GET — pull full fee desk from normalized tables */
export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["fees-vouchers"], "GET");
  if (!auth.ok) return auth.response
  try {
    const result = await cachedDeskJson({
      cacheKey: "fees-vouchers",
      tables: ["fee_desk_vouchers", "fee_desk_voucher_lines", "fee_desk_voucher_tenders", "fee_desk_open_dues"],
      ifNoneMatch: req.headers.get("if-none-match"),
      build: async () => {
        const desk = await fetchFeeDeskFromDb();
        if (!desk.ok) throw new Error("Fee desk fetch failed — tenant/db unavailable");
        return {
          ok: true,
          vouchers: desk.vouchers,
          ancillary: desk.ancillary,
          count: desk.vouchers.length,
          updatedAt: desk.meta?.updatedAt || new Date().toISOString(),
          meta: desk.meta,
        };
      },
    });
    return deskJsonResponse(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Fee desk fetch failed" },
      { status: 503 },
    );
  }
}

type DeskPostBody = Pick<FeesState, "vouchers"> &
  Partial<FeeDeskAncillary> & {
    rebuildOpenDues?: boolean;
    academicYearCode?: string;
  };

/** POST — push fee desk snapshot (vouchers + ancillary) + rebuild open dues */
export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["fees-vouchers"], "POST");
  if (!auth.ok) return auth.response
  if (!feesDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "FEES_DUAL_WRITE_DB disabled",
    });
  }

  let body: DeskPostBody;
  try {
    body = (await req.json()) as DeskPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const state: Pick<FeesState, "vouchers"> & FeeDeskAncillary = {
    vouchers: Array.isArray(body.vouchers) ? body.vouchers : [],
    cheques: body.cheques ?? [],
    manualBooks: body.manualBooks ?? [],
    dayCloses: body.dayCloses ?? [],
    installmentPlans: body.installmentPlans ?? [],
    planAllocations: body.planAllocations ?? [],
    carriedForwardDues: body.carriedForwardDues ?? [],
    chargeVouchers: body.chargeVouchers ?? [],
  };

  // Desk sync pushes the full voucher snapshot every time, not individual
  // edits — fees was one of the least-governed modules (zero audit_events
  // rows) precisely because there was never a per-record write to hang an
  // audit entry on. Diff against what's already stored so a resync of
  // unchanged data stays silent and only real create/edit/void/delete get
  // written.
  const priorDesk = await fetchFeeDeskFromDb();
  const priorVouchers = priorDesk.ok ? priorDesk.vouchers : [];

  const result = await pushFeeDeskToDb(state, {
    academicYearCode: body.academicYearCode,
    rebuildOpenDues: body.rebuildOpenDues,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  const { ip, userAgent } = requestMeta(req);
  await auditArrayDiff({
    session: auth.ctx.session,
    module: "fees",
    entityType: "collection_voucher",
    before: priorVouchers,
    after: state.vouchers,
    ip,
    userAgent,
    summarize: voucherAuditSummary,
  });

  return NextResponse.json({
    ok: true,
    count: result.voucherCount,
    openDuesCount: result.openDuesCount,
    updatedAt: new Date().toISOString(),
  });
}
