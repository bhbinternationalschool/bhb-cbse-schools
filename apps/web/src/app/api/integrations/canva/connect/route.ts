import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { canvaAuthorizeUrl, newPkce } from "@/lib/canva.server";

export const runtime = "nodejs";

// Read back by ../callback/route.ts (route files may not export constants).
const CANVA_OAUTH_COOKIE = "bhb_canva_oauth";

/**
 * Start the Canva grant. The PKCE verifier and the CSRF state ride in one
 * short-lived httpOnly cookie; the callback checks the state and spends the
 * verifier. Sign in to Canva as the school's Canva for Education account.
 */
export async function GET(request: Request) {
  const auth = await requireStaffPermission(request, "settings", "edit");
  if (!auth.ok) return auth.response;
  const { verifier, challenge, state } = newPkce();
  let url: string;
  try {
    url = await canvaAuthorizeUrl(challenge, state);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
  const jar = await cookies();
  jar.set(CANVA_OAUTH_COOKIE, `${state}.${verifier}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(url);
}
