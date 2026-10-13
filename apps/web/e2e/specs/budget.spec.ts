/**
 * budget — what one page open costs the server and the wire.
 *
 * For each screen, as the office, from navigation until the page goes quiet
 * (no /api/* request started for QUIET_MS and none in flight; at least
 * MIN_WINDOW_MS, at most MAX_WINDOW_MS), every request to this app's /api/*
 * is counted and its ENCODED (on-the-wire, compressed) size summed from CDP
 * `Network.loadingFinished.encodedDataLength`. Static assets (/_next/static)
 * and anything not under /api/ are excluded.
 *
 * Budget per page open (COMMAND.md step 1.1): at most 8 /api requests, at
 * most 300 KB encoded in total, no single response over 150 KB (except an
 * explicit `?export=1`). KB = 1024 bytes.
 *
 * Today's numbers are far over budget; those pages are marked test.fail()
 * with the reason. Note: `next start` on the stack serves these JSON
 * responses without Content-Encoding, so here "encoded" equals the raw size;
 * a compressing proxy in production would send fewer bytes, not fewer rows. The measured numbers of every run go to the scoreboard
 * (metric "budget"), so the trend is visible run by run.
 */
import type { CDPSession, Page } from "@playwright/test";
import { APP_URL, expect, metric, note, test } from "../support";

const MAX_REQUESTS = 8;
const MAX_TOTAL_BYTES = 300 * 1024;
const MAX_RESPONSE_BYTES = 150 * 1024;
const QUIET_MS = 3_000;
const MIN_WINDOW_MS = 5_000;
const MAX_WINDOW_MS = 30_000;

const PAGES = ["/staff", "/students", "/masters", "/attendance", "/timetable", "/homework"] as const;

/**
 * Pages over budget on origin/main (13 Oct 2026), measured on this suite's
 * first runs (Mac and CI). The measured numbers of the current run are in
 * the annotation "measured" and in scoreboard.json.
 */
const BOOT = "every screen boots the whole replica on open — sis-roster ~893 KB (all 401 rows), staff-roster ~136 KB, masters-desk, rbac and ~20 small desk reads";
const KNOWN_OVER: Partial<Record<(typeof PAGES)[number], string>> = {
  "/staff": `33 requests, 1,101 KB on the Mac run: ${BOOT}. Until Phases 2–3.`,
  "/students": `32 requests, 1,102 KB on the Mac run: ${BOOT}. Until Phase 3.`,
  "/masters": `28 requests, 1,100 KB on the Mac run: ${BOOT}. Until Phase 2.`,
  "/attendance": `27 requests, 1,100 KB on the Mac run: ${BOOT}. Until Phases 2–3.`,
  "/timetable": `20 requests, 1,101 KB on the Mac run: ${BOOT}. Until Phase 2.`,
  "/homework": `26 requests, 1,099 KB on the Mac run: ${BOOT}. Until Phases 2–3.`,
};

type Req = { url: string; method: string; status?: number; bytes?: number; done: boolean; failed?: boolean; startedAt: number };

async function measureOpen(page: Page, path: string) {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  const reqs = new Map<string, Req>();
  const origin = new URL(APP_URL).origin;
  cdp.on("Network.requestWillBeSent", (e) => {
    let u: URL;
    try {
      u = new URL(e.request.url);
    } catch {
      return;
    }
    if (u.origin !== origin || !u.pathname.startsWith("/api/")) return;
    if (reqs.has(e.requestId)) return; // a redirect hop of the same request
    reqs.set(e.requestId, { url: u.pathname + u.search, method: e.request.method, done: false, startedAt: Date.now() });
  });
  cdp.on("Network.responseReceived", (e) => {
    const r = reqs.get(e.requestId);
    if (r) r.status = e.response.status;
  });
  cdp.on("Network.loadingFinished", (e) => {
    const r = reqs.get(e.requestId);
    if (r) {
      r.bytes = e.encodedDataLength;
      r.done = true;
    }
  });
  cdp.on("Network.loadingFailed", (e) => {
    const r = reqs.get(e.requestId);
    if (r) {
      r.done = true;
      r.failed = true;
      r.bytes = r.bytes ?? 0;
    }
  });

  const t0 = Date.now();
  await page.goto(path);
  for (;;) {
    const now = Date.now();
    const all = [...reqs.values()];
    const lastStart = all.reduce((m, r) => Math.max(m, r.startedAt), t0);
    const inFlight = all.filter((r) => !r.done).length;
    if (now - t0 >= MAX_WINDOW_MS) break;
    if (now - t0 >= MIN_WINDOW_MS && inFlight === 0 && now - lastStart >= QUIET_MS) break;
    await page.waitForTimeout(200);
  }
  const windowMs = Date.now() - t0;
  await cdp.detach().catch(() => undefined);

  const list = [...reqs.values()];
  const total = list.reduce((n, r) => n + (r.bytes ?? 0), 0);
  const counted = list.filter((r) => !/[?&]export=1\b/.test(r.url));
  const largest = counted.reduce<Req | null>((m, r) => (!m || (r.bytes ?? 0) > (m.bytes ?? 0) ? r : m), null);
  return {
    page: path,
    windowMs,
    requests: list.length,
    encodedBytes: total,
    encodedKB: Math.round(total / 102.4) / 10,
    largest: largest ? { url: largest.url, kb: Math.round((largest.bytes ?? 0) / 102.4) / 10 } : null,
    inFlightAtEnd: list.filter((r) => !r.done).length,
    calls: list
      .map((r) => ({ call: `${r.method} ${r.url}`, status: r.status ?? null, kb: Math.round((r.bytes ?? 0) / 102.4) / 10 }))
      .sort((a, b) => b.kb - a.kb),
  };
}

for (const path of PAGES) {
  test(`office ${path}: ≤ ${MAX_REQUESTS} /api requests, ≤ 300 KB encoded, no response > 150 KB`, async ({ page }, testInfo) => {
    const known = KNOWN_OVER[path];
    test.fail(!!known, known);
    const m = await measureOpen(page, path);
    await metric(testInfo, "budget", m);
    note(
      testInfo,
      "measured",
      `${m.requests} /api requests, ${m.encodedKB} KB encoded, largest ${m.largest ? `${m.largest.kb} KB ${m.largest.url}` : "—"} (window ${m.windowMs} ms)`,
    );
    expect.soft(m.requests, `${path}: /api requests on open`).toBeLessThanOrEqual(MAX_REQUESTS);
    expect.soft(m.encodedBytes, `${path}: encoded /api bytes on open`).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
    expect.soft(m.largest ? Math.round(m.largest.kb * 1024) : 0, `${path}: largest /api response (${m.largest?.url ?? "-"})`).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
  });
}
