import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  buildGoogleOAuthUrl,
  googleClassroomOAuthConfigured,
  googleDriveRedirectUri,
  newOAuthState,
  GOOGLE_DRIVE_SCOPES,
} from "@/lib/googleOAuth.server";

export const runtime = "nodejs";

const STATE_COOKIE = "bhb_google_drive_oauth_state";

/**
 * Start Google Drive OAuth — one admin authorizes once, tenant-wide.
 * Gated the same way canConfigureRbac is: this connection is a school-wide
 * credential, not a per-staff one like Classroom's connect route.
 */
export async function GET(request: Request) {
  const auth = await requireStaffPermission(request, "settings", "edit");
  if (!auth.ok) return auth.response;

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
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const url = buildGoogleOAuthUrl(state, {
    scopes: GOOGLE_DRIVE_SCOPES,
    redirectUri: googleDriveRedirectUri(),
  });
  return NextResponse.redirect(url);
}
