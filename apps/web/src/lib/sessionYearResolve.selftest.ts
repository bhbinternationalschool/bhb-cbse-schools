/**
 * Nothing may write an academic year the server cannot corroborate.
 *
 * On 2026-08-10 the header showed "2025-26 · Current" while the database said
 * 2026-27 was current, dated 2026-04-01 to 2027-03-31. The school had been
 * running for months inside a session that ended 2026-03-31.
 *
 * The chain: a frozen masters desk held zero academic years ->
 * currentAcademicYearCode() returned DEFAULT_AY ("2025-26") for "unknown" ->
 * the client aligner PATCHed that fabrication into the SIGNED server cookie ->
 * the guess outlived the empty desk that produced it.
 *
 * Both halves of that chain are now gone. The client no longer computes the
 * year at all — `GET /api/session/ay` answers from the calendar against
 * Masters in the database, and the browser only relays it (see
 * lib/workspaceSession.ts). And the PATCH route validates what it is asked to
 * store, which is what this file still pins.
 *
 * The resolution logic itself lives in academicYearResolve.selftest.ts. This
 * file covers only the write gate: what the server will and will not accept
 * into a signed cookie.
 *
 * Run: npx tsx src/lib/sessionYearResolve.selftest.ts
 */
import assert from "node:assert/strict";

/** The PATCH route's validation, exactly. */
function routeAccepts(requested: string, known: string[]): boolean {
  if (known.length === 0) return true; // cannot validate — do not lock anyone out
  return known.includes(requested);
}

const KNOWN = ["2025-26", "2024-25", "2026-27"];

// ── What must be accepted ─────────────────────────────────────────────────
{
  assert.equal(routeAccepts("2026-27", KNOWN), true, "the current year");

  assert.equal(
    routeAccepts("2025-26", KNOWN),
    true,
    "a CLOSED year is still selectable — reading last year's records is " +
      "ordinary work, and refusing it would break a real task to prevent a " +
      "bug that lives elsewhere",
  );

  assert.equal(
    routeAccepts("2026-27", []),
    true,
    "an unreadable Masters must not lock everyone out of switching sessions: " +
      "'cannot validate' is not 'nothing is valid'",
  );
}

// ── What must be refused ──────────────────────────────────────────────────
{
  assert.equal(
    routeAccepts("2099-00", KNOWN),
    false,
    "a year Masters never defined can only be a fabrication or a forgery",
  );

  assert.equal(
    routeAccepts("", KNOWN),
    false,
    "an empty string is not a year",
  );

  assert.equal(
    routeAccepts("2025-26 ", KNOWN),
    false,
    "the route trims before this check, so an untrimmed value reaching it " +
      "means the trim was removed",
  );
}

console.log("sessionYearResolve.selftest: all assertions passed");
