/**
 * A failed read must never arrive shaped like data.
 *
 * This is the rule that cost the most on 2026-08-10. fetchMastersDeskFromDb
 * dropped Supabase's `error` and returned an empty bundle, so a query that
 * timed out under load was indistinguishable from "this tenant has no
 * classes". guardMastersOverwrite read that as a bootstrap, accepted a
 * wholesale id replacement, and orphaned all 711 students on class and
 * section in a single request.
 *
 * The read client is built so the same mistake cannot be made by a caller:
 * the failure branch has no `rows` property at all, so `if (res.ok)` is not
 * optional — reading rows without checking does not compile.
 *
 * The second rule here is subtler and matters for admissions specifically: a
 * TRUNCATED read must announce itself. 919 leads at a 100-row page is ten
 * pages; a helper that quietly stopped early and returned what it had would
 * render "all leads" while showing a fraction, which is worse than an error
 * because nobody investigates a screen that looks fine.
 *
 * Run: npx tsx src/lib/data/readClient.selftest.ts
 */
import assert from "node:assert/strict";
import type { PageResult, ReadAllResult } from "./client/query";

// ── A failure carries no rows ─────────────────────────────────────────────
{
  const failure: PageResult<{ id: string }> = {
    ok: false,
    code: "unavailable",
    error: "canceling statement due to statement timeout",
  };

  assert.equal(
    "rows" in failure,
    false,
    "the failure branch must have no rows property — that absence is what " +
      "forces every caller to check ok before reading data",
  );

  // @ts-expect-error rows does not exist on the failure branch. If this
  // directive ever becomes unused, the type has been widened and the
  // masters incident is reachable again.
  void failure.rows;
}

// ── A success carries rows, including a legitimately empty page ───────────
// An empty page is real: a school with no leads yet. The difference from a
// failure is that it is ASSERTED, not inferred from an absent value.
{
  const empty: PageResult<{ id: string }> = {
    ok: true,
    rows: [],
    nextCursor: null,
    serverTime: "2026-08-10T12:00:00.000Z",
  };
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.rows, [], "empty is a valid answer when the read succeeded");
}

// ── A truncated read announces itself ─────────────────────────────────────
{
  const truncated: ReadAllResult<{ id: string }> = {
    ok: true,
    rows: [{ id: "adm_1" }],
    complete: false,
    nextCursor: "eyJzb3J0IjoiMjAyNi0wNy0xOCJ9" as never,
  };

  assert.equal(
    truncated.complete,
    false,
    "a partial result must say so. 919 leads is ten pages at the default " +
      "size; silently returning page one as 'all leads' shows a fraction " +
      "while claiming completeness",
  );

  const whole: ReadAllResult<{ id: string }> = {
    ok: true,
    rows: [{ id: "adm_1" }],
    complete: true,
  };
  assert.equal(whole.complete, true);

  // @ts-expect-error nextCursor exists only on the truncated branch — a
  // complete read has nothing left to read.
  void whole.nextCursor;
}

// ── A failure mid-pagination reports what it managed ──────────────────────
// Not so the caller can use the partial rows as data, but so a failure on
// page 7 of 10 is distinguishable from a failure on page 1.
{
  const partialFailure: ReadAllResult<{ id: string }> = {
    ok: false,
    code: "unavailable",
    error: "Network request failed",
    rowsReadBeforeFailure: 600,
  };
  assert.equal(partialFailure.ok, false);
  assert.equal(partialFailure.rowsReadBeforeFailure, 600);

  // @ts-expect-error the failure branch exposes no rows to render.
  void partialFailure.rows;
}

console.log("readClient.selftest: all assertions passed");
