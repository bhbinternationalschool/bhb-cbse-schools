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

  // The year must be one Masters actually defines.
  //
  // This route writes into a SIGNED cookie, which makes whatever it accepts
  // authoritative for every scoped query afterwards. It used to take the
  // client's string as-is, so when a frozen desk fabricated "2025-26" the
  // server laundered that guess into a signed session and the school ran for
  // months in a year that ended 2026-03-31.
  //
  // Switching to a closed year stays allowed — looking at last year's records
  // is ordinary work. What is refused is a year Masters has never heard of,
  // which can only be a fabrication or a forgery.
  const { listAcademicYearCodesFromDesk } = await import(
    "@/lib/mastersNormalized.server"
  );
  const known = await listAcademicYearCodesFromDesk();
  if (known.length > 0 && !known.includes(academicYearCode)) {
    console.warn(
      `[session/ay] refused unknown academic year ${academicYearCode}; ` +
        `Masters defines ${known.join(", ")}`,
    );
    return NextResponse.json(
      { error: `Unknown academic year: ${academicYearCode}` },
      { status: 422 },
    );
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
