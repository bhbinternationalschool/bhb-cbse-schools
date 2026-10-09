import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeSliceById } from "./sliceMergeById";

console.log("waThreadsTrustNoPrune.selftest.ts");

/**
 * Slice desks keep a whole collection per row, so their prune deleted whole
 * collections:
 *  - WhatsApp threads: a bundle without a slice deleted that slice (every SIS
 *    or CRM conversation), and a bundle with none wiped the table. Worse, a
 *    failed read came back as an empty bundle, was cached, and the next
 *    message's save replaced the stored slice with the one conversation in
 *    hand.
 *  - Trust: no guard at all — an empty push wiped the desk, and every save
 *    REPLACED each collection with the browser's copy. The seed wrote a demo
 *    project and a made-up contractor before the desk was pulled.
 * This reads the code itself, so none of it can quietly come back.
 */

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

// ── WhatsApp threads ───────────────────────────────────────────────────────
{
  const src = read("waThreadsNormalized.server.ts");
  assert.equal(/\.delete\(\)/.test(src), false, "no wa_desk_bot_slices row is ever deleted by a save");
  const fetchFn = src.slice(src.indexOf("export async function fetchWaThreadsDeskFromDb"));
  assert.ok(/sliceErr \|\| metaErr/.test(fetchFn), "a failed read is reported");
  assert.ok(/ok: false/.test(fetchFn) && /ok: true/.test(fetchFn), "fetch says whether it read the desk");

  const store = read("waBotStore.server.ts");
  assert.ok(/if \(readFailed\) \{[\s\S]*?deskUnreadable = true;\s*return emptyBundle\(\);/.test(store), "a failed read is not cached as an empty desk");
  const save = store.slice(store.indexOf("export async function saveWaBotSlice"));
  assert.ok(save.indexOf("if (deskUnreadable)") > 0 && save.indexOf("if (deskUnreadable)") < save.indexOf("pushWaThreadsSliceToDb"), "no slice is written over an unread desk");
}

// ── Trust ──────────────────────────────────────────────────────────────────
{
  const src = read("trustNormalized.server.ts");
  const push = src.slice(src.indexOf("export async function pushTrustDeskToDb"), src.indexOf("export async function fetchTrustDeskFromDb"));
  assert.equal(/\.delete\(\)/.test(push), false, "no trust slice is ever deleted by a save");
  assert.ok(/payload: mergeSliceById\(stored\.get\(key\), payload as unknown\[\]\)/.test(push), "collections are merged by id, not replaced");
  assert.ok(push.indexOf("if (readErr)") < push.indexOf('.from("trust_desk_slices").upsert('), "nothing is written when the stored desk cannot be read");
  const trust = read("trust.ts");
  const seed = trust.slice(trust.indexOf("export function seedTrustIfEmpty"));
  assert.ok(seed.indexOf("if (isSupabaseConfigured()) return state;") > 0 && seed.indexOf("if (isSupabaseConfigured()) return state;") < seed.indexOf("saveTrust("), "a live desk is never seeded with demo rows");
}

// ── mergeSliceById ─────────────────────────────────────────────────────────
{
  const stored = [{ id: "a", v: 1 }, { id: "b", v: 1 }, { id: "c", v: 1 }];
  // A stale copy holding only "a" (edited) keeps b and c.
  assert.deepEqual(mergeSliceById(stored, [{ id: "a", v: 2 }]), [{ id: "a", v: 2 }, { id: "b", v: 1 }, { id: "c", v: 1 }]);
  // A new row is added, nothing lost.
  assert.deepEqual(mergeSliceById(stored, [{ id: "d", v: 1 }]).map((r) => (r as { id: string }).id), ["d", "a", "b", "c"]);
  // Nothing stored yet.
  assert.deepEqual(mergeSliceById(undefined, [{ id: "a" }]), [{ id: "a" }]);
  // Stored rows without an id are not carried forward (they cannot be matched).
  assert.deepEqual(mergeSliceById([{ v: 9 }], [{ id: "a" }]), [{ id: "a" }]);
}

console.log("waThreadsTrustNoPrune.selftest: all assertions passed");
