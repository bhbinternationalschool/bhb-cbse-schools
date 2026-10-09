import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("mastersRevisionEverywhere.selftest.ts");

/**
 * Masters had an optimistic revision lock in its route — with two holes:
 *  - a push with NO revision was accepted as a "legacy client". A browser that
 *    never loaded masters sends exactly that (its base is null), so the
 *    empty, un-pulled copy every other guard exists to stop walked through;
 *  - every writer other than the route (the mirror push, the ops loader, the
 *    cutover) called pushMastersDeskToDb with no revision at all.
 * Now the writer itself takes the revision, refuses unversioned and stale
 * writes against a desk that has one, and claims the next revision with a
 * conditional update so two saves from one base cannot both land. This reads
 * the code itself.
 */

const read = (f: string) => readFileSync(join(__dirname, f), "utf8");

// ── The writer ─────────────────────────────────────────────────────────────
{
  const src = read("mastersNormalized.server.ts");
  const push = src.slice(src.indexOf("export async function pushMastersDeskToDb"), src.indexOf("export async function fetchMastersDeskFromDb"));
  assert.ok(/opts: \{ baseUpdatedAt: string \| null \}/.test(push), "every caller must pass a revision (or null)");
  assert.ok(/conflict: "unversioned"/.test(push) && /conflict: "stale"/.test(push), "unversioned and stale writes are refused");
  const claim = push.indexOf('.eq("updated_at", storedRev)');
  assert.ok(claim > 0, "the new revision is claimed only if nobody moved it");
  assert.ok(claim < push.indexOf('.from("masters_desk_slices").upsert('), "claimed before any slice is written");
  assert.ok(push.indexOf("if (metaErr)") < claim, "an unreadable revision writes nothing");
}

// ── The route ──────────────────────────────────────────────────────────────
{
  const route = read("../app/api/school-data/masters-desk/route.ts");
  assert.equal(/unversioned push accepted/.test(route), false, "no more 'legacy client' pass");
  assert.ok(/revision\.reason === "unversioned" && meta && !featureGate[\s\S]*?status: 409/.test(route), "an unversioned browser push gets 409");
  assert.ok(/pushMastersDeskToDb\(state, \{\s*baseUpdatedAt: featureGate/.test(route), "the route passes the revision to the writer");
  assert.ok(/if \(pushed\.conflict\)[\s\S]*?status: 409/.test(route), "a writer conflict is a 409, not a 500");
}

// ── Every other writer passes a revision; the server copies can only bootstrap
{
  assert.ok(/pushMastersDeskToDb\(state, \{ baseUpdatedAt \}\)/.test(read("deskOpsLoad.server.ts")));
  assert.ok(/pushMastersDeskToDb\(emptyMastersShell\(\), \{[\s\S]*?baseUpdatedAt: null/.test(read("ensureDeskCutover.server.ts")));
  assert.ok(/pushMastersDeskToDb\(state, \{ baseUpdatedAt: null \}\)/.test(read("mastersPersistence.ts")));
}

// ── The browser rehydrates on "unversioned" like on "stale" ─────────────────
{
  const client = read("mastersNormalizedClient.ts");
  assert.ok(/body\?\.reason === "unversioned" \|\|/.test(client), "an unversioned refusal rehydrates");
}

console.log("mastersRevisionEverywhere.selftest: all assertions passed");
