import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

console.log("accountsSeedAfterPull.selftest.ts");

/**
 * seedAccountsIfEmpty builds a chart, three cash pools, categories, a trustee
 * and a fiscal year with fresh random ids and saves them, which pushes the
 * whole desk at once. The Accounts page called it before the school's desk
 * was pulled, so a fresh or cleared browser pushed a seeded desk first: with
 * the old prune that erased the real masters, and without it, it added a
 * second "Main Cash Box" beside the real one.
 *
 * The seed now neither seeds nor saves in a syncing browser until the desk
 * has actually been fetched from the server, and every caller that needs
 * pools awaits that fetch. This reads the code itself, so the order cannot
 * quietly come back.
 */

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const fnBody = (src: string, start: string) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `found ${start}`);
  const next = src.indexOf("\nexport ", i + start.length);
  return src.slice(i, next < 0 ? undefined : next);
};

// 1. The seed is gated on an "ever pulled" flag, not the 15s hydrate TTL.
const store = read("accountsStore.ts");
const allowed = fnBody(store, "export function accountsSeedAllowed");
assert.ok(/typeof window === "undefined"\) return true/.test(allowed), "server-side seeding is unchanged");
assert.ok(/accountsNormalizedSyncEnabled\(\)/.test(allowed), "gate applies when normalized sync is on");
assert.ok(/return accountsDeskPulled;/.test(allowed), "gate is the ever-pulled flag");
assert.equal(/isDeskHydrated/.test(allowed), false, "the 15s TTL is not an ever-hydrated flag");

const seed = fnBody(store, "export function seedAccountsIfEmpty");
const gate = seed.indexOf("if (!accountsSeedAllowed()) return loadAccounts();");
assert.ok(gate > 0, "seed returns a plain read before the desk is pulled");
assert.ok(gate < seed.indexOf("saveAccounts("), "the gate comes before any save");
assert.ok(gate < seed.indexOf("normalizePool("), "the gate comes before pools are built");

// 2. The flag is set only after a real fetch landed and was merged.
const persistence = read("accountsPersistence.ts");
const once = fnBody(persistence, "const hydrateAccountsOnce");
const merged = once.indexOf("mergeDbDeskIntoAccountsState(");
const marked = once.indexOf("if (fetched) markAccountsDeskPulled();");
assert.ok(merged > 0 && marked > merged, "flag set after the server desk is merged, and only if fetched");
assert.equal((persistence.match(/markAccountsDeskPulled\(\)/g) ?? []).length, 1, "flag set in exactly one place");

const client = read("accountsNormalizedClient.ts");
const hydrate = fnBody(client, "export async function hydrateAccountsDeskFromDb");
assert.ok(/const empty = \{[^}]*fetched: false/.test(hydrate), "a failed fetch reports fetched: false");
assert.ok(/if \(!remote\) return empty;/.test(hydrate), "no response → not fetched");

// 3. ensureAccountsSeeded pulls first, then seeds.
const seeded = fnBody(persistence, "export async function ensureAccountsSeeded");
const pull = seeded.indexOf("await ensureAccountsHydrated()");
assert.ok(pull > 0 && pull < seeded.indexOf("seedAccountsIfEmpty()"), "pull before seed");
assert.ok(/resetDeskHydrated\(MODULE\)/.test(seeded), "a failed pull inside the TTL is retried");

// 4. Callers that need pools await the pull.
const fees = read("fees.ts");
const run = fnBody(fees, "function runAccountsPosting").split("\nfunction ")[0];
assert.ok(run.indexOf("await p.ensureAccountsSeeded()") > 0, "fee postings await the pull");
assert.ok(run.indexOf("await p.ensureAccountsSeeded()") < run.indexOf("post(m)"), "…before posting");

const failures = read("accountsPostingFailures.ts");
const retry = fnBody(failures, "export async function retryAccountsPostingFailures");
assert.ok(retry.indexOf("await ensureAccountsSeeded()") > 0, "retry queue awaits the pull");
assert.ok(retry.indexOf("await ensureAccountsSeeded()") < retry.indexOf("postings.postFeeCollectionToAccounts"), "…before replaying");

const workspace = read("../components/accounts/AccountsWorkspace.tsx");
assert.ok(/withHydrationSlot\(\(\) => ensureAccountsSeeded\(\)\)/.test(workspace), "Accounts page pulls, then seeds");

const reports = read("../components/reports/ModuleReportRunners.tsx");
assert.equal(/seedAccountsIfEmpty/.test(reports), false, "reports runner seeds only via ensureAccountsSeeded");
assert.ok(/await ensureAccountsSeeded\(\)/.test(reports), "reports runner awaits the pull");

const trust = read("../components/trust/TrustWorkspace.tsx");
assert.ok(/ensureAccountsSeeded\(\)/.test(trust), "trust (capex postings) pulls the accounts desk");

console.log("accountsSeedAfterPull.selftest: all assertions passed");
