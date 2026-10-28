import { serverBuildId } from "@/lib/serverBuild.server";

/**
 * Record writes that come from a page running an older build (data-layer 1.2).
 *
 * A tab opened before a deploy keeps running the old screens until it
 * reloads, and its saves can carry the old body shape. This RECORDS such a
 * write — one structured log line, and `X-Bhb-Build-Stale: 1` on the reply —
 * and does nothing else. It never refuses the request: a refusal here would
 * throw away whatever a person typed in a tab opened before the deploy.
 * Refusing an old build is decided per route, later, only when that route's
 * old body shape is retired (the 410-stub steps of COMMAND.md).
 *
 * WHY A HELPER AND NOT middleware.ts: the middleware runs on the edge runtime
 * (no `fs`, so it cannot read .next/BUILD_ID the way /api/app-version does),
 * it matches only page prefixes today, and widening its matcher to /api/*
 * would put a new hop in front of every webhook, upload and mobile call for
 * a check that only matters on a handful of write routes. So a route opts in
 * by wrapping its handler: `export const POST = withBuildCheck(handler)`.
 */

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** What a build id looks like (Next's BUILD_ID, or a Cloud Run revision name). */
const BUILD_RE = /^[A-Za-z0-9._-]{1,80}$/;

export const BUILD_HEADER = "x-bhb-build";
export const STALE_HEADER = "X-Bhb-Build-Stale";

export type StaleBuildLine = {
  event: "stale-build-write";
  clientBuild: string;
  serverBuild: string;
  method: string;
  path: string;
};

/**
 * True when `req` is a write to /api/* whose `X-Bhb-Build` names a build
 * other than this server's — and in that case logs one line. A missing or
 * malformed header, an unknown server build, a read, or a non-API path is
 * "nothing to say": false, nothing logged.
 */
export function noteStaleBuild(
  req: Request,
  serverBuild: string = serverBuildId(),
  log: (line: string) => void = (l) => console.log(l),
): boolean {
  const method = req.method.toUpperCase();
  if (!WRITE_METHODS.has(method)) return false;
  let path: string;
  try {
    path = new URL(req.url).pathname;
  } catch {
    return false;
  }
  if (!path.startsWith("/api/")) return false;
  const clientBuild = (req.headers.get(BUILD_HEADER) || "").trim();
  if (!BUILD_RE.test(clientBuild) || clientBuild === "unknown") return false;
  if (!serverBuild || serverBuild === "unknown") return false;
  if (clientBuild === serverBuild) return false;
  const line: StaleBuildLine = { event: "stale-build-write", clientBuild, serverBuild, method, path };
  try {
    log(JSON.stringify(line));
  } catch {
    /* logging must never fail the write */
  }
  return true;
}

/**
 * Wrap a route handler: run it exactly as before, and if the request came
 * from an older build, log it and mark the reply. The handler's status and
 * body are passed through untouched — this never answers in its place.
 */
export function withBuildCheck<A extends unknown[], R extends Response>(
  handler: (req: Request, ...rest: A) => Promise<R>,
): (req: Request, ...rest: A) => Promise<R> {
  return async (req: Request, ...rest: A) => {
    const stale = noteStaleBuild(req);
    const res = await handler(req, ...rest);
    if (stale) {
      try {
        res.headers.set(STALE_HEADER, "1");
      } catch {
        /* an immutable-header reply (e.g. Response.redirect) goes out as it is */
      }
    }
    return res;
  };
}
