import { NextResponse } from "next/server";
import { normalizeMobile10, resolvePersonByMobile } from "@/lib/authProvisioning.server";
import { issueParentOtp } from "@/lib/parentOtp.server";

export const runtime = "nodejs";

type Body = { persona?: string; mobile?: string };

/**
 * POST — send a first-time-login OTP via WhatsApp.
 *
 * Reuses issueParentOtp unchanged — it already took an optional
 * householdId and worked on a bare mobile number underneath; nothing
 * here is parent-specific. The only new check is resolving the mobile to
 * a real, active staff or household record FIRST — a number with no
 * matching record must not be able to trigger an OTP send at all.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const persona = body.persona === "staff" ? "staff" : "parent";
  const mobile10 = normalizeMobile10(body.mobile || "");
  if (!mobile10) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid 10-digit mobile number" },
      { status: 400 },
    );
  }

  const person = await resolvePersonByMobile(persona, mobile10);
  if (!person) {
    return NextResponse.json(
      {
        ok: false,
        error:
          persona === "staff"
            ? "No active staff record found for this number — check with the school office"
            : "No student record found for this number — check with the school office",
      },
      { status: 404 },
    );
  }

  const result = await issueParentOtp({
    mobile: mobile10,
    householdId: person.householdId,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: 502 });
  }

  return NextResponse.json({ ok: true, expiresInSec: result.expiresInSec });
}
