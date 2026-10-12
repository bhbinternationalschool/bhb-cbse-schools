import { readFileSync } from "fs";
import path from "path";

/**
 * Which build this server is running — the one id the whole app compares.
 *
 * GET /api/app-version answers it, the update bar remembers the first answer
 * a page got (lib/clientBuild.ts), the browser sends that back as
 * `X-Bhb-Build`, and lib/staleBuild.server.ts compares the two. Every one of
 * them reads THIS function, so the comparison can never be between two
 * different ideas of "the build" (a mismatch would mark every tab stale).
 *
 * Next writes .next/BUILD_ID once per `next build`, and the standalone
 * server ships it. Cloud Run's K_REVISION is the fallback; "unknown" when
 * neither exists (a test process). Read once per process.
 */
let cached: string | null = null;
export function serverBuildId(): string {
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
