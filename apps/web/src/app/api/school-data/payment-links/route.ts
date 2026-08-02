import { NextResponse } from "next/server";
import { getDemoSession } from "@/lib/auth";
import type { PaymentLink } from "@/lib/payments";
import { paymentsDualWriteDbEnabled } from "@/lib/paymentsDbConfig";
import {
  fetchPaymentDeskFromDb,
  pushPaymentDeskToDb,
} from "@/lib/paymentsNormalized.server";

export const runtime = "nodejs";

async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.MIRROR_SYNC_SECRET?.trim();
  const header = req.headers.get("x-mirror-secret")?.trim();
  if (secret && header && header === secret) return true;
  const session = await getDemoSession();
  return !!session;
}

/** GET — pull payment links from normalized desk tables */
export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { links, meta } = await fetchPaymentDeskFromDb();
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
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
