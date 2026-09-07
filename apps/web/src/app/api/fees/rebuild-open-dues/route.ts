import { NextResponse } from "next/server";
import {
  requireJobSecret,
  requireStaffPermission,
} from "@/lib/apiRouteAuth.server";
import { rebuildFeeOpenDuesCache } from "@/lib/feesDeskAncillary.server";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Recompute what every family owes, from the receipts as they stand now.
 *
 * `fee_desk_open_dues` is DERIVED: a due is cleared by the lines of the
 * receipt that paid it. Until 2026-09-08 the only thing that rebuilt it was a
 * successful fee-desk push, which is fine while the counter is busy and
 * useless the moment the two fall out of step.
 *
 * They fell out of step this week. The 2026-09-06 wipe emptied every
 * receipt's lines, the dues were rebuilt from that emptiness at 14:31:17, and
 * every family went back to owing their whole year. The lines were restored
 * the next day — 1,913 of them — but nothing recomputed the dues, so two days
 * later the book still showed ₹1 collected against a ₹36.7 lakh session while
 * ₹21.2 lakh of receipts sat in the same database.
 *
 * That is the shape of the whole week's trouble: the damage was repaired and
 * the thing DERIVED from it was not, so the school kept reading the old
 * answer. A restore is not finished until what depends on it is rebuilt, and
 * this is the button that finishes it.
 *
 * Reads receipts and writes only the dues cache, so it is safe to run twice.
 * Takes either the cron secret or a staff session with `fees:edit`.
 *
 *   POST /api/fees/rebuild-open-dues            → current academic year
 *   POST /api/fees/rebuild-open-dues?ay=2026-27 → a named one
 */
export async function GET() {
  return NextResponse.json({
    service: "fee-open-dues-rebuild",
    note:
      "POST with x-cron-secret, or as staff with fees:edit. " +
      "Recomputes fee_desk_open_dues from the receipts as they stand.",
  });
}

export async function POST(req: Request) {
  const byJob = requireJobSecret(req, ["CRON_SECRET"], ["x-cron-secret"]);
  if (!byJob) {
    const auth = await requireStaffPermission(req, "fees", "edit");
    if (!auth.ok) return auth.response;
  }

  // The year is never guessed. A rebuild scoped to the wrong year prunes and
  // rewrites the dues of a year nobody asked about — the same trap the push
  // path documents, and the reason it skips the rebuild rather than assume.
  const ay = new URL(req.url).searchParams.get("ay")?.trim() || "";

  const before = Date.now();
  const r = await rebuildFeeOpenDuesCache(ay);
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: r.error || "Rebuild failed" },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    academicYearCode: ay || "(current)",
    dueRows: r.count,
    ms: Date.now() - before,
  });
}
