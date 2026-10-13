/**
 * Idle logout is decided across tabs (13 Oct 2026): a quiet background tab
 * must not sign out the tab the person is working in.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  idleRemainingMs,
  readSharedLastActivity,
  WORKSPACE_LAST_ACTIVITY_KEY,
  writeSharedLastActivity,
} from "./workspaceIdle";
import { WORKSPACE_INACTIVITY_MS } from "./workspaceSyncPolicy";

const MIN = 60_000;
const limitMs = 30 * MIN;
const now = 1_000 * MIN;

// The 13 Oct case: the Comms tab has been quiet for 30 minutes, but the
// Accounts tab saved a voucher 6 minutes ago. Not idle — 24 minutes left.
assert.equal(
  idleRemainingMs({ now, localLastActivity: now - 30 * MIN, sharedLastActivity: now - 6 * MIN, limitMs }),
  24 * MIN,
);

// Quiet everywhere for the whole period: log out.
assert.equal(
  idleRemainingMs({ now, localLastActivity: now - 31 * MIN, sharedLastActivity: now - 30 * MIN, limitMs }),
  0,
);

// No shared stamp (storage blocked): this tab's own activity decides, as before.
assert.equal(idleRemainingMs({ now, localLastActivity: now - 10 * MIN, sharedLastActivity: null, limitMs }), 20 * MIN);
assert.equal(idleRemainingMs({ now, localLastActivity: now - 40 * MIN, sharedLastActivity: null, limitMs }), 0);

// A stamp from the future never pushes logout past one full period from now.
assert.equal(
  idleRemainingMs({ now, localLastActivity: now - 40 * MIN, sharedLastActivity: now + 500 * MIN, limitMs }),
  limitMs,
);
assert.equal(
  idleRemainingMs({ now, localLastActivity: now - 40 * MIN, sharedLastActivity: Number.NaN, limitMs }),
  0,
);

// Storage helpers: round-trip, junk ignored, failures swallowed.
const mem = new Map<string, string>();
const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
writeSharedLastActivity(store, 12345);
assert.equal(mem.get(WORKSPACE_LAST_ACTIVITY_KEY), "12345");
assert.equal(readSharedLastActivity(store), 12345);
mem.set(WORKSPACE_LAST_ACTIVITY_KEY, "not a number");
assert.equal(readSharedLastActivity(store), null);
const broken = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("quota");
  },
};
assert.equal(readSharedLastActivity(broken), null);
writeSharedLastActivity(broken, 1); // must not throw
assert.equal(readSharedLastActivity(null), null);

// The hook decides through idleRemainingMs with the policy's period, and
// unhooks every listener it adds (the old visibilitychange one leaked).
const hook = readFileSync(join(__dirname, "../components/shell/useWorkspaceInactivityLogout.ts"), "utf8");
assert.ok(hook.includes("idleRemainingMs("), "the logout hook checks every tab's activity");
assert.ok(hook.includes("limitMs: WORKSPACE_INACTIVITY_MS"), "the period is the standing 30-minute policy");
assert.ok(hook.includes('removeEventListener("visibilitychange"'), "visibility listener is removed on unmount");
assert.ok(WORKSPACE_INACTIVITY_MS >= 30 * MIN);
// Waking a tab after the period has passed logs out instead of counting as
// activity (a stamp written on wake would rescue every other tab).
const vis = hook.slice(hook.indexOf("function onVisibility"), hook.indexOf("onActivity();\n    for"));
assert.ok(vis.includes("idleRemainingMs(") && vis.includes("logoutIdle()"), "visibility checks idleness before counting as activity");

console.log("workspaceIdle.selftest.ts: ok");
