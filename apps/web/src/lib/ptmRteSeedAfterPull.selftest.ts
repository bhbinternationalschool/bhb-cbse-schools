import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("ptmRteSeedAfterPull.selftest.ts");

/**
 * The PTM and RTE workspaces seeded an empty BROWSER before pulling the
 * desk, and the seed's save pushed at once:
 *  - PTM made up a "Term PTM" dated today with five slots in "Room 12" —
 *    while the desk pruned, that deleted every real event (bookings and
 *    feedback cascading); after it, it adds a fake event parents can book.
 *    It is a sample, not a default: a live desk is never seeded with it.
 *  - RTE minted quota seats for every class with fresh ids — deleting every
 *    stored seat while the desk pruned, duplicating them after. Seats derived
 *    from class strength are a legitimate default, so the seed waits until
 *    the desk has really been pulled (not isDeskHydrated: a 15 s TTL, set
 *    after a failed pull too) and is still empty.
 * Same rule as accounts (test:accounts-seed-after-pull). Reads the code.
 */

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

// ── PTM ────────────────────────────────────────────────────────────────────
{
  const src = read("ptm.ts");
  const seed = src.slice(src.indexOf("export function seedPtmIfEmpty"));
  const gate = seed.indexOf("if (isSupabaseConfigured()) return existing;");
  assert.ok(gate > 0, "a live PTM desk is never seeded with the sample event");
  assert.ok(gate < seed.indexOf("savePtm("), "before anything is saved");
}

// ── RTE ────────────────────────────────────────────────────────────────────
{
  const src = read("rteEws.ts");
  const seed = src.slice(src.indexOf("export function seedRteIfEmpty"));
  const gate = seed.indexOf("isSupabaseConfigured() && !rteDeskPulled");
  assert.ok(gate > 0, "the RTE seed waits for the desk to be pulled");
  assert.ok(gate < seed.indexOf("seedQuotaSeatsFromStrength("), "before seats are minted");

  const persist = read("rtePersistence.ts");
  const hydrate = persist.slice(persist.indexOf("export async function ensureRteHydrated"));
  const failed = hydrate.indexOf("if (!ok) {");
  const pulled = hydrate.indexOf("markRteDeskPulled();");
  assert.ok(failed > 0 && pulled > failed, "the pull is marked only after a successful read");
  assert.ok(hydrate.slice(failed, pulled).includes("return"), "a failed read returns before marking");
}

console.log("ptmRteSeedAfterPull.selftest: all assertions passed");
