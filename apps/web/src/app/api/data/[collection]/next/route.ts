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
 * RECEIPT and SRN are RESERVED (masters_series_claim, migration
 * 20261027090000): each answer is a number nobody else is handed, and the
 * counter is already past it — callers ask only when they are about to save.
 * Answer: { ok, series, next, formatted, lifted }. Same issuers as /bump.
 * Any other collection here is a 404.
 */
import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { SERIES_ISSUER } from "@/lib/data/server/numberSeriesIssued";
import { nextSeriesNumberServer } from "@/lib/data/server/numberSeriesNext.server";
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

  // The rule lives in lib/data/server/numberSeriesNext.server (data-layer
  // 2.2e: the mobile fee counter issues receipts by it too).
  const out = await nextSeriesNumberServer(series, ay, (code) => {
    if (auth.viaMirrorSecret) return null;
    const { session, masters, rbac } = auth.ctx;
    const issuers: readonly RbacModule[] = ["masters", ...(SERIES_ISSUER[code] ?? [])];
    return issuers.some((m) => hasPermission(session, masters, m, "edit", rbac))
      ? null
      : `Issuing ${code || series} numbers needs edit on ${issuers.join(" or ")}.`;
  });
  if (!out.ok) return fail(out.status, out.kind, out.message);
  return NextResponse.json(out);
});
