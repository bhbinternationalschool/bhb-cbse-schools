import { NextResponse } from "next/server";
import { issueParentOtp } from "@/lib/parentOtp.server";
import { resolveHouseholdByMobileServer } from "@/lib/parentHousehold.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";

export const runtime = "nodejs";

/** POST /api/auth/otp/request — send parent login OTP via WhatsApp */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { mobile?: string };
    const mobile = (body.mobile || "").trim();
    if (!mobile) {
      return NextResponse.json({ error: "Mobile required" }, { status: 400 });
    }

    await ensureSchoolMirrorHydrated();
    // Must be the household this number actually belongs to. The old
    // resolveParentHousehold() call could not return null — an unknown
    // number fell through to "the household with the most active
    // children", and the OTP it then received unlocked that family.
    const found = await resolveHouseholdByMobileServer(mobile);
    if (!found) {
      return NextResponse.json(
        { error: "No parent record found for this mobile. Contact school office." },
        { status: 404 },
      );
    }

    const result = await issueParentOtp({
      mobile,
      householdId: found.household.id,
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
    console.error("[otp/request]", e);
    return NextResponse.json({ error: "Could not send OTP" }, { status: 500 });
  }
}
