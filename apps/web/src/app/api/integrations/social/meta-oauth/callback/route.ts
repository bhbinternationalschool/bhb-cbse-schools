import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { completeMetaOAuthCode } from "@/lib/metaOAuth.server";
import {
  connectSingleMetaOAuthPage,
  setPendingMetaPages,
} from "@/lib/socialIntegrations.server";

export const runtime = "nodejs";

const STATE_COOKIE = "bhb_meta_oauth_state";
const STAFF_COOKIE = "bhb_meta_oauth_staff";

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

function socialRedirect(query: Record<string, string>): NextResponse {
  const params = new URLSearchParams({ tab: "social", ...query });
  return NextResponse.redirect(`${appBase()}/comms?${params.toString()}`);
}

/** Meta OAuth callback — stores Page token in ERP */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error_description") ||
    url.searchParams.get("error");

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  const staffKey = jar.get(STAFF_COOKIE)?.value || "Staff";

  jar.delete(STATE_COOKIE);
  jar.delete(STAFF_COOKIE);

  if (oauthError) {
    return socialRedirect({ meta_error: oauthError });
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return socialRedirect({
      meta_error: "Invalid OAuth state — try Connect with Facebook again",
    });
  }

  const pagesResult = await completeMetaOAuthCode(code);
  if (!pagesResult.ok) {
    return socialRedirect({ meta_error: pagesResult.error });
  }

  const pages = pagesResult.pages;

  if (pages.length === 1) {
    const connected = await connectSingleMetaOAuthPage(pages[0]!, staffKey);
    if (!connected.ok) {
      return socialRedirect({ meta_error: connected.error });
    }
    const page = pages[0]!;
    return socialRedirect({
      meta_connected: "1",
      meta_page: page.name,
    });
  }

  const pending = await setPendingMetaPages(pages);
  if (!pending.ok) {
    return socialRedirect({
      meta_error: pending.error || "Could not save Page list",
    });
  }

  return socialRedirect({ meta_pick_page: "1" });
}
