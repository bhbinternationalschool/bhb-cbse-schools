import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("mastersTransportNoPrune.selftest.ts");

/**
 * Masters and transport keep a whole collection per slice row, and each save
 * deleted every slice it lacked.
 *
 *  - Masters: a push missing a key (or sending none) erased that master. Its
 *    UI really does delete items, and the route's revision lock keeps stale
 *    copies out, so a slice the push CARRIES is written as sent — an empty
 *    list included — and a slice it does not carry is left alone.
 *  - Transport: four slices were protected after the 2026-08-21 wipe; the
 *    rest (boarding log, GPS pings, fuel, loans, insurance…) were not, and
 *    every save also overwrote each list with the browser's copy — including
 *    the boarding log drivers' phones append on the server. Nothing in the
 *    transport UI deletes a row, so a save now merges by id.
 *
 * This reads the push code itself, so neither can quietly come back.
 */

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");
const pushOf = (src: string, fn: string, next: string) =>
  src.slice(src.indexOf(`export async function ${fn}`), src.indexOf(`export async function ${next}`));

// ── Masters ────────────────────────────────────────────────────────────────
{
  const src = read("mastersNormalized.server.ts");
  const push = pushOf(src, "pushMastersDeskToDb", "fetchMastersDeskFromDb");
  assert.ok(push.length > 500, "found the masters push");
  assert.equal(/\.delete\(\)/.test(push), false, "no masters slice is deleted by a save");
  // A carried empty list is written (a real edit); an absent key is skipped.
  assert.ok(/return Array\.isArray\(payload\);/.test(push), "carried arrays are written, empty included");
  assert.equal(/payload\.length > 0/.test(push.slice(0, push.indexOf(".upsert(rows)"))), false, "empty is not treated as absent");
  assert.ok(/if \(rows\.length === 0\) \{\s*return \{ ok: false/.test(push), "a push carrying nothing writes nothing");

  const ops = read("deskOpsLoad.server.ts");
  assert.ok(/if \(readFailed\) throw/.test(ops), "an unread masters desk is not handed out as empty");
}

// ── Transport ──────────────────────────────────────────────────────────────
{
  const src = read("transportNormalized.server.ts");
  const push = pushOf(src, "pushTransportDeskToDb", "fetchTransportDeskFromDb");
  assert.ok(push.length > 500, "found the transport push");
  assert.equal(/\.delete\(\)/.test(push), false, "no transport slice is deleted by a save");
  // The per-slice merge lives in mergeTransportSlice (pure, so the
  // conditional write can re-apply it to a fresher copy — test:slice-cas).
  const merge = pushOf(src.replace("function mergeTransportSlice", "export async function mergeTransportSlice"), "mergeTransportSlice", "pushTransportDeskToDb");
  assert.ok(/mergeWithRevs\(stored, incoming as unknown\[\], \{ base \}\)/.test(merge), "lists are merged by id (with per-row versions), not replaced");
  assert.ok(/key === "gpsPings"[\s\S]*?\.slice\(0, 500\)/.test(merge), "GPS pings stay a 500-ping rolling buffer");
  assert.ok(/mergeTransportSlice\(key, storedNow, payload, opts\.revs\?\.\[key\]\)/.test(push), "the save writes through that merge");
  assert.ok(push.indexOf("if (readErr)") < push.indexOf("casWriteSlice("), "nothing is written when the stored desk cannot be read");
}

console.log("mastersTransportNoPrune.selftest: all assertions passed");
