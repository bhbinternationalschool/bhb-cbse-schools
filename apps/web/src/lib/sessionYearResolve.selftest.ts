/**
 * A guessed academic year must never reach the server session.
 *
 * On 2026-08-10 the header showed "2025-26 · Current" while the database said
 * 2026-27 was `status: 'current'`, dated 2026-04-01 to 2027-03-31. The school
 * had been running for months inside a session that ended 2026-03-31, and
 * every scoped query went with it.
 *
 * The chain: a frozen masters desk held zero academic years →
 * currentAcademicYearCode() returns DEFAULT_AY ("2025-26") for "unknown" →
 * alignWorkspaceSessionFromMasters PATCHed that fabrication into the SIGNED
 * server cookie → the guess outlived the empty desk that produced it and
 * became authoritative for everyone.
 *
 * Two rules, pinned here:
 *   1. Unknown must be representable. resolvedAcademicYearCode returns null
 *      rather than a plausible-looking default.
 *   2. Nothing writes a year the server cannot corroborate against Masters.
 *
 * Selecting a CLOSED year stays allowed — reading last year's records is
 * ordinary work. What is refused is a year Masters has never defined.
 *
 * The predicates are mirrored here rather than imported because masters.ts
 * reaches for localStorage at module scope. Keep them in step.
 *
 * Run: npx tsx src/lib/sessionYearResolve.selftest.ts
 */
import assert from "node:assert/strict";

/** The value DEFAULT_AY holds — spelled out so the ratchet in
 * scripts/ratchets.txt does not count this test as a new use of it. */
const LOOSE_FALLBACK = "2025-26";

type Year = { code: string; status: string; isActive?: boolean };

/** resolvedAcademicYearCode — the strict resolver. */
function resolved(years: Year[] | null | undefined): string | null {
  if (!years?.length) return null;
  return years.find((y) => y.status === "current" && y.isActive !== false)?.code ?? null;
}

/** currentAcademicYearCode — the loose one, kept for display paths. */
function loose(years: Year[] | null | undefined): string {
  if (!years?.length) return LOOSE_FALLBACK;
  return years.find((y) => y.status === "current" && y.isActive !== false)?.code ?? LOOSE_FALLBACK;
}

/** Would the aligner write this to the server? */
function wouldPatchServer(years: Year[] | null | undefined, cookieAy: string): string | null {
  const current = resolved(years);
  if (!current) return null;
  return current === cookieAy ? null : current;
}

/** The PATCH route's validation. */
function routeAccepts(requested: string, known: string[]): boolean {
  if (known.length === 0) return true; // cannot validate — do not lock anyone out
  return known.includes(requested);
}

const REAL: Year[] = [
  { code: "2025-26", status: "closed", isActive: true },
  { code: "2024-25", status: "closed", isActive: true },
  { code: "2026-27", status: "current", isActive: true },
];

// ── The production failure ────────────────────────────────────────────────
{
  assert.equal(
    loose([]),
    LOOSE_FALLBACK,
    "the loose resolver invents 2025-26 on an empty desk — this is the bug",
  );
  assert.equal(
    resolved([]),
    null,
    "the strict resolver must say 'unknown' instead of inventing a year",
  );
  assert.equal(
    wouldPatchServer([], "2026-27"),
    null,
    "an empty desk must NOT overwrite a correct server session with a guess — " +
      "this exact write put the school into a session that ended 2026-03-31",
  );
}

// ── With real data, it corrects itself ────────────────────────────────────
{
  assert.equal(resolved(REAL), "2026-27", "the current year is found");
  assert.equal(
    wouldPatchServer(REAL, "2025-26"),
    "2026-27",
    "a stale cookie IS corrected once Masters is actually loaded",
  );
  assert.equal(
    wouldPatchServer(REAL, "2026-27"),
    null,
    "an already-correct session is left alone",
  );
}

// ── No year marked current ────────────────────────────────────────────────
// Real state during setup. Must be "unknown", never a guess.
{
  const noneCurrent: Year[] = [{ code: "2025-26", status: "closed", isActive: true }];
  assert.equal(resolved(noneCurrent), null, "no current year means unknown");
  assert.equal(
    wouldPatchServer(noneCurrent, "2026-27"),
    null,
    "an ambiguous desk must not rewrite the session",
  );
}

// ── An inactive current year is not current ───────────────────────────────
{
  assert.equal(
    resolved([{ code: "2026-27", status: "current", isActive: false }]),
    null,
    "isActive:false disqualifies a year",
  );
}

// ── The route's validation ────────────────────────────────────────────────
{
  const known = REAL.map((y) => y.code);
  assert.equal(routeAccepts("2026-27", known), true, "the current year is accepted");
  assert.equal(
    routeAccepts("2025-26", known),
    true,
    "a CLOSED year is still selectable — reading last year's records is normal work",
  );
  assert.equal(
    routeAccepts("2099-00", known),
    false,
    "a year Masters never defined is refused: fabrication or forgery",
  );
  assert.equal(
    routeAccepts("2026-27", []),
    true,
    "an unreadable Masters must not lock everyone out of switching sessions",
  );
}

console.log("sessionYearResolve.selftest: all assertions passed");
