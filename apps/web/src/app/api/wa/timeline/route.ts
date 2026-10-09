import { NextResponse } from "next/server";
import { requireWaStaffApi } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { buildWaTimeline } from "@/lib/waTimeline.server";

export const runtime = "nodejs";

/** GET ?mobile=9876543210&days=60 — one number's whole WhatsApp conversation, every source merged. */
export async function GET(req: Request) {
  const auth = await requireWaStaffApi(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const mobile = (url.searchParams.get("mobile") || "").replace(/\D/g, "").slice(-10);
  if (mobile.length !== 10) return NextResponse.json({ error: "mobile must be 10 digits" }, { status: 400 });
  const days = Number(url.searchParams.get("days") || 60) || 60;
  await ensureSchoolMirrorHydrated();
  return NextResponse.json(await buildWaTimeline(mobile, { days }));
}
