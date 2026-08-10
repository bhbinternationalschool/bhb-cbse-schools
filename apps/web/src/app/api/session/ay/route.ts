import { NextResponse } from "next/server";
import { demoSessionCookieName, getDemoSession } from "@/lib/auth";
import { appSessionCookieOptions } from "@/lib/authCookies.server";
import { signSession } from "@/lib/sessionCookie.server";
import { resolveLoginAcademicYearCode } from "@/lib/workspaceSession.server";

/**
 * GET — what the SERVER says the academic year is, and what this session holds.
 *
 * Exists so the client never computes the year itself. It used to:
 * `alignWorkspaceSessionFromMasters` read the browser's masters copy, called
 * `currentAcademicYearCode()`, and PATCHed the result. On a desk holding no
 * academic years that returned DEFAULT_AY ("2025-26"), so a frozen browser
 * fabricated a year and wrote it to the server, where it outlived the empty
 * desk that produced it and scoped every query for everyone.
 *
 * Now the browser only relays: it asks what the year is and, if its cookie
 * disagrees, asks for that. The answer is resolved from the calendar against
 * Masters in the database — see lib/academicYearResolve.ts.
 */
export async function GET() {
  const session = await getDemoSession();
  if (!session) {
    return NextResponse.json({ error: "No session" }, { status: 401 });
  }

  const resolved = await resolveLoginAcademicYearCode();
  return NextResponse.json({
    // null means Masters defines no usable year — a setup task, not a value
    // to substitute something plausible for.
    resolved,
    session: session.academicYearCode,
    matches: !!resolved && resolved === session.academicYearCode,
  });
}

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
