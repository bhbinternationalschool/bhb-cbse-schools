/**
 * Run: npx tsx src/lib/clientMetricsSender.selftest.ts
 *
 * data-layer 1.2. The browser sender (lib/clientMetrics): timings sampled 1
 * in 5, failures always; sendBeacon first, fetch keepalive when the beacon
 * is refused, missing or throws; never throws, whatever breaks; a no-op
 * without `window`; held until the page knows its build, at most 15 s.
 * Also the page-ready rule (lib/pageReady) on shell-shaped trees.
 */
import assert from "node:assert/strict";
import { createClientMetricsSender, normaliseRoute, reportClientMetric, TIMING_SAMPLE_RATE } from "./clientMetrics";
import { pageContentReady, type ElementLike } from "./pageReady";

type Sent = { via: "beacon" | "fetch"; url: string; body: Record<string, unknown>; init?: RequestInit };

async function blobJson(b: unknown): Promise<Record<string, unknown>> {
  return JSON.parse(await (b as Blob).text()) as Record<string, unknown>;
}

void (async () => {
  assert.equal(TIMING_SAMPLE_RATE, 0.2, "timings are sampled 1 in 5");

  // ── sampling ────────────────────────────────────────────────────────────
  const beacons: unknown[] = [];
  let r = 0;
  const sampled = createClientMetricsSender({
    navigator: { sendBeacon: (_u, d) => (beacons.push(d), true) },
    random: () => r,
    pathname: () => "/students",
    build: () => "b1",
  });
  r = 0.19;
  assert.equal(sampled({ event: "page-ready", ms: 10 }), true, "random < 0.2 → sent");
  r = 0.2;
  assert.equal(sampled({ event: "page-ready", ms: 10 }), false, "random ≥ 0.2 → not sent");
  assert.equal(sampled({ event: "query", ms: 10 }), false);
  assert.equal(sampled({ event: "desk-hydrate", key: "sis", ms: 10 }), false);
  r = 0.99;
  assert.equal(sampled({ event: "query-error", key: "GET /api/x" }), true, "query-error is always sent");
  assert.equal(sampled({ event: "rendered-zero-rows", rows: 0 }), true, "rendered-zero-rows is always sent");
  assert.equal(beacons.length, 3);
  // Over many draws a real Math.random sends about one in five timings.
  let n = 0;
  const real = createClientMetricsSender({ navigator: { sendBeacon: () => true }, build: () => "b" });
  for (let i = 0; i < 20000; i++) if (real({ event: "query", ms: 1 })) n++;
  assert.ok(n > 3600 && n < 4400, `~20 % of timings sent (got ${n} of 20000)`);

  const first = await blobJson(beacons[0]);
  assert.deepEqual(first, { event: "page-ready", route: "/students", platform: "web", ms: 10, build: "b1" }, "the beacon body");
  assert.equal((beacons[0] as Blob).type, "text/plain;charset=utf-8", "sent as text/plain (a safelisted beacon type)");

  // ── transport: beacon, else fetch keepalive ────────────────────────────
  const sent: Sent[] = [];
  const fetchRec = async (url: string, init: RequestInit) => {
    sent.push({ via: "fetch", url, body: JSON.parse(String(init.body)), init });
    return new Response(null, { status: 204 });
  };
  const refused = createClientMetricsSender({ navigator: { sendBeacon: () => false }, fetch: fetchRec, random: () => 0, build: () => "b" });
  refused({ event: "query", route: "/x", ms: 5 });
  assert.equal(sent.length, 1, "a refused beacon falls back to fetch");
  assert.equal(sent[0].url, "/api/client-metrics");
  assert.equal(sent[0].init!.method, "POST");
  assert.equal(sent[0].init!.keepalive, true, "keepalive, so it survives the page closing");
  assert.equal(sent[0].init!.credentials, "same-origin", "with the session cookie");
  const noBeacon = createClientMetricsSender({ navigator: {}, fetch: fetchRec, random: () => 0, build: () => "b" });
  noBeacon({ event: "query", route: "/x", ms: 5 });
  assert.equal(sent.length, 2, "no sendBeacon → fetch");
  const throwingBeacon = createClientMetricsSender({
    navigator: { sendBeacon: () => {
      throw new Error("beacon broke");
    } },
    fetch: fetchRec,
    random: () => 0,
    build: () => "b",
  });
  throwingBeacon({ event: "query", route: "/x", ms: 5 });
  assert.equal(sent.length, 3, "a throwing beacon → fetch");

  // ── never throws ───────────────────────────────────────────────────────
  const hostile = [
    createClientMetricsSender({ navigator: { sendBeacon: () => { throw new Error("a"); } }, fetch: () => { throw new Error("b"); }, random: () => 0, build: () => "b" }),
    createClientMetricsSender({ navigator: null, fetch: () => Promise.reject(new Error("offline")), random: () => 0, build: () => "b" }),
    createClientMetricsSender({ navigator: null, fetch: null, random: () => { throw new Error("rng"); }, build: () => "b" }),
    createClientMetricsSender({ navigator: null, fetch: null, random: () => 0, build: () => { throw new Error("build"); } }),
    createClientMetricsSender({ navigator: null, fetch: null, random: () => 0, pathname: () => { throw new Error("path"); } }),
  ];
  for (const s of hostile) {
    assert.doesNotThrow(() => s({ event: "query", route: "/x", ms: 5 }));
    assert.doesNotThrow(() => s(null as never));
    assert.doesNotThrow(() => s({ event: "query-error", ms: Number.NaN, bytes: Infinity, rows: -1 }));
  }
  // An unhandled rejection from the fetch fallback would surface here.
  let unhandled = 0;
  process.on("unhandledRejection", () => unhandled++);
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(unhandled, 0, "a failed fetch fallback is swallowed, not left unhandled");

  // Bad numbers are dropped, not sent.
  sent.length = 0;
  noBeacon({ event: "query-error", route: "/x", ms: Number.NaN, bytes: -3, rows: Infinity });
  assert.deepEqual(sent[0].body, { event: "query-error", route: "/x", platform: "web", build: "b" });

  // ── no window: the exported reporter is a no-op ───────────────────────
  assert.equal(typeof (globalThis as { window?: unknown }).window, "undefined");
  const origFetch = globalThis.fetch;
  let touched = 0;
  globalThis.fetch = (async () => {
    touched++;
    return new Response(null);
  }) as typeof fetch;
  assert.doesNotThrow(() => reportClientMetric({ event: "query-error", route: "/x" }));
  globalThis.fetch = origFetch;
  assert.equal(touched, 0, "nothing is sent from the server or a test process");

  // ── held until the build is known, at most 15 s ───────────────────────
  sent.length = 0;
  let known: ((b: string) => void) | null = null;
  const timers: { fn: () => void; ms: number }[] = [];
  const waiting = createClientMetricsSender({
    navigator: null,
    fetch: fetchRec,
    random: () => 0,
    build: () => null,
    whenBuildKnown: (fn) => {
      known = fn;
      return () => {
        known = null;
      };
    },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
  });
  waiting({ event: "page-ready", route: "/home", key: "load", ms: 900 });
  waiting({ event: "desk-hydrate", route: "/home", key: "masters", ms: 700 });
  assert.equal(sent.length, 0, "held while the build is unknown");
  assert.equal(timers[0].ms, 15_000);
  known!("b-late");
  assert.equal(sent.length, 2, "sent once the build is known");
  assert.equal(sent[0].body.build, "b-late");
  timers[0].fn();
  assert.equal(sent.length, 2, "the timeout does not send them again");
  waiting({ event: "query-error", route: "/home" });
  timers[1].fn();
  assert.equal(sent.length, 3);
  assert.equal(sent[2].body.build, "unknown", "after 15 s it goes as unknown rather than never");

  // ── route normalising ──────────────────────────────────────────────────
  assert.equal(normaliseRoute("/students/stu_8f3a91c2/edit?tab=1"), "/students/:id/edit");
  assert.equal(normaliseRoute("/fees/receipts/12345"), "/fees/receipts/:id");
  assert.equal(normaliseRoute("/masters"), "/masters");
  assert.equal(normaliseRoute("/reports/2026-27"), "/reports/2026-27", "a session code is not an id");

  // ── page-ready rule ────────────────────────────────────────────────────
  const el = (role: string | null, kids: ElementLike[] = [], cls = ""): ElementLike & { cls: string; kids: ElementLike[] } => {
    const node = {
      cls,
      kids,
      get firstElementChild() {
        return kids[0] ?? null;
      },
      getAttribute: (n: string) => (n === "role" ? role : null),
      querySelector(sel: string): ElementLike | null {
        // Enough of a selector engine for "main .erp-module-root".
        const want = sel.split(" ").pop()!.replace(".", "");
        const walk = (k: ElementLike[]): ElementLike | null => {
          for (const c of k as (ElementLike & { cls: string; kids: ElementLike[] })[]) {
            if (c.cls === want) return c;
            const d = walk(c.kids);
            if (d) return d;
          }
          return null;
        };
        return walk(kids);
      },
    };
    return node;
  };
  const doc = (main: ElementLike | null) => el(null, main ? [main] : []);
  assert.equal(pageContentReady(null), false);
  assert.equal(pageContentReady(doc(null)), false, "no <main> yet (Loading workspace…)");
  assert.equal(pageContentReady(doc(el(null, [el("status")], "main"))), false, "CoreDataGate spinner");
  assert.equal(pageContentReady(doc(el(null, [el(null)], "main"))), false, "Checking access…");
  assert.equal(pageContentReady(doc(el(null, [el(null, [], "erp-module-root")], "main"))), false, "an empty module root");
  assert.equal(pageContentReady(doc(el(null, [el(null, [el("status")], "erp-module-root")], "main"))), false, "the route skeleton");
  assert.equal(pageContentReady(doc(el(null, [el(null, [el(null)], "erp-module-root")], "main"))), true, "the page itself");

  console.log("clientMetricsSender selftest: ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
