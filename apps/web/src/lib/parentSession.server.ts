import { NextResponse } from "next/server";
import { demoSessionCookieName, type DemoSession } from "@/lib/auth";
import { appSessionCookieOptions } from "@/lib/authCookies.server";
import { signSession } from "@/lib/sessionCookie.server";
import { resolveLoginAcademicYearCode } from "@/lib/workspaceSession.server";
import type { Household } from "@/lib/sis";
import { TENANT } from "@/lib/types";
import { writeAudit } from "@/lib/audit.server";

/**
 * Sign a parent in to a household — the one place it is done, for an OTP
 * login and for a number just linked from the app (lib/parentNumberLink).
 *
 * The academic year is resolved on the server (a value from the request, or
 * a hardcoded default, once scoped every fee and result a parent saw), and a
 * family the school made inactive is refused (lib/parentFamilyStatus).
 */
export async function parentSessionResponse(opts: {
  household: Household;
  requestedAy?: string;
  /** The store-review login is exempt from the inactive check. */
  checkInactive: boolean;
  auditSummary: string;
}): Promise<NextResponse> {
  const hh = opts.household;
  const resolvedAy = await resolveLoginAcademicYearCode(opts.requestedAy);
  if (!resolvedAy) {
    return NextResponse.json({ error: "No academic year is set up. Please contact the school." }, { status: 503 });
  }

  if (opts.checkInactive) {
    const { readFamilyRollStatus, FAMILY_INACTIVE_MESSAGE } = await import("@/lib/parentFamilyStatus.server");
    if ((await readFamilyRollStatus(hh.id, resolvedAy)) === "inactive") {
      return NextResponse.json({ error: FAMILY_INACTIVE_MESSAGE, code: "family_inactive" }, { status: 403 });
    }
  }

  const session: DemoSession = {
    persona: "parent",
    fullName: hh.guardianName || "Parent",
    roleCode: "parent",
    householdId: hh.id,
    tenantSlug: TENANT.slug,
    academicYearCode: resolvedAy,
  };

  await writeAudit({
    session,
    module: "auth",
    action: "create",
    entityType: "parent_session",
    entityId: hh.id,
    summary: opts.auditSummary,
  });

  const signed = signSession(session);
  if (!signed) {
    return NextResponse.json({ error: "Server session signing is not configured" }, { status: 503 });
  }
  const res = NextResponse.json({ ok: true, session });
  res.cookies.set(demoSessionCookieName(), signed, appSessionCookieOptions());
  return res;
}
