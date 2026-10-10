import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("sliceRevServer.selftest.ts");

/**
 * Server side of per-row versions (`_rev`) on the merged lists: the generic
 * slice desks, trust and transport merge with sliceRevMerge, write each
 * slice conditionally (casWriteSlice), accept `revs` from a browser and
 * answer with the new versions and any conflicts. The rule itself is
 * test:slice-rev-merge; this pins the wiring, by reading the code.
 */

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

// ── Generic slice desks ────────────────────────────────────────────────────
{
  const src = read("deskSliceNormalized.server.ts");
  assert.ok(/mergeWithRevs\(storedNow, incoming, \{ key: field, base: opts\?\.revs\?\.\[key\]/.test(src), "merge slices merge with versions");
  assert.ok(/casWriteSlice\(sb, slicesTable, tenantId, key,/.test(src), "each slice is written conditionally");
  assert.equal(/\.from\(slicesTable\)\.upsert\(/.test(src), false, "no unconditional slice upsert left");
  assert.ok(/return \{ ok: true, revs, conflicts \}/.test(src), "the save reports new versions and conflicts");
  const route = read("../app/api/school-data/desk-slice/[module]/route.ts");
  assert.ok(/readRevsParam\(body\.revs, def\.mergeSlices \?\? \[\]\)/.test(route), "the route reads revs for merge slices");
  assert.ok(/revs: result\.revs \?\? \{\},\s*conflicts: result\.conflicts \?\? \{\}/.test(route), "and answers with them");
}

// ── Trust ──────────────────────────────────────────────────────────────────
{
  const src = read("trustNormalized.server.ts");
  assert.ok(/mergeWithRevs\(storedNow, incoming, \{ base: opts\.revs\?\.\[key\] \}\)/.test(src));
  assert.ok(/casWriteSlice\(sb, "trust_desk_slices", tenantId, key,/.test(src));
  assert.equal(/from\("trust_desk_slices"\)\.upsert\(/.test(src), false);
  const route = read("../app/api/school-data/trust-desk/route.ts");
  assert.ok(/readRevsParam\(body\.revs, TRUST_SLICE_KEYS\)/.test(route) && /\}, \{ revs \}\);/.test(route));
  assert.ok(/revs: result\.revs \?\? \{\},\s*conflicts: result\.conflicts \?\? \{\}/.test(route));
}

// ── Transport ──────────────────────────────────────────────────────────────
{
  const src = read("transportNormalized.server.ts");
  assert.ok(/mergeWithRevs\(stored, incoming as unknown\[\], \{ base \}\)/.test(src));
  assert.ok(/mergeTransportSlice\(key, storedNow, payload, opts\.revs\?\.\[key\]\)/.test(src));
  // A driver's boarding tap versions the event it changes or adds.
  assert.ok(/_rev: rowRev\(e\) \+ 1,/.test(src), "a re-marked event gets a new version");
  assert.ok(/\[\{ \.\.\.event, _rev: 1 \}, \.\.\.existing\]/.test(src), "a new event starts at version 1");
  const route = read("../app/api/school-data/transport-desk/route.ts");
  assert.ok(/readRevsParam\(body\.revs, TRANSPORT_SLICE_KEYS\)/.test(route) && /\}, \{ revs \}\);/.test(route));
  assert.ok(/revs: result\.revs \?\? \{\},\s*conflicts: result\.conflicts \?\? \{\}/.test(route));
}

// ── Chat read receipts are combined, not refused ────────────────────────────
{
  const reg = read("deskSliceRegistry.ts");
  const count = (reg.match(/mergeUnion: \{ messages: \["readBy"\] \}/g) ?? []).length;
  assert.equal(count, 2, "ERP chat and staff chat messages combine readBy");
}

console.log("sliceRevServer.selftest: all assertions passed");
