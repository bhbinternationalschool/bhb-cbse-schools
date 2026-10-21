/**
 * POST /api/data/masters.number-series/next — the next number to ISSUE from a
 * series, never one already on record (data-layer 2.2c, director's review
 * 22 Oct 2026). Body: { series: "<code or id>", ay?: "<year>" }.
 *
 * next = max(the series' stored next, the highest number on record + 1)
 * (ADMISSION / SRN in sis_students, RECEIPT in fee_desk_vouchers —
 * lib/data/server/numberSeriesIssued). A counter found behind its records is
 * LIFTED to that (masters_series_bump, monotone) and the lift is logged, so
 * every screen offers the right number from the next masters answer.
 * Answer: { ok, series, next, formatted, lifted }. Same issuers as /bump.
 * Any other collection here is a 404.
 */
import { NextResponse } from "next/server";
import { invalidateServerMastersCache } from "@/lib/api/v1/auth";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { maxIssuedNumber, nextOf, SERIES_ISSUER, seriesIssuedOnRecord, seriesPrefix } from "@/lib/data/server/numberSeriesIssued";
import { bumpNumberSeries, readNumberSeries } from "@/lib/data/server/repo";
import { clearDeskProbeCache } from "@/lib/deskProbeCache.server";
import { hasPermission, type RbacModule } from "@/lib/rbac";
import { withBuildCheck } from "@/lib/staleBuild.server";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ collection: string }> };

const fail = (status: number, kind: string, message: string) => NextResponse.json({ ok: false, kind, message }, { status });

export const POST = withBuildCheck(async (req: Request, ctx: RouteCtx) => {
  const { collection } = await ctx.params;
  if (collection !== "masters.number-series") return fail(404, "not_found", "Unknown collection");
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  let body: { series?: unknown; ay?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail(400, "invalid", "Invalid JSON");
  }
  const series = typeof body.series === "string" ? body.series.trim() : "";
  const ay = typeof body.ay === "string" && body.ay.trim() ? body.ay.trim() : null;
  if (!series) return fail(400, "invalid", "series (a code or id) is required");
  if (ay !== null && !/^\d{4}-\d{2}$/.test(ay)) return fail(400, "invalid", "ay must be an academic year like 2026-27");

  let stored: Record<string, unknown> | null;
  try {
    stored = await readNumberSeries(series);
  } catch (e) {
    return fail(503, "unavailable", `Could not read the number series (${e instanceof Error ? e.message : String(e)}).`);
  }
  if (!stored) return fail(404, "not_found", `No number series ${series} in Masters.`);
  const code = String(stored.code ?? "");
  if (!auth.viaMirrorSecret) {
    const { session, masters, rbac } = auth.ctx;
    const issuers: readonly RbacModule[] = ["masters", ...(SERIES_ISSUER[code] ?? [])];
    if (!issuers.some((m) => hasPermission(session, masters, m, "edit", rbac))) {
      return fail(403, "auth", `Issuing ${code || series} numbers needs edit on ${issuers.join(" or ")}.`);
    }
  }

  const current = nextOf(stored, ay);
  const prefix = seriesPrefix(stored, ay);
  let next = current;
  let lifted = false;
  if (seriesIssuedOnRecord(code)) {
    const issued = await maxIssuedNumber(code, prefix);
    // Unknown is not "none": without the records the number may be in use.
    if (!issued.ok) return fail(503, "unavailable", `Could not read the ${code} numbers on record — not offering one (${issued.error}).`);
    if (issued.max + 1 > current) {
      console.warn(`[number-series] ${code}: counter ${current} behind the records (${prefix}${issued.max}) — lifting to ${issued.max + 1}`);
      const out = await bumpNumberSeries(code || series, issued.max, ay);
      if (!out.ok) return fail(out.status, out.kind, out.message);
      next = issued.max + 1;
      lifted = true;
      clearDeskProbeCache("masters-desk-rows");
      invalidateServerMastersCache();
    }
  }
  const pad = Number(stored.padWidth) > 0 ? Math.floor(Number(stored.padWidth)) : 0;
  return NextResponse.json({ ok: true, series: code, next, formatted: `${prefix}${String(next).padStart(pad, "0")}`, lifted });
});
