import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDemoSession } from "@/lib/auth";
import {
  buildMetaOAuthUrl,
  metaOAuthConfigured,
  newMetaOAuthState,
} from "@/lib/metaOAuth.server";

export const runtime = "nodejs";

const STATE_COOKIE = "bhb_meta_oauth_state";
const STAFF_COOKIE = "bhb_meta_oauth_staff";

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

/** Start Meta OAuth — redirects to Facebook login */
export async function GET() {
  const session = await getDemoSession();
  if (!session || session.persona !== "staff") {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }
  const role = session.roleCode.toLowerCase();
  if (!/owner|principal|admin|office/.test(role)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  if (!metaOAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "Set META_APP_ID and META_APP_SECRET on the server (same Meta app as WhatsApp). Add Facebook Login product and redirect URI.",
        redirectUri: `${appBase()}/api/integrations/social/meta-oauth/callback`,
      },
      { status: 503 },
    );
  }

  const state = newMetaOAuthState();
  const staffKey = session.staffId || session.email || session.fullName;

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

  return NextResponse.redirect(buildMetaOAuthUrl(state));
}
