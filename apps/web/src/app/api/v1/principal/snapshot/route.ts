import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { assertSchoolWide } from "@/lib/api/v1/staffScope";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { buildPrincipalSnapshot } from "@/lib/principalSnapshot.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** GET /api/v1/principal/snapshot */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertPermission(ctx, "home", "view");
    // Whole-school figures and lists (every register, every defaulter with
    // the parent's mobile) — "home.view" alone let any login read them.
    await assertSchoolWide(ctx);
    const url = new URL(request.url);
    const ay = url.searchParams.get("academicYearCode") || ctx.session.academicYearCode;
    const snapshot = await buildPrincipalSnapshot(ay);
    const res = apiOk(snapshot);
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return res;
  } catch (e) {
    return apiErr(e);
  }
}
