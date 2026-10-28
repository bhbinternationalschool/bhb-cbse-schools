/**
 * Session cookies for tests against the local stack.
 *
 * Signs a DemoSession with the app's own signSession() (lib/sessionCookie.server.ts)
 * — the same HMAC the login routes use, keyed on APP_SESSION_SECRET — so the
 * app accepts it exactly as it accepts a real login. Auth code is used, never
 * changed. `assertLocalStack()` refuses to mint anything unless the process is
 * configured for the 127.0.0.1 stack: a cookie signed with production's
 * secret would be a real login.
 */

import type { DemoSession } from "@/lib/auth";
import { demoSessionCookieName } from "@/lib/auth";
import { signSession } from "@/lib/sessionCookie.server";

/** Throws unless this process is pointed at the local e2e stack. */
export function assertLocalStack(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) {
    throw new Error(`refusing: NEXT_PUBLIC_SUPABASE_URL is "${url}", not the 127.0.0.1 e2e stack`);
  }
  if (process.env.E2E !== "1") {
    throw new Error("refusing: E2E=1 is not set — load apps/web/.env.e2e (scripts/e2e/with-env.mjs)");
  }
  if (process.env.APP_SESSION_SECRET !== "e2e-secret") {
    throw new Error("refusing: APP_SESSION_SECRET is not the e2e stack's");
  }
}

/** The signed cookie value for `session`. */
export function mintSessionCookie(session: DemoSession): string {
  assertLocalStack();
  const value = signSession(session);
  if (!value) throw new Error("signSession returned null — APP_SESSION_SECRET missing?");
  return value;
}

/** A `Cookie:` request header carrying `session`. */
export function sessionCookieHeader(session: DemoSession): string {
  return `${demoSessionCookieName()}=${mintSessionCookie(session)}`;
}
