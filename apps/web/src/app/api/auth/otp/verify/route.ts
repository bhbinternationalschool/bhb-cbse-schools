import { NextResponse } from "next/server";
import { demoSessionCookieName, type DemoSession } from "@/lib/auth";
import { appSessionCookieOptions } from "@/lib/authCookies.server";
import { DEFAULT_AY } from "@/lib/masters";
import { resolveParentHousehold } from "@/lib/parentPortal";
import { verifyParentOtp } from "@/lib/parentOtp.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import { writeAudit } from "@/lib/audit.server";

export const runtime = "nodejs";

/** POST /api/auth/otp/verify — verify OTP and mint parent session cookie */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      mobile?: string;
      code?: string;
      academicYearCode?: string;
    };
    const mobile = (body.mobile || "").trim();
    const code = (body.code || "").trim();
    if (!mobile || !code) {
      return NextResponse.json({ error: "Mobile and OTP required" }, { status: 400 });
    }

    const verified = await verifyParentOtp({ mobile, code });
    if (!verified.ok) {
      return NextResponse.json({ error: verified.reason }, { status: 401 });
    }

    await ensureSchoolMirrorHydrated();
    const sis = loadSis();
    const hh = resolveParentHousehold(sis, { mobile });
    if (!hh) {
      return NextResponse.json({ error: "Household not found" }, { status: 404 });
    }

    const session: DemoSession = {
      persona: "parent",
      fullName: hh.guardianName || "Parent",
      roleCode: "parent",
      householdId: hh.id,
      tenantSlug: TENANT.slug,
      academicYearCode: body.academicYearCode?.trim() || DEFAULT_AY,
    };

    await writeAudit({
      session,
      module: "auth",
      action: "create",
      entityType: "parent_session",
      entityId: hh.id,
      summary: `Parent OTP login ${mobile.slice(-4)}`,
    });

    const res = NextResponse.json({ ok: true, session });
    res.cookies.set(
      demoSessionCookieName(),
      encodeURIComponent(JSON.stringify(session)),
      appSessionCookieOptions(),
    );
    return res;
  } catch (e) {
    console.error("[otp/verify]", e);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
