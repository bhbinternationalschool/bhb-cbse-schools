import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DEMO_USERS, demoSessionCookieName, type DemoSession } from "@/lib/auth";
import { DEFAULT_AY } from "@/lib/masters";
import { createServiceSupabase } from "@/lib/supabase/server";
import { superAdminRoleCode } from "@/lib/superAdmin";
import { TENANT, type Persona } from "@/lib/types";

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

  if (persona === "staff" && !staffId && !ownerRole) {
    // Fall back to principal-ish role from profile email heuristics
    const em = (email || "").toLowerCase();
    if (em.includes("principal") || em.includes("owner")) {
      roleCode = "principal";
    } else if (em.includes("admin")) {
      roleCode = "admin";
    }
  }

  const session: DemoSession = {
    persona,
    fullName,
    roleCode,
    email: email || undefined,
    staffId,
    tenantSlug: TENANT.slug,
    academicYearCode: body.academicYearCode?.trim() || DEFAULT_AY,
  };

  const res = NextResponse.json({ ok: true, session });
  res.cookies.set(
    demoSessionCookieName(),
    encodeURIComponent(JSON.stringify(session)),
    {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
      secure: process.env.NODE_ENV === "production",
    },
  );
  return res;
}
