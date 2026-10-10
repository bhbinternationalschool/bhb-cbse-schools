import { NextResponse } from "next/server";
import { DEMO_USERS, demoSessionCookieName, type DemoSession } from "@/lib/auth";
import {
  appSessionCookieOptions,
  clearAppSessionCookieOptions,
} from "@/lib/authCookies.server";
import { signSession } from "@/lib/sessionCookie.server";
import type { Persona } from "@/lib/types";
import { TENANT } from "@/lib/types";
import { isDemoAuth } from "@/lib/supabase/client";
import { superAdminRoleCode } from "@/lib/superAdmin";
import { resolveStaffHomeKind } from "@/lib/staffHomeKind.server";
import { loadServerMasters } from "@/lib/api/v1/auth";
import { resolveLoginAcademicYearCode } from "@/lib/workspaceSession.server";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    persona?: Persona;
    academicYearCode?: string;
    fullName?: string;
    roleCode?: string;
    email?: string;
    staffId?: string;
    householdId?: string;
  };
  const persona = body.persona ?? "staff";
  if (!["staff", "parent", "field"].includes(persona)) {
    return NextResponse.json({ error: "Invalid persona" }, { status: 400 });
  }
  // When demo auth is off this route mints identities with no credential
  // check at all, so it must be closed for EVERY persona — not just staff.
  // Staff sign in via Supabase Auth (/api/auth/session); parents via OTP
  // (/api/auth/otp/verify). Previously only "staff" was blocked, which let
  // anyone POST persona:"parent" with an arbitrary householdId and read
  // that family's records.
  if (!isDemoAuth()) {
    return NextResponse.json(
      {
        error:
          persona === "staff"
            ? "Demo staff login is disabled. Sign in with your school email and password."
            : "Demo login is disabled. Sign in with the OTP sent to your registered mobile.",
      },
      { status: 403 },
    );
  }
  const user = DEMO_USERS[persona];
  const email = body.email?.trim() || user.email;
  const ownerRole = superAdminRoleCode(email);
  // Resolved before the session is built so an unresolvable year stops login
  // rather than being stamped into a signed cookie. Null means Masters defines
  // no academic year at all, or could not be read — in both cases every scoped
  // query afterwards would be meaningless, and a guessed year is what ran the
  // school inside a session that ended 2026-03-31.
  const resolvedAy = await resolveLoginAcademicYearCode(body.academicYearCode);
  if (!resolvedAy) {
    return NextResponse.json(
      {
        error:
          "No academic year is set up, so the session cannot be scoped. " +
          "Add the current academic year in Masters, then sign in again.",
      },
      { status: 503 },
    );
  }

  // A demo login pinned to a roster record carries that person's name, not
  // the demo persona's — audit rows and "entered by" fields read it.
  let rosterName = "";
  if (body.staffId?.trim()) {
    try {
      const masters = await loadServerMasters();
      rosterName =
        masters.staff.find((s) => s.id === body.staffId?.trim())?.fullName || "";
    } catch {
      /* keep the demo name */
    }
  }

  const session: DemoSession = {
    persona,
    fullName: body.fullName?.trim() || rosterName || user.fullName,
    roleCode:
      ownerRole ||
      (body.staffId && body.roleCode?.trim() ? body.roleCode.trim() : user.roleCode),
    email,
    staffId: body.staffId?.trim() || undefined,
    householdId: body.householdId?.trim() || undefined,
    tenantSlug: TENANT.slug,
    academicYearCode: resolvedAy,
  };
  const signed = signSession(session);
  if (!signed) {
    return NextResponse.json(
      { error: "Server session signing is not configured" },
      { status: 503 },
    );
  }

  let homeKind: string | undefined;
  if (persona === "staff" || persona === "field") {
    try {
      homeKind =
        persona === "field"
          ? "crew"
          : resolveStaffHomeKind(session, await loadServerMasters());
    } catch (e) {
      console.warn("[demo] homeKind failed", e);
    }
  }
  const res = NextResponse.json({
    ok: true,
    session: homeKind ? { ...session, homeKind } : session,
  });
  res.cookies.set(demoSessionCookieName(), signed, appSessionCookieOptions());
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(demoSessionCookieName(), "", clearAppSessionCookieOptions());
  return res;
}
