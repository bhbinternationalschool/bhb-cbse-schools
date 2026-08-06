import { apiErr, apiOk } from "@/lib/api/v1/errors";
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
