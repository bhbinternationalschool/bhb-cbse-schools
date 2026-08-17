import { NextResponse } from "next/server";
import { demoSessionCookieName, type DemoSession } from "@/lib/auth";
import { appSessionCookieOptions } from "@/lib/authCookies.server";
import { signSession } from "@/lib/sessionCookie.server";
import { resolveLoginAcademicYearCode } from "@/lib/workspaceSession.server";
import { verifyParentOtp } from "@/lib/parentOtp.server";
import { resolvePersonByMobile } from "@/lib/authProvisioning.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadServerMasters } from "@/lib/api/v1/auth";
import { inferRoleCodes } from "@/lib/rbac";
import { superAdminRoleCode } from "@/lib/superAdmin";
import { TENANT } from "@/lib/types";
import { writeAudit } from "@/lib/audit.server";

export const runtime = "nodejs";

/** POST /api/auth/staff-otp/verify — verify OTP and mint staff session cookie */
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
    // Re-resolve rather than trust the request step's result — the same
    // must-belong-to-an-active-staff-row guard the request route already
    // applied, checked again here since a session is about to be minted.
    const person = await resolvePersonByMobile("staff", mobile);
    if (!person || !person.staffId) {
      return NextResponse.json(
        { error: "No staff record found for this mobile. Contact school office." },
        { status: 404 },
      );
    }

    const resolvedAy = await resolveLoginAcademicYearCode(body.academicYearCode);
    if (!resolvedAy) {
      return NextResponse.json(
        { error: "No academic year is set up. Please contact the school." },
        { status: 503 },
      );
    }

    // Same designation-aware roleCode computation /api/auth/session uses
    // for the password path — resolvePersonByMobile alone has no roleCode
    // (it only identifies which staff row this mobile belongs to), so a
    // real driver/teacher/office match against their sis_staff designation
    // matters here exactly as much as it does for a password login.
    let roleCode = "teacher";
    const ownerRole = superAdminRoleCode(person.email);
    if (ownerRole) {
      roleCode = ownerRole;
    } else {
      try {
        const masters = await loadServerMasters();
        const codes = inferRoleCodes(
          {
            roleCode: "",
            email: person.email,
            fullName: person.fullName,
            persona: "staff",
            staffId: person.staffId,
          },
          masters,
        );
        const priority = [
          "principal",
          "admin",
          "driver",
          "accounts",
          "office",
          "transport",
          "teacher",
        ];
        const picked = priority.find((c) => codes.includes(c));
        if (picked) roleCode = picked;
      } catch (e) {
        console.warn("[staff-otp/verify] roleCode inference failed, keeping default", e);
      }
    }

    const session: DemoSession = {
      persona: "staff",
      fullName: person.fullName || "Staff",
      roleCode,
      email: person.email || undefined,
      staffId: person.staffId,
      tenantSlug: TENANT.slug,
      academicYearCode: resolvedAy,
    };

    await writeAudit({
      session,
      module: "auth",
      action: "create",
      entityType: "staff_session",
      entityId: person.staffId,
      summary: `Staff OTP login ${mobile.slice(-4)}`,
    });

    const signed = signSession(session);
    if (!signed) {
      return NextResponse.json(
        { error: "Server session signing is not configured" },
        { status: 503 },
      );
    }

    const res = NextResponse.json({ ok: true, session });
    res.cookies.set(demoSessionCookieName(), signed, appSessionCookieOptions());
    return res;
  } catch (e) {
    console.error("[staff-otp/verify]", e);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
