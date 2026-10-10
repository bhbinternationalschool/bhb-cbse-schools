import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mergeSliceById } from "./sliceMergeById";
import { isTrustDemoRow, withoutTrustDemo } from "./trustDemoSeed";

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
  assert.ok(/mergeWithRevs\(storedNow, incoming, \{ base: opts\.revs\?\.\[key\] \}\)/.test(push), "collections are merged by id (with per-row versions), not replaced");
  assert.ok(push.indexOf("if (readErr)") < push.indexOf("casWriteSlice("), "nothing is written when the stored desk cannot be read");
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

// ── The trust demo seed is refused and cleared ─────────────────────────────
{
  const push = read("trustNormalized.server.ts");
  assert.ok(/value: withoutTrustDemo\(key, m\.rows\)/.test(push), "demo rows are dropped from every written slice");
  assert.ok(/withoutTrustDemo\(key, kept\)\.length !== kept\.length\) toWrite\.push\(key\)/.test(push), "and from stored slices the push did not carry");

  // Exactly the rows seedTrustIfEmpty wrote…
  assert.ok(isTrustDemoRow("projects", { id: "prj_x", code: "CAP/25-26/001", name: "New Primary Wing — Block B", note: "Demo seed project" }));
  assert.ok(isTrustDemoRow("workItems", { id: "wrk_x", code: "WRK-01", name: "Classroom flooring — GF", qtyPlanned: 2500 }));
  assert.ok(isTrustDemoRow("contractors", { id: "con_x", name: "Sharma Civil Contractors", gstin: "09AABCS1234A1Z5" }));
  assert.ok(isTrustDemoRow("rateCard", { id: "rc_x", workName: "Electrical point", ratePaise: 45000, locality: "Lucknow" }));
  // …and nothing that merely resembles them.
  assert.equal(isTrustDemoRow("projects", { code: "CAP/25-26/001", name: "New Primary Wing — Block B", note: "" }), false);
  assert.equal(isTrustDemoRow("workItems", { code: "WRK-01", name: "Classroom flooring — GF", qtyPlanned: 1800 }), false);
  assert.equal(isTrustDemoRow("contractors", { name: "Sharma Civil Contractors", gstin: "09AAACS9999Z1Z1" }), false);
  assert.equal(isTrustDemoRow("rateCard", { workName: "Electrical point", ratePaise: 45000, locality: "Varanasi" }), false);
  assert.equal(isTrustDemoRow("raBills", { name: "Sharma Civil Contractors", gstin: "09AABCS1234A1Z5" }), false);
  assert.deepEqual(
    withoutTrustDemo("contractors", [{ id: "a", name: "Real Builders" }, { id: "b", name: "Sharma Civil Contractors", gstin: "09AABCS1234A1Z5" }]),
    [{ id: "a", name: "Real Builders" }],
  );
}

console.log("waThreadsTrustNoPrune.selftest: all assertions passed");
