/**
 * Runs once when the server starts. Node runtime only — middleware runs on the
 * edge runtime and has no http server to hold.
 */
export async function register() {
  // Not during `next build`: prerendering serves no live requests to hold.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { installServerWorkTracker } = await import("@/lib/serverWorkTracker.server");
    installServerWorkTracker();
  }
}
