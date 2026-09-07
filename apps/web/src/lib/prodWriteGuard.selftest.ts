/**
 * The guard that stops a laptop writing to the school's live books.
 *
 * On 2026-09-06 a local dev server pointed at the production Supabase project
 * emptied `fee_desk_voucher_lines` and `fee_desk_voucher_tenders` outright:
 * 1,913 lines over 435 receipts and 526 tenders, ₹20.8 lakh of collections
 * left with a guardian and an amount and no student, no fee head, no month.
 * The audit rows carry `ip: ::1` and `user_agent: curl/8.7.1` — the writes
 * never touched bhbinternational.school at all. Cloud Run logged no fee-desk
 * POST that day.
 *
 * These assertions are the shape of that mistake. If one starts failing,
 * a laptop can write to production again.
 *
 *   npm run -w web test:prod-write-guard
 */

import assert from "node:assert/strict";
import { shouldBeReadOnly } from "./supabase/server";

const PROD = "https://ymamhlcrjsuilzdonkzl.supabase.co";
const OTHER = "https://someotherproject.supabase.co";
const LOCAL = "http://127.0.0.1:54321";

// The case that actually happened: `next dev` on a laptop, prod URL in
// .env.local, nobody having asked for write access.
assert.equal(
  shouldBeReadOnly(PROD, { deployed: false, override: false }),
  true,
  "a dev process pointed at production must be read-only",
);

// The deployed app. Cloud Run runs `next start`, where NODE_ENV is production.
// If this ever returns true the school's own site stops being able to write.
assert.equal(
  shouldBeReadOnly(PROD, { deployed: true, override: false }),
  false,
  "the deployed app must keep full write access to production",
);

// A local Supabase, or any other project, is a developer's own sandbox.
for (const url of [LOCAL, OTHER]) {
  assert.equal(
    shouldBeReadOnly(url, { deployed: false, override: false }),
    false,
    `local dev against ${url} must not be restricted`,
  );
}

// The escape hatch has to work, or a genuine repair from a laptop becomes
// impossible and someone disables the guard instead.
assert.equal(
  shouldBeReadOnly(PROD, { deployed: false, override: true }),
  false,
  "ALLOW_LOCAL_PROD_WRITES=1 must lift the block",
);

// A test runner, a repair script, a `next start` on a laptop — none of them is
// the deployed app, and each is exactly as dangerous as a dev server. The
// guard keys on K_SERVICE (Cloud Run sets it; laptops do not) rather than on
// NODE_ENV, which `NODE_ENV=production npm run dev` defeats in one word.
assert.equal(
  shouldBeReadOnly(PROD, { deployed: false, override: false }),
  true,
  "any non-deployed process pointed at production must be read-only",
);

// The deployed app is never restricted, whatever else is set.
assert.equal(
  shouldBeReadOnly(PROD, { deployed: true, override: false }),
  false,
  "the deployed app keeps write access",
);

console.log("prod-write-guard selftest OK");
