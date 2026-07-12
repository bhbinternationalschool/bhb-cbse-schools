import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { demoSessionCookieName, type DemoSession } from "@/lib/auth";

export async function PATCH(request: Request) {
  const body = (await request.json()) as { academicYearCode?: string };
  const store = await cookies();
  const raw = store.get(demoSessionCookieName())?.value;
  if (!raw || !body.academicYearCode) {
    return NextResponse.json({ error: "No session" }, { status: 401 });
  }
  const session = JSON.parse(decodeURIComponent(raw)) as DemoSession;
  session.academicYearCode = body.academicYearCode;
  const res = NextResponse.json({ ok: true, session });
  res.cookies.set(
    demoSessionCookieName(),
    encodeURIComponent(JSON.stringify(session)),
    {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    },
  );
  return res;
}
