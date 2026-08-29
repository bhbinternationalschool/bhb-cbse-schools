/**
 * Cashfree settlement sweep — the feed that has to be complete.
 *
 * POST pulls every settlement the gateway made in a window, stores it with its
 * event-level breakdown, and posts the ones that have actually been paid into
 * the book. Idempotent end to end, so running it twice is a no-op and running
 * it late still catches up.
 *
 * It exists because the webhook cannot be trusted on its own. A missed webhook
 * leaves no evidence of itself: the school would see no settlement and have no
 * way to tell that apart from the gateway not having settled. A date-range
 * pull can tell the difference, which is why this is the authority and the
 * webhook is only the fast path.
 *
 * Guard: CRON_SECRET. Default window is the last 7 days, which covers a T+2
 * cycle plus a long weekend of bank holidays.
 *
 * GET returns the recon board for the window — every settlement and whether
 * it is explained — and is the read the accounts desk uses.
 */

import { NextResponse } from "next/server";
import { requireJobSecret } from "@/lib/apiRouteAuth.server";
import {
  listSettlementRecon,
  syncCashfreeSettlements,
} from "@/lib/ledger/pgSettlement.server";
import { cashfreeKeysPresent } from "@/lib/cashfree.server";

export const runtime = "nodejs";

function isoDay(d: Date): string {
  // IST, because the settlement cycle and the school's books are both on it.
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function window(req: Request): { from: string; to: string } {
  const url = new URL(req.url);
  const to = url.searchParams.get("to") || isoDay(new Date());
  const from =
    url.searchParams.get("from") ||
    isoDay(new Date(Date.now() - 7 * 86400 * 1000));
  return { from, to };
}

export async function GET(req: Request) {
  if (!cashfreeKeysPresent()) {
    return NextResponse.json(
      { service: "cashfree-settlements", configured: false },
      { status: 503 },
    );
  }
  const range = window(req);
  const res = await listSettlementRecon(range);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 500 });

  const breaks = res.rows.filter(
    (r) => r.reconState !== "explained" && r.reconState !== "pending",
  );
  return NextResponse.json({
    service: "cashfree-settlements",
    configured: true,
    ...range,
    count: res.rows.length,
    breakCount: breaks.length,
    rows: res.rows,
  });
}

export async function POST(req: Request) {
  if (!requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!cashfreeKeysPresent()) {
    return NextResponse.json(
      { error: "Cashfree keys not configured" },
      { status: 503 },
    );
  }

  const range = window(req);
  const outcome = await syncCashfreeSettlements({ ...range, actor: "settlement sweep" });
  // Errors are reported, not thrown: a partial sweep that stored eight of ten
  // settlements has done real work, and the next run retries the rest.
  return NextResponse.json({ ok: outcome.errors.length === 0, ...range, ...outcome });
}
