import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import type { PaymentLink } from "@/lib/payments";
import { paymentsDualWriteDbEnabled } from "@/lib/paymentsDbConfig";
import {
  fetchPaymentDeskFromDb,
  pushPaymentDeskToDb,
} from "@/lib/paymentsNormalized.server";

export const runtime = "nodejs";

/** GET — pull payment links from normalized desk tables */
export async function GET(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["payment-links"], "GET");
  if (!auth.ok) return auth.response
  const { links, meta, ok } = await fetchPaymentDeskFromDb();
  if (!ok) {
    return NextResponse.json(
      { ok: false, error: "Payment desk fetch failed — tenant/db unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    links,
    count: links.length,
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    meta,
  });
}

type PaymentLinksPostBody = { links?: PaymentLink[] };

/** POST — push full payment links snapshot */
export async function POST(req: Request) {
  const auth = await authorizeSchoolDataDesk(req, SCHOOL_DATA_DESK_RBAC["payment-links"], "POST");
  if (!auth.ok) return auth.response
  if (!paymentsDualWriteDbEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "PAYMENTS_DUAL_WRITE_DB disabled",
    });
  }

  let body: PaymentLinksPostBody;
  try {
    body = (await req.json()) as PaymentLinksPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const links = Array.isArray(body.links) ? body.links : [];
  const result = await pushPaymentDeskToDb({ links });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error || "Sync failed" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    count: result.linkCount,
    updatedAt: new Date().toISOString(),
  });
}
