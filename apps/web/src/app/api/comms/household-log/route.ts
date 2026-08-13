import { NextResponse } from "next/server";
import { requireWaStaffApi } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { getHouseholdMessageTimeline } from "@/lib/householdMessageLog.server";

export const runtime = "nodejs";

/** GET ?mobile=98xxxxxxxx — merged WA + in-app timeline for the household
 * that mobile resolves to (IVRS and email are not tracked yet — see
 * lib/householdMessageLog.server.ts header for why). */
export async function GET(req: Request) {
  const auth = await requireWaStaffApi(req);
  if (!auth.ok) return auth.response;
  await ensureSchoolMirrorHydrated();

  const url = new URL(req.url);
  const mobile = (url.searchParams.get("mobile") || "").trim();
  if (!mobile) {
    return NextResponse.json({ error: "mobile required" }, { status: 400 });
  }

  const { householdId, entries } = await getHouseholdMessageTimeline({ mobile });
  return NextResponse.json({ ok: true, householdId, entries });
}
