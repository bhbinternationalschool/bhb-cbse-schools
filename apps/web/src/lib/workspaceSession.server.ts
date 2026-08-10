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

  if (trimmed) {
    // Honour an explicit request only if Masters actually defines it.
    // Selecting a closed year is legitimate (looking at last year's records);
    // a year Masters has never heard of is a fabrication or a forgery.
    const known = await listAcademicYearCodesFromDesk();
    if (known.includes(trimmed)) return trimmed;
    if (known.length > 0) {
      console.warn(
        `[session] ignoring requested academic year ${trimmed}; ` +
          `Masters defines ${known.join(", ")}`,
      );
    }
    // Unreadable Masters: fall through and resolve rather than trust the
    // request. Not returning `trimmed` here is deliberate.
  }

  const { bundle, readFailed } = await fetchMastersDeskFromDb();
  if (readFailed) {
    console.error("[session] cannot resolve academic year: masters unreadable");
    return null;
  }

  const years = bundle.academicYears ?? [];
  const resolved = resolveAcademicYear(years, new Date().toISOString());
  if (resolved.conflict) console.warn(`[session] ${resolved.conflict.message}`);
  if (resolved.code) return resolved.code;

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
