/**
 * App session cookie — browser session only (not 14-day persistent).
 * User must sign in again when opening ERP in a new browser session.
 */

export function appSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
  };
}

export function clearAppSessionCookieOptions() {
  return {
    ...appSessionCookieOptions(),
    maxAge: 0,
  };
}
