import { NextResponse } from "next/server";
import { resolveParentHousehold } from "@/lib/parentPortal";
import { issueParentOtp } from "@/lib/parentOtp.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis } from "@/lib/sis";

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
    const sis = loadSis();
    const hh = resolveParentHousehold(sis, { mobile });
    if (!hh) {
      return NextResponse.json(
        { error: "No parent record found for this mobile. Contact school office." },
        { status: 404 },
      );
    }

    const result = await issueParentOtp({
      mobile,
      householdId: hh.id,
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
