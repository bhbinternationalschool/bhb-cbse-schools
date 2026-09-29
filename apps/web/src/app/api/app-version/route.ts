import { readFileSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";

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
 * Next writes .next/BUILD_ID once per `next build`, and the standalone
 * server ships it. Cloud Run's K_REVISION is the fallback. Public on
 * purpose — it says nothing but an opaque id.
 */
let cached: string | null = null;
function buildId(): string {
  if (cached) return cached;
  for (const p of [
    path.join(process.cwd(), ".next", "BUILD_ID"),
    path.join(process.cwd(), "apps", "web", ".next", "BUILD_ID"),
  ]) {
    try {
      const id = readFileSync(p, "utf8").trim();
      if (id) return (cached = id);
    } catch {
      /* try the next place */
    }
  }
  return (cached = process.env.K_REVISION || "unknown");
}

export function GET() {
  return NextResponse.json(
    { build: buildId() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
