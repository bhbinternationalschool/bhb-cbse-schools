import { NextResponse } from "next/server";
import { DEMO_USERS, demoSessionCookieName, type DemoSession } from "@/lib/auth";
import type { Persona } from "@/lib/types";
import { TENANT } from "@/lib/types";
import { DEFAULT_AY } from "@/lib/masters";
import { isDemoAuth } from "@/lib/supabase/client";
import { superAdminRoleCode } from "@/lib/superAdmin";

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
  // When demo auth is off, staff must use Supabase Auth → /api/auth/session
  if (!isDemoAuth() && persona === "staff") {
    return NextResponse.json(
      {
        error:
          "Demo staff login is disabled. Sign in with your school email and password.",
      },
      { status: 403 },
    );
  }
  const user = DEMO_USERS[persona];
  const session: DemoSession = {
    persona,
    fullName: body.fullName?.trim() || user.fullName,
    roleCode:
      superAdminRoleCode(body.email?.trim() || user.email) ||
      body.roleCode?.trim() ||
      user.roleCode,
    email: body.email?.trim() || user.email,
    staffId: body.staffId?.trim() || undefined,
    householdId: body.householdId?.trim() || undefined,
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

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(demoSessionCookieName(), "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return res;
}
