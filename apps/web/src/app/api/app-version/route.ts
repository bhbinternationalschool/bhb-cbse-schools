import { NextResponse } from "next/server";
import { serverBuildId } from "@/lib/serverBuild.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/app-version — which build this server is running.
 *
 * The "new version — tap to refresh" bar (components/pwa/UpdateBar) asks
 * this when a phone comes back to the ERP. It remembers the first answer it
 * got; a different answer later means a deploy happened while the page was
 * open, so its screens are the old ones (2026-09-30: teachers keep the ERP
 * open on their phones for days and never reload).
 *
 * The id is lib/serverBuild.server.ts — the same function the stale-build
 * check compares `X-Bhb-Build` against. Public on purpose — it says nothing
 * but an opaque id.
 */
/**
 * The git commit this image was built from (13 Oct 2026), set by the deploy
 * as APP_COMMIT_SHA. Answers "is the fix live?" without hashing a source
 * tarball: compare it with `git rev-parse origin/main`. Null on a build that
 * did not pass one. A commit sha is public in the repository anyway.
 */
function commitSha(): string | null {
  const sha = (process.env.APP_COMMIT_SHA || "").trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
}

export function GET() {
  return NextResponse.json(
    { build: serverBuildId(), commit: commitSha() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
