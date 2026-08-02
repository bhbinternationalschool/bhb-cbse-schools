import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { buildPrincipalSnapshot } from "@/lib/principalSnapshot.server";

export const runtime = "nodejs";

/** GET /api/v1/principal/snapshot */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertPermission(ctx, "home", "view");
    const url = new URL(request.url);
    const ay = url.searchParams.get("academicYearCode") || ctx.session.academicYearCode;
    const snapshot = await buildPrincipalSnapshot(ay);
    return apiOk(snapshot);
  } catch (e) {
    return apiErr(e);
  }
}
