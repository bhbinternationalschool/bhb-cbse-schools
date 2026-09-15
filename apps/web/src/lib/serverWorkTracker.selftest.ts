/**
 * Self-test: a reply is held until the work its request started — including
 * fire-and-forget writes — has finished; plain replies are not delayed; one
 * request's work never holds another; a hung task is released at the cap.
 * Run: npx tsx src/lib/serverWorkTracker.selftest.ts
 */

import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { trackServerWork } from "./serverWork";
import { installServerWorkTracker } from "./serverWorkTracker.server";

console.log("serverWorkTracker.selftest.ts");

const CAP = 1500;
installServerWorkTracker({ capMs: CAP });
installServerWorkTracker({ capMs: 99 }); // idempotent: second install is a no-op

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function listen(handler: http.RequestListener): Promise<{ url: string; close: () => void }> {
  const server = http.createServer(handler);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    }),
  );
}

async function timed(url: string): Promise<{ ms: number; body: string }> {
  const t0 = Date.now();
  // Outside any request context, so the test's own fetch is not tracked.
  const r = await fetch(url);
  const body = await r.text();
  return { ms: Date.now() - t0, body };
}

async function main() {
  const upstream = await listen(async (_req, res) => {
    await sleep(300);
    res.end(JSON.stringify({ saved: true }));
  });

  const marks: Record<string, number> = {};

  const app = await listen((req, res) => {
    const path = req.url || "/";
    if (path === "/plain") {
      res.end("plain");
      return;
    }
    if (path === "/fire-and-forget") {
      // Exactly the shape of `trackServerWork(pushXRemoteServer(state))`: an
      // await before the first fetch, then the write, then reading its body.
      void trackServerWork((async () => {
        await Promise.resolve();
        await sleep(5);
        const r = await fetch(upstream.url);
        await r.json();
        marks.write = Date.now();
      })());
      res.end("ok");
      return;
    }
    if (path === "/untracked-late") {
      // NOT covered, by design: nothing tracked has started when the reply is
      // sent, so the tracker cannot know about it. This is why every
      // fire-and-forget chain in server code is wrapped in trackServerWork.
      void (async () => {
        await sleep(30);
        await fetch(upstream.url);
        marks.late = Date.now();
      })();
      res.end("ok");
      return;
    }
    if (path === "/chained") {
      // Automatic: the first write starts synchronously, so the chain is seen.
      void (async () => {
        const a = await fetch(upstream.url);
        await a.text();
        await sleep(4); // small gap between two writes
        const b = await fetch(upstream.url);
        await b.text();
        marks.chain = Date.now();
      })();
      res.end("ok");
      return;
    }
    if (path === "/explicit") {
      void trackServerWork(sleep(250).then(() => (marks.explicit = Date.now())));
      res.end("ok");
      return;
    }
    if (path === "/hung") {
      void fetch(upstream.url); // counts as started work
      void trackServerWork(new Promise(() => undefined)); // never settles
      res.end("ok");
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  // Plain reply: no delay.
  const plain = await timed(`${app.url}/plain`);
  assert.equal(plain.body, "plain");
  assert.ok(plain.ms < 100, `plain reply not delayed (${plain.ms} ms)`);

  // Fire-and-forget write finishes before the reply completes.
  const ff = await timed(`${app.url}/fire-and-forget`);
  const ffDone = Date.now();
  assert.equal(ff.body, "ok");
  assert.ok(marks.write && marks.write <= ffDone, "the write finished before the reply was released");
  assert.ok(ff.ms >= 290, `reply held for the write (${ff.ms} ms)`);

  // Documented limit: late-starting untracked work is not held.
  const late = await timed(`${app.url}/untracked-late`);
  assert.ok(late.ms < 100, `untracked late work is not held (${late.ms} ms)`);
  await sleep(400);

  // Two writes in a row, with a gap between them: both finish first.
  const ch = await timed(`${app.url}/chained`);
  assert.ok(marks.chain && marks.chain <= Date.now(), "both chained writes finished");
  assert.ok(ch.ms >= 590, `held across the gap between writes (${ch.ms} ms)`);

  // Explicitly tracked non-fetch work.
  const ex = await timed(`${app.url}/explicit`);
  assert.ok(marks.explicit, "explicit work finished");
  assert.ok(ex.ms >= 240, `held for explicit work (${ex.ms} ms)`);

  // Concurrent: a plain request is not held by another request's slow work.
  const [slow, quick] = await Promise.all([timed(`${app.url}/fire-and-forget`), (async () => { await sleep(20); return timed(`${app.url}/plain`); })()]);
  assert.ok(slow.ms >= 290);
  assert.ok(quick.ms < 100, `another request's work does not hold this reply (${quick.ms} ms)`);

  // Hung work is released at the cap, not forever.
  const hung = await timed(`${app.url}/hung`);
  assert.ok(hung.ms >= CAP - 50 && hung.ms < CAP + 800, `released at the cap (${hung.ms} ms)`);

  // Outside a request, trackServerWork is a pass-through.
  assert.equal(await trackServerWork(Promise.resolve(7)), 7);

  app.close();
  upstream.close();
  console.log("  ok");
  process.exit(0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
