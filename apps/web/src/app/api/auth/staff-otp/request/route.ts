import { NextResponse } from "next/server";
import { issueParentOtp } from "@/lib/parentOtp.server";
import { resolvePersonByMobile } from "@/lib/authProvisioning.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";

/** POST /api/auth/staff-otp/request — send staff login OTP via WhatsApp */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { mobile?: string };
    const mobile = (body.mobile || "").trim();
    if (!mobile) {
      return NextResponse.json({ error: "Mobile required" }, { status: 400 });
    }

    await ensureSchoolMirrorHydrated();
    // Must be an active staff member's own mobile — mirrors the parent
    // route's own guard (resolveHouseholdByMobileServer): an unresolved
    // number must never receive an OTP that could sign in as someone else.
    const person = await resolvePersonByMobile("staff", mobile);
    if (!person) {
      return NextResponse.json(
        { error: "No staff record found for this mobile. Contact school office." },
        { status: 404 },
      );
    }

    const result = await issueParentOtp({
      mobile,
      loginLabel: "Staff",
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      expiresInSec: result.expiresInSec,
      maskedMobile: `******${mobile.slice(-4)}`,
    });
  } catch (e) {
    console.error("[staff-otp/request]", e);
    return NextResponse.json({ error: "Could not send OTP" }, { status: 500 });
  }
}
