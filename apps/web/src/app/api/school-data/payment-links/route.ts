import { NextResponse } from "next/server";
import {
  authorizeSchoolDataDesk,
  SCHOOL_DATA_DESK_RBAC,
} from "@/lib/apiRouteAuth.server";
import { deskReadGate, visibleSlices } from "@/lib/deskFeatureGate.server";
import type { PaymentLink } from "@/lib/payments";
import { paymentsDualWriteDbEnabled } from "@/lib/paymentsDbConfig";
import {
  fetchPaymentDeskFromDb,
  pushPaymentDeskToDb,
} from "@/lib/paymentsNormalized.server";

export const runtime = "nodejs";

/** GET — pull payment links from normalized desk tables */
export async function GET(req: Request) {
  // The Fees grant, or the read-only fee reports function (it owns "links").
  // Writing stays module-level: a link is settled only off the stored copy,
  // so no function lifts rows from a browser into this desk.
  const gate = await deskReadGate(req, SCHOOL_DATA_DESK_RBAC["payment-links"]);
  if (gate.mode === "deny") return gate.response;
  if (gate.mode === "feature" && !visibleSlices("fees", gate).has("links")) {
    return NextResponse.json(
      {
        ok: false,
        error: "Reading pay links needs the Fees grant or the fee reports function.",
        reason: "feature_forbidden",
      },
      { status: 403 },
    );
  }
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
    // Links this browser held at an older status (e.g. still "open" after
    // the payment came in): kept as stored; the browser reloads them.
    kept: result.kept ?? [],
    updatedAt: new Date().toISOString(),
  });
}
