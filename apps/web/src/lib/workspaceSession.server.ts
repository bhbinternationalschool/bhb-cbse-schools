/**
 * Resolve the workspace academic year for login cookies.
 *
 * The year decided here is written into a SIGNED session cookie and scopes
 * every query the user then makes, so it must never be taken on trust from
 * the request. This module previously opened with:
 *
 *   const trimmed = requested?.trim();
 *   if (trimmed) return trimmed;          // an unvalidated client value wins
 *
 * and fell back to DEFAULT_AY ("2025-26") when Masters was unreadable. Both
 * routes are closed: a requested year must be one Masters defines, and an
 * unknown year is null rather than a plausible-looking default.
 */

import {
  fallbackAcademicYear,
  resolveAcademicYear,
} from "@/lib/academicYearResolve";
import {
  fetchMastersDeskFromDb,
  listAcademicYearCodesFromDesk,
} from "@/lib/mastersNormalized.server";

/**
 * The academic year to stamp on a new session, or null when it cannot be
 * determined.
 *
 * Null is a real answer — no year covers today and none is marked current —
 * and callers must surface it as setup work rather than substitute a guess.
 * A fabricated year here is what ran the school for four months inside a
 * session that ended 2026-03-31.
 */
export async function resolveLoginAcademicYearCode(
  requested?: string,
): Promise<string | null> {
  const trimmed = requested?.trim();

  const { bundle, readFailed } = await fetchMastersDeskFromDb();
  if (readFailed) {
    console.error("[session] cannot resolve academic year: masters unreadable");
    return null;
  }

  const years = bundle.academicYears ?? [];
  const resolved = resolveAcademicYear(years, new Date().toISOString());
  if (resolved.conflict) console.warn(`[session] ${resolved.conflict.message}`);

  if (trimmed && resolved.code && trimmed !== resolved.code) {
    // A LOGIN starts in the current year, full stop. This used to honour any
    // year Masters defines — "selecting a closed year is legitimate" — but
    // no login screen offers a choice; the only thing that ever arrived here
    // was the browser's own guess, DEFAULT_AY "2025-26", from a login page
    // whose masters copy was empty. Because 2025-26 IS a defined year it was
    // accepted, every session began in the closed year, and the shell had to
    // PATCH it to 2026-27 seconds later (2026-09-06: five times in an hour,
    // with the pages showing last year's data in between). Looking at a
    // closed year is still ordinary work — through the header selector,
    // i.e. PATCH /api/session/ay, which validates against Masters.
    console.warn(
      `[session] login asked for ${trimmed}; starting in the current year ${resolved.code} instead`,
    );
  }
  if (resolved.code) return resolved.code;

  if (trimmed) {
    // Nothing covers today and nothing is marked current. Honour the request
    // only if Masters defines it — a year Masters has never heard of is a
    // fabrication or a forgery.
    const known = await listAcademicYearCodesFromDesk();
    if (known.includes(trimmed)) return trimmed;
    if (known.length > 0) {
      console.warn(
        `[session] ignoring requested academic year ${trimmed}; ` +
          `Masters defines ${known.join(", ")}`,
      );
    }
  }

  // Nothing covers today and nothing is marked current — between sessions, or
  // next year not yet created. Use the latest year Masters defines rather than
  // a hardcoded constant: still a fallback, but derived from the school's own
  // data, so it cannot silently rot the way DEFAULT_AY did.
  const fallback = fallbackAcademicYear(years);
  if (fallback) {
    console.warn(
      `[session] no academic year covers today and none is marked current; ` +
        `using the latest defined year ${fallback}. Set the current year in Masters.`,
    );
  }
  return fallback;
}
