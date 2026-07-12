import { NextResponse } from "next/server";
import {
  DEMO_USERS,
  demoSessionCookieName,
  type DemoSession,
} from "@/lib/auth";
import type { Persona } from "@/lib/types";
import { TENANT } from "@/lib/types";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    persona?: Persona;
    academicYearCode?: string;
  };
  const persona = body.persona ?? "staff";
  if (!["staff", "parent", "field"].includes(persona)) {
    return NextResponse.json({ error: "Invalid persona" }, { status: 400 });
  }
  const user = DEMO_USERS[persona];
  const session: DemoSession = {
    persona,
    fullName: user.fullName,
    roleCode: user.roleCode,
    email: user.email,
    tenantSlug: TENANT.slug,
    academicYearCode: body.academicYearCode ?? "2025-26",
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
