import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDemoSession } from "@/lib/auth";
import {
  exchangeGoogleAuthCode,
  fetchGoogleUserEmail,
  googleDriveRedirectUri,
} from "@/lib/googleOAuth.server";
import { upsertDriveConnection } from "@/lib/googleDrive.store.server";

export const runtime = "nodejs";

const STATE_COOKIE = "bhb_google_drive_oauth_state";

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

/** Google Drive OAuth callback — stores the tenant's connection in Supabase. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  // No dedicated integrations settings page exists yet — /modules is the
  // closest thing (module registry, same "settings" RBAC module this route
  // is gated on). Revisit once one exists.
  const failRedirect = (msg: string) =>
    NextResponse.redirect(
      `${appBase()}/modules?drive_error=${encodeURIComponent(msg)}`,
    );

  if (oauthError) {
    return failRedirect(oauthError);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return failRedirect("Invalid OAuth state — try connecting again");
  }

  const redirectUri = googleDriveRedirectUri();
  const tokens = await exchangeGoogleAuthCode(code, redirectUri);
  if (!tokens.ok) {
    return failRedirect(tokens.error);
  }
  if (!tokens.tokens.refresh_token) {
    return failRedirect(
      "No refresh token — revoke app access at myaccount.google.com/permissions and reconnect",
    );
  }

  const email =
    (await fetchGoogleUserEmail(tokens.tokens.access_token)) || "connected";
  const expiresAt = new Date(
    Date.now() + (tokens.tokens.expires_in || 3600) * 1000,
  ).toISOString();

  const session = await getDemoSession();
  const connectedBy =
    session && session.persona === "staff" ? session.email || null : null;

  const saved = await upsertDriveConnection({
    email,
    accessToken: tokens.tokens.access_token,
    refreshToken: tokens.tokens.refresh_token,
    expiresAt,
    connectedBy,
  });
  if (!saved) {
    return failRedirect("Could not save the connection — try again");
  }

  return NextResponse.redirect(`${appBase()}/modules?drive_connected=1`);
}
