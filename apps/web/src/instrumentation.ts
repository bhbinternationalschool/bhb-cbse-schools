/**
 * Runs once when the server starts. Node runtime only — middleware runs on the
 * edge runtime and has no http server to hold.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installServerWorkTracker } = await import("@/lib/serverWorkTracker.server");
    installServerWorkTracker();
  }
}
