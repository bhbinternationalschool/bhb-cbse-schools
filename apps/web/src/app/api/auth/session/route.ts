import { NextResponse } from "next/server";
import { resolveStaffHomeKind } from "@/lib/staffHomeKind.server";
import { createClient } from "@supabase/supabase-js";
import { DEMO_USERS, demoSessionCookieName, type DemoSession } from "@/lib/auth";
import { appSessionCookieOptions } from "@/lib/authCookies.server";
import { signSession } from "@/lib/sessionCookie.server";
import { loadServerMasters } from "@/lib/api/v1/auth";
import { inferRoleCodes } from "@/lib/rbac";
import { createServiceSupabase } from "@/lib/supabase/server";
import { superAdminRoleCode } from "@/lib/superAdmin";
import { TENANT, type Persona } from "@/lib/types";
import { resolveLoginAcademicYearCode } from "@/lib/workspaceSession.server";

/**
 * Mint app session cookie after Supabase Auth sign-in.
 * Client posts access_token; we verify user and map profiles (+ optional staff email).
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    accessToken?: string;
    academicYearCode?: string;
  };
  const accessToken = body.accessToken?.trim();
  if (!accessToken) {
    return NextResponse.json({ error: "Missing access token" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json(
      { error: "Supabase is not configured" },
      { status: 503 },
    );
  }

  const authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const {
    data: { user },
    error: userErr,
  } = await authClient.auth.getUser(accessToken);
  if (userErr || !user) {
    return NextResponse.json(
      { error: userErr?.message || "Invalid session" },
      { status: 401 },
    );
  }

  const admin = createServiceSupabase();
  const db = admin ?? authClient;

  const { data: profile, error: profileErr } = await db
    .from("profiles")
    .select("id, full_name, email, mobile, persona, tenant_id, is_active")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (profileErr) {
    return NextResponse.json(
      { error: profileErr.message || "Profile lookup failed" },
      { status: 500 },
    );
  }
  if (!profile) {
    return NextResponse.json(
      {
        error:
          "No school profile linked to this login. Ask an admin to link your auth user.",
      },
      { status: 403 },
    );
  }
  if (profile.is_active === false) {
    return NextResponse.json({ error: "Account is inactive" }, { status: 403 });
  }

  const persona: Persona =
    profile.persona === "parent" ||
    profile.persona === "field" ||
    profile.persona === "student"
      ? profile.persona
      : "staff";

  let roleCode = DEMO_USERS[persona].roleCode;
  let staffId: string | undefined;
  let householdId: string | undefined;
  let fullName = (profile.full_name as string) || DEMO_USERS[persona].fullName;
  const email =
    (profile.email as string | null) ||
    user.email ||
    DEMO_USERS[persona].email;

  const ownerRole = superAdminRoleCode(email);
  if (ownerRole) {
    roleCode = ownerRole;
  }

  if (persona === "staff" && admin && profile.tenant_id) {
    const emailKey = (email || "").trim().toLowerCase();
    if (emailKey) {
      const { data: staffRows } = await admin
        .from("sis_staff")
        .select("id, full_name, email, profile")
        .eq("tenant_id", profile.tenant_id)
        .limit(200);
      const hit = (staffRows ?? []).find((row) => {
        const em = String(row.email ?? "").trim().toLowerCase();
        const login = String(
          (row.profile as { loginUsername?: string } | null)?.loginUsername ??
            "",
        )
          .trim()
          .toLowerCase();
        return em === emailKey || login === emailKey;
      });
      if (hit) {
        staffId = hit.id as string;
        if (hit.full_name) fullName = hit.full_name as string;
      }
    }
  }

  // Same shape as the staff resolution above, by mobile instead of email —
  // profiles has no household_id column, so this is how a parent's
  // session gets scoped to their household. Previously missing entirely:
  // a parent signing in via Supabase Auth got a session with no
  // householdId, which every parent-portal screen needs.
  if (persona === "parent" && admin && profile.tenant_id) {
    const mobileKey = (profile.mobile as string | null)?.trim() || "";
    if (mobileKey) {
      const { data: hhRows } = await admin
        .from("sis_households")
        .select("id, guardian_name, mobile, whatsapp_mobile, alt_mobile")
        .eq("tenant_id", profile.tenant_id)
        .or(
          `mobile.eq.${mobileKey},whatsapp_mobile.eq.${mobileKey},alt_mobile.eq.${mobileKey}`,
        )
        .limit(1)
        .maybeSingle();
      if (hhRows) {
        householdId = hhRows.id as string;
        if (hhRows.guardian_name) fullName = hhRows.guardian_name as string;
      }
    }
  }

  // Every real (non-demo) staff login used to keep roleCode at its
  // DEMO_USERS default of "principal" once staffId WAS matched — the block
  // below only ever ran for the unmatched case, so the one signal that
  // actually knows who this person is (their sis_staff designation) was
  // never consulted. Every teacher and driver signing in for real landed on
  // roleCode "principal", which is what the mobile app's principal-vs-
  // teacher-vs-driver home routing keys off. inferRoleCodes() already does
  // this correctly (designation-aware, staffId-aware) and is the same
  // function permission checks use — reuse it instead of a second, weaker
  // heuristic. roleCode is passed in blank so the stale default above can't
  // leak into its own regex-matching step; ownerRole (protected super-admin
  // emails) is preserved untouched — inferRoleCodes never grants "owner"
  // from a designation, by design (see its own comment).
  if (persona === "staff" && !ownerRole) {
    try {
      const masters = await loadServerMasters();
      const codes = inferRoleCodes(
        { roleCode: "", email, fullName, persona, staffId },
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
      console.warn("[session] roleCode inference failed, keeping default", e);
    }
  }

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

  const session: DemoSession = {
    persona,
    fullName,
    roleCode,
    email: email || undefined,
    staffId,
    householdId,
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
  if (persona === "staff") {
    try {
      homeKind = resolveStaffHomeKind(session, await loadServerMasters());
    } catch (e) {
      console.warn("[session] homeKind failed", e);
    }
  }

  const res = NextResponse.json({
    ok: true,
    session: homeKind ? { ...session, homeKind } : session,
  });
  res.cookies.set(demoSessionCookieName(), signed, appSessionCookieOptions());
  return res;
}
