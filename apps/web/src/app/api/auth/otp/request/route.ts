import { NextResponse } from "next/server";
import { issueParentOtp, normalizeMobile10 } from "@/lib/parentOtp.server";
import { noteUnknownLoginServer } from "@/lib/loginUnknownNumbers.server";
import { resolveHouseholdByMobileServer } from "@/lib/parentHousehold.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { isReviewLoginMobile } from "@/lib/reviewLogin.server";

export const runtime = "nodejs";

/** POST /api/auth/otp/request — send parent login OTP via WhatsApp */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { mobile?: string };
    const mobile = (body.mobile || "").trim();
    if (!mobile) {
      return NextResponse.json({ error: "Mobile required" }, { status: 400 });
    }

    // App-store review access: the listed number is fictional and no phone
    // answers it, so sending a WhatsApp OTP can only fail — and a failed send
    // returns 502, stranding the reviewer at their first tap. The fixed code
    // is checked at /verify; knowing the number alone signs nobody in.
    if (isReviewLoginMobile(mobile)) {
      return NextResponse.json({
        ok: true,
        expiresInSec: 600,
        maskedMobile: `******${mobile.slice(-4)}`,
      });
    }

    // A mistyped number (Indian mobiles start 6–9) is said so at once, and
    // never lands on the office's call list.
    const typed = normalizeMobile10(mobile);
    if (!typed || !/^[6-9]/.test(typed)) {
      return NextResponse.json(
        { error: "This doesn't look like a 10-digit mobile number — please check it.", code: "invalid_number" },
        { status: 400 },
      );
    }

    await ensureSchoolMirrorHydrated();
    // Must be the household this number actually belongs to. The old
    // resolveParentHousehold() call could not return null — an unknown
    // number fell through to "the household with the most active
    // children", and the OTP it then received unlocked that family.
    const found = await resolveHouseholdByMobileServer(mobile);
    if (!found) {
      // The office's call list (Comms → WhatsApp → Class groups): a family
      // who wants the app but whose number the ERP does not have.
      const m10 = normalizeMobile10(mobile);
      if (m10) await noteUnknownLoginServer(m10, "parent");
      return NextResponse.json(
        // The app offers "Link this number" on this code (lib/parentNumberLink).
        {
          error: "This number is not on the school's record. Link it to your child below (update the app if you don't see the option), or contact the school office.",
          code: "unknown_number",
        },
        { status: 404 },
      );
    }

    // A family the school has made inactive gets no code — and is told why.
    const { familyRollStatus, FAMILY_INACTIVE_MESSAGE } = await import("@/lib/parentFamilyStatus.server");
    if (familyRollStatus(found.students, "") === "inactive") {
      return NextResponse.json({ error: FAMILY_INACTIVE_MESSAGE, code: "family_inactive" }, { status: 403 });
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
