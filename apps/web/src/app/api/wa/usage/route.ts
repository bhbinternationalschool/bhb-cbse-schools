/**
 * GET  /api/wa/usage?since=  — what WhatsApp cost this window.
 * PUT  /api/wa/usage         — set the school's own per-message rates.
 *
 * Staff route on `wa_automation`: view to read the dashboard, edit to
 * change the rate card. Rates are what every rupee figure in the ERP's
 * WhatsApp costing multiplies by, so changing them is an edit, not a view.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { saveWaCostRates } from "@/lib/waCostRates.server";
import { waUsageReport } from "@/lib/waUsageCost.server";

export const runtime = "nodejs";

const MAX_WINDOW_DAYS = 400;

function sinceFromQuery(req: Request): string | undefined {
  const raw = new URL(req.url).searchParams.get("since") || "";
  if (!raw) return undefined;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return undefined;
  const floor = Date.now() - MAX_WINDOW_DAYS * 86_400_000;
  return new Date(Math.max(t, floor)).toISOString();
}

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "wa_automation", "view");
  if (!auth.ok) return auth.response;

  const report = await waUsageReport({ sinceIso: sinceFromQuery(req) });
  if (!report.ok) {
    // 502, never 200-with-zeros: "we could not read the log" must not reach
    // the director as "WhatsApp cost nothing this month".
    return NextResponse.json(
      { error: report.error || "Could not read the message log" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ...report, ok: true });
}

export async function PUT(req: Request) {
  const auth = await requireStaffPermission(req, "wa_automation", "edit");
  if (!auth.ok) return auth.response;

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const who =
    auth.ctx.session.fullName || auth.ctx.session.roleCode || "masters";
  const saved = await saveWaCostRates(
    (body as { rates?: unknown })?.rates ?? body,
    who,
  );
  if (!saved.ok) {
    return NextResponse.json(
      { error: saved.error || "Could not save the rates" },
      { status: 502 },
    );
  }

  // Re-price the same window straight away, so the screen shows the effect
  // of the new rate rather than asking the office to reload and compare.
  const report = await waUsageReport({
    sinceIso: sinceFromQuery(req),
    ratesOverride: saved.rates,
  });
  return NextResponse.json({ ok: true, rates: saved.rates, report });
}
