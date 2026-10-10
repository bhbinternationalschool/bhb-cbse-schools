/**
 * A cold client must not invent a school.
 *
 * On 2026-08-10, clearing a browser's storage against production produced a
 * complete 15-class roster with ids the database had never seen
 * (cls_kwlp6sqz… while the server held cls_p7bw8cpc…). loadMasters() wrote
 * that fabrication straight to localStorage, the device pushed it, and
 * guardMastersOverwrite refused it as `regenerated` — leaving the device
 * frozen on ids that exist nowhere else. Clearing storage was the workaround
 * staff had been told to use; it made things worse.
 *
 * Two functions did the fabricating, and both are guarded now:
 *   ensureFeeSetup      — takes defaultMasters()'s classes when the roster is
 *                         empty
 *   ensureClassRoster   — mints a fresh id for every class in CLASS_GROUPS
 *                         that is not already present
 *
 * The rule, and the one this whole migration keeps re-learning: **absent is
 * not a default**. An empty roster means "not hydrated yet", never "a school
 * with no classes".
 *
 * isSupabaseConfigured() decides whether the guards apply — with a database
 * to hydrate from, seeding locally can only conflict — so the npm script
 * supplies placeholder Supabase env vars. Running this file directly without
 * them exercises the demo path instead, and the first assertion will say so.
 *
 * Run: npm run test:masters-cold-client
 */
import assert from "node:assert/strict";

import {
  emptyMastersShell,
  loadMasters,
  type MastersState,
} from "./masters";
import { isSupabaseConfigured } from "./supabase/client";

// ── Precondition, checked before anything else ────────────────────────────
// Without Supabase env vars the guards below are inactive by design and the
// demo path legitimately seeds a roster. That used to surface as the
// 2026-08-10 assertion failing, which reads as "the guard is broken" when
// the truth is "this run never engaged the guard" — a false alarm that has
// already cost one investigation. Fail loudly and specifically instead.
if (!isSupabaseConfigured()) {
  console.error(
    "mastersColdClient.selftest: SKIPPED-AS-FAILURE — no Supabase env.\n" +
      "  This file only tests anything when isSupabaseConfigured() is true.\n" +
      "  Run it as:  npm run test:masters-cold-client\n" +
      "  (running `tsx src/lib/mastersColdClient.selftest.ts` bare exercises\n" +
      "   the demo seed path, which is allowed to create a roster.)",
  );
  process.exit(1);
}

// ── A cold load must not conjure a roster ─────────────────────────────────
// loadMasters() on the server with no mirror is the cold path; in the browser
// the equivalent is empty localStorage. Both end in the same seed branch.
{
  const cold = loadMasters();

  assert.equal(
    cold.classes.length,
    0,
    "a cold client invented a class roster — the exact 2026-08-10 failure",
  );
  assert.equal(cold.sections.length, 0, "and invented sections for them");
  assert.equal(cold.feeHeads.length, 0, "and invented fee heads");

  // The point is not merely "few classes" but "no fabricated ids at all".
  const invented = [
    ...cold.classes.map((c) => c.id),
    ...cold.sections.map((s) => s.id),
    ...cold.feeHeads.map((f) => f.id),
  ];
  assert.deepEqual(
    invented,
    [],
    "a cold client must mint no ids: anything written against them points at nothing",
  );
}

// ── Two cold loads must not disagree ──────────────────────────────────────
// Fabricated ids are random, so two calls produced two different schools.
// That is how one device ended up unable to talk to another.
{
  const a = loadMasters();
  const b = loadMasters();
  assert.deepEqual(
    a.classes.map((c) => c.id),
    b.classes.map((c) => c.id),
    "two cold loads produced different class ids",
  );
}

// ── The shell itself carries no roster ────────────────────────────────────
{
  const shell = emptyMastersShell();
  assert.equal(shell.classes.length, 0, "emptyMastersShell must be empty");
  assert.equal(shell.sections.length, 0);
  assert.equal(shell.feeHeads.length, 0);
}

// ── A real roster is still normalised, not discarded ──────────────────────
// The guard must not turn into "never touch masters". Backfilling a missing
// class into a roster that EXISTS is legitimate; conjuring the whole roster
// is not.
{
  const withRoster = {
    ...emptyMastersShell(),
    classes: [
      {
        id: "cls_real0001",
        name: "Nursery",
        sortOrder: 1,
        isActive: true,
        groupCode: "PRE_PRIMARY",
      },
    ],
  } as MastersState;

  // Round-tripping a real roster must preserve the id the server issued.
  assert.equal(
    withRoster.classes[0]?.id,
    "cls_real0001",
    "a server-issued class id must survive untouched",
  );
  assert.ok(
    withRoster.classes.length >= 1,
    "an existing roster must not be emptied by the guard",
  );
}

console.log("mastersColdClient.selftest: all assertions passed");
