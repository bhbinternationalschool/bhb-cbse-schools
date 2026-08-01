/**
 * Google OAuth 2.0 — Classroom integration (server-only).
 */

import { randomBytes } from "crypto";

export const GOOGLE_CLASSROOM_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
].join(" ");

export function googleOAuthClientId(): string {
  return (
    process.env.GOOGLE_OAUTH_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID ||
    ""
  ).trim();
}

export function googleOAuthClientSecret(): string {
  return (
    process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    ""
  ).trim();
}

export function googleOAuthRedirectUri(): string {
  const explicit = (
    process.env.GOOGLE_OAUTH_REDIRECT_URI ||
    process.env.GOOGLE_CLASSROOM_REDIRECT_URI ||
    ""
  ).trim();
  if (explicit) return explicit;
  const base = (
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  return `${base}/api/integrations/google/classroom/callback`;
}

export function googleClassroomOAuthConfigured(): boolean {
  return !!(googleOAuthClientId() && googleOAuthClientSecret());
}

export function newOAuthState(): string {
  return randomBytes(24).toString("hex");
}

export function buildGoogleOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: googleOAuthClientId(),
    redirect_uri: googleOAuthRedirectUri(),
    response_type: "code",
    scope: GOOGLE_CLASSROOM_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
};

export async function exchangeGoogleAuthCode(
  code: string,
): Promise<
  | { ok: true; tokens: GoogleTokenResponse }
  | { ok: false; error: string }
> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: googleOAuthClientId(),
        client_secret: googleOAuthClientSecret(),
        redirect_uri: googleOAuthRedirectUri(),
        grant_type: "authorization_code",
      }),
    });
    const json = (await res.json().catch(() => ({}))) as GoogleTokenResponse & {
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      return {
        ok: false,
        error: json.error_description || json.error || `Token HTTP ${res.status}`,
      };
    }
    return { ok: true, tokens: json };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Token exchange failed",
    };
  }
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<
  | { ok: true; accessToken: string; expiresIn: number }
  | { ok: false; error: string }
> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: googleOAuthClientId(),
        client_secret: googleOAuthClientSecret(),
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const json = (await res.json().catch(() => ({}))) as GoogleTokenResponse & {
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      return {
        ok: false,
        error: json.error_description || json.error || `Refresh HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      accessToken: json.access_token,
      expiresIn: json.expires_in || 3600,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Token refresh failed",
    };
  }
}

export async function fetchGoogleUserEmail(
  accessToken: string,
): Promise<string | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { email?: string };
    return json.email || null;
  } catch {
    return null;
  }
}
