import { NextResponse } from "next/server";
import { demoSessionCookieName, getDemoSession } from "@/lib/auth";
import { appSessionCookieOptions } from "@/lib/authCookies.server";
import { signSession } from "@/lib/sessionCookie.server";

/** PATCH — switch the active academic year on the current session. */
export async function PATCH(request: Request) {
  const body = (await request.json()) as { academicYearCode?: string };
  const academicYearCode = body.academicYearCode?.trim();

  // Verify the existing signed session rather than parsing the raw cookie:
  // this route re-issues a cookie, so an unverified read here would let a
  // forged value be laundered into a validly signed one.
  const session = await getDemoSession();
  if (!session || !academicYearCode) {
    return NextResponse.json({ error: "No session" }, { status: 401 });
  }

  const next = { ...session, academicYearCode };
  const signed = signSession(next);
  if (!signed) {
    return NextResponse.json(
      { error: "Server session signing is not configured" },
      { status: 503 },
    );
  }

  const res = NextResponse.json({ ok: true, session: next });
  // Reuse the shared options: this route previously set a 14-day maxAge,
  // silently promoting a browser-session cookie to a persistent one.
  res.cookies.set(demoSessionCookieName(), signed, appSessionCookieOptions());
  return res;
}
