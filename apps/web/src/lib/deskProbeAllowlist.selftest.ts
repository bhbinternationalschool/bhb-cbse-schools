/**
 * Run: npx tsx src/lib/deskProbeAllowlist.selftest.ts
 *
 * Every table the code hands to desk_probe must be in the SQL function's
 * allowlist (the newest migration that defines it). Otherwise the probe
 * raises, fails open, and the cache it guards silently stops working — as
 * transport_desk_slices did from 16 Sep to 9 Oct 2026.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..", "..", "..");
const migDir = join(root, "supabase", "migrations");
const defining = readdirSync(migDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => /create or replace function public\.desk_probe/i.test(readFileSync(join(migDir, f), "utf8")));
assert.ok(defining.length > 0, "a migration defines desk_probe");
const latest = readFileSync(join(migDir, defining[defining.length - 1]), "utf8");
const allowBlock = latest.match(/allowed constant text\[\] := array\[([\s\S]*?)\];/);
assert.ok(allowBlock, "allowlist found");
const allowed = new Set([...allowBlock![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

const src = join(root, "apps", "web", "src");
const used = new Map<string, string>();
// The school-mirror pre-pull probe.
const mirror = readFileSync(join(src, "lib", "schoolMirrorRemote.server.ts"), "utf8");
const mirrorList = mirror.match(/MIRROR_PROBE_TABLES = \[([\s\S]*?)\];/);
assert.ok(mirrorList, "MIRROR_PROBE_TABLES found");
for (const m of mirrorList![1].matchAll(/"([a-z_]+)"/g)) used.set(m[1], "schoolMirrorRemote");
// Every cachedDeskJson route's `tables: [...]`.
const routes = join(src, "app", "api", "school-data");
for (const dir of readdirSync(routes)) {
  let text = "";
  try {
    text = readFileSync(join(routes, dir, "route.ts"), "utf8");
  } catch {
    continue;
  }
  for (const block of text.matchAll(/tables:\s*\[([^\]]*)\]/g)) {
    for (const m of block[1].matchAll(/"([a-z_]+)"/g)) used.set(m[1], `school-data/${dir}`);
  }
}
assert.ok(used.size > 10, "found the probed tables");
const missing = [...used].filter(([t]) => !allowed.has(t));
assert.deepEqual(missing, [], `tables probed but not allowlisted in ${defining[defining.length - 1]}: ${missing.map(([t, w]) => `${t} (${w})`).join(", ")}`);
console.log("deskProbeAllowlist selftest: ok");
