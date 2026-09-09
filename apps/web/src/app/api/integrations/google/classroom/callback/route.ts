import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeGoogleAuthCode,
  fetchGoogleUserEmail,
} from "@/lib/googleOAuth.server";
import { upsertStaffConnection } from "@/lib/googleClassroom.store.server";

export const runtime = "nodejs";

const STATE_COOKIE = "bhb_google_oauth_state";
const STAFF_COOKIE = "bhb_google_oauth_staff";
const RETURN_COOKIE = "bhb_google_oauth_return";

const RETURN_TARGETS: Record<string, string> = {
  classroom: "/homework?tab=classroom",
  "online-classes": "/online-classes",
};

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

/** Google OAuth callback — stores refresh token server-side */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  const staffKey = jar.get(STAFF_COOKIE)?.value;
  const returnTo =
    RETURN_TARGETS[jar.get(RETURN_COOKIE)?.value || ""] ||
    RETURN_TARGETS.classroom;
  const sep = returnTo.includes("?") ? "&" : "?";

  jar.delete(STATE_COOKIE);
  jar.delete(STAFF_COOKIE);
  jar.delete(RETURN_COOKIE);

  const failRedirect = (msg: string) =>
    NextResponse.redirect(
      `${appBase()}${returnTo}${sep}error=${encodeURIComponent(msg)}`,
    );

  if (oauthError) {
    return failRedirect(oauthError);
  }
  if (!code || !state || !expectedState || state !== expectedState || !staffKey) {
    return failRedirect("Invalid OAuth state — try connecting again");
  }

  const tokens = await exchangeGoogleAuthCode(code);
  if (!tokens.ok) {
    return failRedirect(tokens.error);
  }

  const email =
    (await fetchGoogleUserEmail(tokens.tokens.access_token)) || "connected";
  const expiresAt = new Date(
    Date.now() + (tokens.tokens.expires_in || 3600) * 1000,
  ).toISOString();

  if (!tokens.tokens.refresh_token) {
    return failRedirect(
      "No refresh token — revoke app access at myaccount.google.com/permissions and reconnect",
    );
  }

  await upsertStaffConnection({
    staffKey,
    email,
    accessToken: tokens.tokens.access_token,
    refreshToken: tokens.tokens.refresh_token,
    expiresAt,
    // What Google actually granted — a user may untick a scope on the
    // consent screen, and Meet creation must know before it tries.
    scopes: tokens.tokens.scope || "",
  });

  return NextResponse.redirect(`${appBase()}${returnTo}${sep}connected=1`);
}
