import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { fetchOpenDuesSummary } from "@/lib/feesDeskAncillary.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/fees/open-dues-summary?ay=2026-27
 *   → { ok, totalBalancePaise, students, families, rows, rebuiltAt }
 *
 * The one open-dues figure: what `fee_desk_open_dues` holds, which is what
 * the WhatsApp reminders and the /pay/due links are built from.
 *
 * Both dashboards read this. Until 2026-09-16 each computed its own — the
 * main dashboard on the server, the fee dashboard in the browser from its
 * own copy of the book — and the two disagreed by lakhs without either being
 * obviously wrong. A figure the office can act on has to be the figure the
 * parent is being asked to pay.
 *
 * Read-only, and view rights are enough: reading what is owed is not editing
 * it, and the defaulters list already opens with `fees:view`.
 */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "fees", "view");
  if (!auth.ok) return auth.response;

  const ay = new URL(req.url).searchParams.get("ay")?.trim() || "";
  const summary = await fetchOpenDuesSummary(ay || undefined);

  return NextResponse.json(
    { ok: true, ...summary },
    { headers: { "Cache-Control": "no-store" } },
  );
}
