import { NextResponse } from "next/server";
import { requireWaStaffApi } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { getHouseholdMessageTimeline } from "@/lib/householdMessageLog.server";

export const runtime = "nodejs";

/**
 * GET ?mobile=98xxxxxxxx or ?householdId=hh_xxx — the merged WhatsApp +
 * in-app timeline for one household, with each message's delivery ticks.
 *
 * `householdId` exists because the caller usually already knows the family:
 * the student profile opens straight onto their history. Requiring a mobile
 * there would mean looking one up to ask about a household we are already
 * looking at, and would miss a family whose registered number has changed
 * since the messages were sent.
 *
 * IVRS and email are not tracked yet — see lib/householdMessageLog.server.ts.
 */
export async function GET(req: Request) {
  const auth = await requireWaStaffApi(req);
  if (!auth.ok) return auth.response;
  await ensureSchoolMirrorHydrated();

  const url = new URL(req.url);
  const mobile = (url.searchParams.get("mobile") || "").trim();
  const householdIdParam = (url.searchParams.get("householdId") || "").trim();
  if (!mobile && !householdIdParam) {
    return NextResponse.json(
      { error: "mobile or householdId required" },
      { status: 400 },
    );
  }

  const { householdId, entries } = await getHouseholdMessageTimeline(
    householdIdParam ? { householdId: householdIdParam } : { mobile },
  );
  return NextResponse.json({ ok: true, householdId, entries });
}
