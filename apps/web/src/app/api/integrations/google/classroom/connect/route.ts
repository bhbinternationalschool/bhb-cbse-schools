import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDemoSession } from "@/lib/auth";
import {
  buildGoogleOAuthUrl,
  googleClassroomOAuthConfigured,
  newOAuthState,
} from "@/lib/googleOAuth.server";
import { staffConnectionKey } from "@/lib/googleClassroom.store.server";

export const runtime = "nodejs";

const STATE_COOKIE = "bhb_google_oauth_state";
const STAFF_COOKIE = "bhb_google_oauth_staff";

/** Start Google OAuth — redirects to Google consent */
export async function GET() {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }
  if (!googleClassroomOAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in server env",
      },
      { status: 503 },
    );
  }

  const state = newOAuthState();
  const staffKey = staffConnectionKey({
    staffId: session.staffId,
    email: session.email,
    fullName: session.fullName,
  });

  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  jar.set(STAFF_COOKIE, staffKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const url = buildGoogleOAuthUrl(state);
  return NextResponse.redirect(url);
}
