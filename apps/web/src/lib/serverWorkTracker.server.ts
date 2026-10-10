/**
 * Holds every HTTP response open until the work its request started has
 * finished — database writes, WhatsApp sends, AI calls — so nothing is lost
 * when the host stops the CPU at the reply. See lib/serverWork.ts for why.
 *
 * HOW
 *  1. Each incoming request runs inside an AsyncLocalStorage context. Promises,
 *     timers and callbacks created while handling it — including fire-and-forget
 *     `void push()` chains — inherit that context.
 *  2. `fetch` is wrapped: every call made inside a request context (the
 *     Supabase client, Meta's Graph API, Gemini, Cashfree all use it) is
 *     registered as pending work for that request, and so is reading its body.
 *     `trackServerWork(p)` registers anything else explicitly.
 *  3. `res.end` is wrapped: if the request started tracked work, the real end
 *     is called only once nothing is pending and nothing new started during a
 *     short settle pause — or after HOLD_CAP_MS, whichever comes first.
 *
 * A request that started no tracked work ends exactly as before, with no
 * added delay. Work from one request never holds another request's reply.
 *
 * Installed once from instrumentation.ts (Node runtime only).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import http from "node:http";

type Ctx = {
  pending: Set<Promise<unknown>>;
  started: number;
};

/** A reply is never held longer than this; WhatsApp waits ~20 s before re-delivering. */
export const HOLD_CAP_MS = 25_000;
/** Quiet time with nothing pending before the reply is released. */
export const SETTLE_MS = 12;

const als = new AsyncLocalStorage<Ctx>();
const INSTALLED = Symbol.for("bhb.serverWorkTracker.installed");

function track(p: Promise<unknown>): void {
  const ctx = als.getStore();
  if (!ctx) return;
  const settled = p.then(
    () => undefined,
    () => undefined,
  );
  ctx.pending.add(settled);
  ctx.started += 1;
  void settled.then(() => ctx.pending.delete(settled));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function settle(ctx: Ctx, capMs: number): Promise<void> {
  const deadline = Date.now() + capMs;
  while (Date.now() < deadline) {
    if (ctx.pending.size > 0) {
      const left = deadline - Date.now();
      await Promise.race([Promise.all([...ctx.pending]), sleep(left)]);
      continue;
    }
    const seen = ctx.started;
    await sleep(SETTLE_MS);
    if (ctx.pending.size === 0 && ctx.started === seen) return;
  }
  console.warn(`[serverWork] reply released after ${capMs} ms with ${ctx.pending.size} task(s) still running`);
}

const BODY_METHODS = ["json", "text", "arrayBuffer", "blob", "formData"] as const;

export function installServerWorkTracker(opts: { capMs?: number } = {}): void {
  const g = globalThis as Record<symbol | string, unknown>;
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;
  const capMs = opts.capMs ?? HOLD_CAP_MS;

  g.__bhbTrackServerWork = track;

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === "function") {
    const trackedFetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      const p = originalFetch.apply(this, args);
      if (!als.getStore()) return p;
      const withBody = p.then((res) => {
        for (const m of BODY_METHODS) {
          const fn = (res as unknown as Record<string, unknown>)[m];
          if (typeof fn !== "function") continue;
          Object.defineProperty(res, m, {
            configurable: true,
            value: (...a: unknown[]) => {
              const r = (fn as (...x: unknown[]) => Promise<unknown>).apply(res, a);
              track(r);
              return r;
            },
          });
        }
        return res;
      });
      track(withBody);
      return withBody;
    };
    // Deliberately NOT copying properties from the original: Next.js marks its
    // own patched fetch (__nextPatched) and skips patching a fetch that carries
    // the mark. Copying it made Next skip its fetch instrumentation and broke
    // prerendering ("Expected workUnitAsyncStorage to have a store").
    globalThis.fetch = trackedFetch as typeof fetch;
  }

  const originalEmit = http.Server.prototype.emit as (this: http.Server, event: string | symbol, ...args: unknown[]) => boolean;
  http.Server.prototype.emit = function (this: http.Server, event: string | symbol, ...args: unknown[]) {
    if (event !== "request") return originalEmit.call(this, event, ...args);
    const res = args[1] as http.ServerResponse;
    const ctx: Ctx = { pending: new Set(), started: 0 };
    const originalEnd = res.end;
    let ending = false;
    res.end = function (this: http.ServerResponse, ...endArgs: unknown[]) {
      if (ending || ctx.started === 0) {
        return (originalEnd as (...a: unknown[]) => http.ServerResponse).apply(this, endArgs);
      }
      ending = true;
      void settle(ctx, capMs).then(() => {
        (originalEnd as (...a: unknown[]) => http.ServerResponse).apply(res, endArgs);
      });
      return this;
    } as typeof res.end;
    return als.run(ctx, () => originalEmit.call(this, event, ...args));
  } as typeof http.Server.prototype.emit;

  console.log(`[serverWork] tracker installed — replies wait for their work (cap ${capMs} ms)`);
}
