/**
 * Which build this page is running, as the browser knows it (data-layer 1.2).
 *
 * WHY NOT `NEXT_PUBLIC_BUILD_ID` FROM `generateBuildId`: the deploy cannot give
 * `next build` a stable id. APP_COMMIT_SHA reaches the service only at run
 * time (cloudbuild.yaml --set-env-vars), not the Docker build, and a hand
 * deploy of a working tree can ship different code under one commit — so a
 * commit-based id could hide a real deploy from the update bar. A random id
 * made in next.config.ts would have to be identical in every process
 * `next build` starts (the webpack build workers load the config again), or
 * the inlined id and .next/BUILD_ID disagree and every tab looks stale
 * forever. Neither risk is worth taking for one string.
 *
 * So the page uses the answer it already gets: the update bar asks
 * GET /api/app-version when the page opens and keeps the FIRST answer as
 * "the build this page was loaded with" (components/pwa/UpdateBar.tsx). It
 * hands that same answer here. The stale-build check on the server compares
 * against the same function /api/app-version serves (lib/serverBuild.server),
 * so the id the client sends and the id the update bar compares are one
 * value by construction.
 *
 * Unknown until that first answer lands (null): callers send no header then,
 * and the server treats a missing header as "nothing to say", never stale.
 */

let loaded: string | null = null;
const waiting = new Set<(build: string) => void>();

/** The build this page was loaded with, or null until the first answer. */
export function clientBuildId(): string | null {
  return loaded;
}

/**
 * Record the first build id this page heard. Later calls are ignored: a
 * different later answer means a deploy happened, and THIS page is still
 * the old build.
 */
export function noteLoadedBuild(build: string): void {
  if (loaded !== null) return;
  if (!build || build === "unknown") return;
  loaded = build;
  for (const fn of [...waiting]) {
    waiting.delete(fn);
    try {
      fn(build);
    } catch {
      /* a listener must not stop the others */
    }
  }
}

/** Run `fn` once the build is known (at once if it already is). Returns an unsubscribe. */
export function onClientBuildKnown(fn: (build: string) => void): () => void {
  if (loaded !== null) {
    fn(loaded);
    return () => {};
  }
  waiting.add(fn);
  return () => {
    waiting.delete(fn);
  };
}

/** Tests only: forget the recorded build. */
export function resetClientBuildForTests(): void {
  loaded = null;
  waiting.clear();
}
