import { NextResponse } from "next/server";
import { requireStaffApi } from "@/lib/apiRouteAuth.server";
import { LANGUAGES, type SiteLang } from "@/lib/website";
import { revalidateSite } from "@/lib/website.server";

export const runtime = "nodejs";

/**
 * Drop the cached copy of a page after the desk changes it.
 *
 * Without this the office publishes, reloads the public page, sees the old
 * text, and concludes the desk did not save — the change is in the database
 * and the cache is simply still serving yesterday. That misdiagnosis is
 * expensive, so publishing calls this and reports honestly if it fails.
 *
 * It only ever drops cache entries. There is nothing here to abuse beyond
 * making the next visitor's page render a little slower, but it is still
 * staff-only: an open endpoint that discards a cache is a free way to make
 * a site slow.
 */
export async function POST(req: Request) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;

  let body: { lang?: string; slug?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  const lang = LANGUAGES.find((l) => l.id === body.lang)?.id as
    | SiteLang
    | undefined;
  if (!lang) {
    return NextResponse.json({ error: "Unknown language" }, { status: 400 });
  }
  // The empty slug is the front page, so "missing" and "empty" are not the
  // same thing here and an absent key must not be coerced to the home page.
  if (typeof body.slug !== "string") {
    return NextResponse.json({ error: "Missing slug" }, { status: 400 });
  }

  revalidateSite(lang, body.slug);
  return NextResponse.json({ ok: true });
}
