/**
 * POST /api/data/masters.number-series/bump — a number was issued from a
 * Masters number series (an admission number, a receipt, a certificate …);
 * move the series' next number past it (data-layer 2.2c).
 *
 * Body: { series: "<code or id>", used: <the number issued, ≥ 1>, ay?: "<year>" }.
 * masters_series_bump (migration 20261021090000) does it under the slice lock:
 * next = max(stored next, used + 1), per year when the series resets per year
 * and `ay` is given; a lower number moves nothing. No base — it is monotone,
 * so two desks issuing numbers at once cannot undo each other (the old path
 * saved the whole numberSeries list from the tab's copy, and needed Masters
 * edit, so the office's admissions and the counter's receipts never moved it).
 *
 * Who (data-layer 2.2c review): a Masters editor for any series; otherwise
 * the module that ISSUES that series (SERIES_ISSUER) — a receipt number is the
 * fee counter's, an admission number the office's, never anyone's with edit
 * on some other module. A number may move the series at most MAX_JUMP past
 * its stored next (a typo'd "1000099" would otherwise skip a million numbers,
 * irreversibly) — unless the records hold it (ADMISSION / SRN in sis_students,
 * RECEIPT in fee_desk_vouchers: an import's numbers really were issued);
 * anything else further is refused, logged, and the screen says so. A counter
 * found behind its records is lifted past them (lib/data/server/numberSeriesIssued).
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

/** How far past its stored next number one issued number may move a series. */
const MAX_JUMP = 50;

const fail = (status: number, kind: string, message: string) => NextResponse.json({ ok: false, kind, message }, { status });

export const POST = withBuildCheck(async (req: Request, ctx: RouteCtx) => {
  const { collection } = await ctx.params;
  if (collection !== "masters.number-series") return fail(404, "not_found", "Unknown collection");
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  let body: { series?: unknown; used?: unknown; ay?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail(400, "invalid", "Invalid JSON");
  }
  const series = typeof body.series === "string" ? body.series.trim() : "";
  const used = typeof body.used === "number" ? body.used : Number.NaN;
  const ay = typeof body.ay === "string" && body.ay.trim() ? body.ay.trim() : null;
  if (!series) return fail(400, "invalid", "series (a code or id) is required");
  if (ay !== null && !/^\d{4}-\d{2}$/.test(ay)) return fail(400, "invalid", "ay must be an academic year like 2026-27");
  if (!Number.isInteger(used) || used < 1) return fail(400, "invalid", "used must be a whole number, 1 or more");

  let stored: Record<string, unknown> | null;
  try {
    stored = await readNumberSeries(series);
  } catch (e) {
    return fail(503, "unavailable", `Could not read the number series — nothing moved (${e instanceof Error ? e.message : String(e)}).`);
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
  const perAy = stored.resetOnAy === true ? ay : null;
  const current = nextOf(stored, perAy);
  // A series whose numbers live in a table: what has REALLY been issued
  // (director, 22 Oct 2026 — a lagging counter re-issues a number in use,
  // worse than a big jump). A jump past MAX_JUMP is accepted only when the
  // records hold that number; a counter behind the records is lifted past
  // them (logged).
  const prefix = seriesPrefix(stored, ay);
  const issued = seriesIssuedOnRecord(code) ? await maxIssuedNumber(code, prefix) : null;
  let target = used;
  if (issued?.ok && issued.max > target && issued.max + 1 > current) {
    console.warn(`[number-series] ${code}: counter ${current} behind the records (${prefix}${issued.max}) — lifted past them`);
    target = issued.max;
  }
  if (target > current - 1 + MAX_JUMP) {
    const verified = issued?.ok === true && issued.max >= target;
    if (!verified) {
      console.warn(
        `[number-series] refused bump ${code} to ${target + 1}: stored next ${current}, at most ${MAX_JUMP} ahead unless the records hold it` +
          (issued && !issued.ok ? ` (records unreadable: ${issued.error})` : ""),
      );
      return fail(
        409,
        "invalid",
        `${code || series}: ${used} is more than ${MAX_JUMP} past the next number (${current}) and is not on record — the series was not moved. Check the number, or set the series in Masters → Numbering.`,
      );
    }
    console.warn(`[number-series] ${code}: jump to ${target + 1} accepted — ${prefix}${issued.max} is on record`);
  }

  const out = await bumpNumberSeries(series, target, ay);
  if (!out.ok) return fail(out.status, out.kind, out.message);
  if (out.changed) {
    clearDeskProbeCache("masters-desk-rows");
    invalidateServerMastersCache();
  }
  return NextResponse.json(out);
});
