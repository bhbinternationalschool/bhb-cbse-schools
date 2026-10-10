/**
 * Mark work that must finish before the server's reply is considered done.
 *
 * Isomorphic on purpose: persistence modules shared by the browser and the
 * server call this. In the browser (or before the server tracker is
 * installed) it does nothing and returns the promise unchanged. On the server,
 * lib/serverWorkTracker.server.ts installs the hook at start-up.
 *
 * WHY (2026-09-15)
 * Server code often starts a write without awaiting it — `void pushXRemoteServer(state)`
 * after a save, `after()` in the WhatsApp webhook. That only works while Cloud
 * Run keeps the CPU allocated after the response (`--no-cpu-throttling`,
 * billed for the whole life of an instance). With request-based billing — or
 * on any serverless host — CPU stops when the reply is sent, and unawaited
 * writes can be lost. The tracker holds the reply open until tracked work has
 * settled, so the cheaper billing mode is safe.
 */

type Tracker = (p: Promise<unknown>) => void;

export function trackServerWork<T>(p: T): T {
  const hook = (globalThis as { __bhbTrackServerWork?: Tracker }).__bhbTrackServerWork;
  // Anything not a promise (a sync function wrapped by the codemod) passes through.
  if (hook && p && typeof (p as { then?: unknown }).then === "function") hook(p as unknown as Promise<unknown>);
  return p;
}
