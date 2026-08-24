/**
 * GET /api/admissions/village-contacts — parent numbers per settlement, for
 * the ad-targeting export.
 *
 * Behind `admissions:edit`, not `view`: this returns personal data about
 * families, and reading the dashboard is a much weaker act than pulling a
 * contact list out of it. Every call is written to the audit log with the
 * counts (never the numbers), so an export can be traced to a person later.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { writeAudit } from "@/lib/audit.server";
import {
  VillageContactsError,
  loadVillageContacts,
  parseContactsQuery,
} from "@/lib/villageContacts.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireStaffPermission(request, "admissions", "edit");
  if (!auth.ok) return auth.response;

  try {
    const query = parseContactsQuery(new URL(request.url).searchParams);
    const data = await loadVillageContacts(query);

    const audit = await writeAudit({
      session: auth.ctx.session,
      module: "admissions",
      action: "village_contacts_export",
      entityType: "village_market",
      entityId: query.blocks.join(",") || "all-blocks",
      summary:
        `Exported ${data.totals.contacts} parent contact number(s) across ` +
        `${data.totals.settlements} settlement(s)` +
        (query.blocks.length ? ` in ${query.blocks.join(", ")}` : " (all blocks)"),
      ip: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });
    if (!audit.ok) {
      // An untraceable export of families' phone numbers is not something to
      // shrug at, so it fails rather than succeeding quietly.
      console.error("[village-contacts] audit write failed:", audit.error);
      return NextResponse.json(
        {
          ok: false,
          error:
            "The export could not be recorded in the audit log, so it was not produced. Tell the administrator before retrying.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof VillageContactsError) {
      console.warn(`[village-contacts] ${e.status}: ${e.message}`);
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : "Unexpected error";
    console.error("[village-contacts] unhandled:", message);
    return NextResponse.json(
      { ok: false, error: "Could not build the export. Try again." },
      { status: 500 },
    );
  }
}
