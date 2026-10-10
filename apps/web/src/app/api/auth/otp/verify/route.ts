import { NextResponse } from "next/server";
import { parentSessionResponse } from "@/lib/parentSession.server";
import { readReviewLogin, isReviewLoginPair } from "@/lib/reviewLogin.server";
import { resolveHouseholdByMobileServer } from "@/lib/parentHousehold.server";
import { verifyParentOtp } from "@/lib/parentOtp.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis } from "@/lib/sis";

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

    // App-store review access: Play/App Store reviewers cannot receive a
    // WhatsApp OTP, so a fixed mobile+code pair (env-configured, disabled
    // unless all three vars are set) signs into one designated household.
    const review = readReviewLogin();
    const reviewHousehold = review?.householdId;
    const isReviewLogin = isReviewLoginPair(mobile, code);

    if (!isReviewLogin) {
      const verified = await verifyParentOtp({ mobile, code });
      if (!verified.ok) {
        return NextResponse.json({ error: verified.reason }, { status: 401 });
      }
    }

    await ensureSchoolMirrorHydrated();
    // The session minted below is this household's whole record, so the
    // mobile must resolve to it exactly. resolveParentHousehold() used to
    // sit here and never returned null, which meant a verified code from
    // any number signed in to an unrelated family.
    const hh = isReviewLogin
      ? loadSis().households.find((h) => h.id === reviewHousehold) || null
      : (await resolveHouseholdByMobileServer(mobile))?.household || null;
    if (!hh) {
      return NextResponse.json(
        { error: "No parent record found for this mobile. Contact school office." },
        { status: 404 },
      );
    }

    // Academic year, inactive-family check, audit and cookie: one place.
    return parentSessionResponse({
      household: hh,
      requestedAy: body.academicYearCode,
      checkInactive: !isReviewLogin,
      auditSummary: isReviewLogin
        ? "Store-review parent login (fixed review credentials)"
        : `Parent OTP login ${mobile.slice(-4)}`,
    });
  } catch (e) {
    console.error("[otp/verify]", e);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
