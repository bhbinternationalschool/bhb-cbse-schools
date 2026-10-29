import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { getStaffMessageTimeline } from "@/lib/staffMessageLog.server";
import { ChatLogReadError } from "@/lib/schoolChatLog.server";

export const runtime = "nodejs";

/** GET ?staffId=&mobile=&limit= — WA + in-app timeline for one staff member. */
export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "staff", "view");
  if (!auth.ok) return auth.response;
  await ensureSchoolMirrorHydrated();

  const url = new URL(req.url);
  const staffId = (url.searchParams.get("staffId") || "").trim();
  const mobile = (url.searchParams.get("mobile") || "").trim();
  if (!staffId && !mobile) {
    return NextResponse.json(
      { error: "staffId or mobile required" },
      { status: 400 },
    );
  }
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(limitRaw, 500)
    : undefined;

  try {
    const { entries } = await getStaffMessageTimeline({ staffId, mobile, limit });
    return NextResponse.json({ ok: true, entries });
  } catch (e) {
    // A failed read is a 503 the panel shows — never an empty timeline.
    if (e instanceof ChatLogReadError) return NextResponse.json({ ok: false, error: e.message }, { status: 503 });
    throw e;
  }
}
