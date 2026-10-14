/**
 * What a half-typed field means — the pure rules behind components/ui/
 * draft-inputs (director, 14 Oct 2026: payroll "Adjust / pay" boxes stuck
 * while typing, and the payment date would not take its year).
 *
 * A field keeps its own draft while it has focus; only these rules decide
 * when the draft becomes the stored value. A partial or unreadable entry is
 * never stored and never clears what was stored.
 */

export const DATE_YEAR_MIN = 1900;
export const DATE_YEAR_MAX = 2100;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** A real calendar date in the accepted year range, as YYYY-MM-DD, else null. */
function isoIfReal(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < DATE_YEAR_MIN || y > DATE_YEAR_MAX) return null;
  if (m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * A typed date as YYYY-MM-DD, or null when it is not a whole, real date.
 * Accepts what a date input reports (YYYY-MM-DD) and, for browsers that show
 * a plain text box, Indian day-first DD/MM/YYYY (also - or . between).
 * The year must have four digits: while it is being typed, Chrome reports
 * 0002, 0020, 0202 — none of those is a date anyone means.
 */
export function parseTypedDate(text: string): string | null {
  const s = String(text || "").trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return isoIfReal(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return isoIfReal(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/**
 * Whether a date field's current draft should be stored.
 *  - a whole, real date → store it (as YYYY-MM-DD);
 *  - empty and the browser says nothing half-typed is inside (badInput
 *    false) → the user cleared it: store "" — on blur, or at once when
 *    `clearNow` (the picker's own clear button);
 *  - anything else (day and month typed, year not yet; 31/02) → keep
 *    typing; store nothing.
 * `allowEmpty: false` is for a box that must always hold a day (the day a
 * register or log book shows): emptying it stores nothing, and on blur the
 * stored day shows again.
 */
export function dateDraftCommit(
  draft: string,
  opts: { badInput?: boolean; onBlur?: boolean; clearNow?: boolean; allowEmpty?: boolean } = {},
): { commit: true; value: string } | { commit: false } {
  if (opts.badInput) return { commit: false };
  const s = String(draft || "").trim();
  if (!s) {
    if (opts.allowEmpty === false) return { commit: false };
    return opts.onBlur || opts.clearNow ? { commit: true, value: "" } : { commit: false };
  }
  const iso = parseTypedDate(s);
  return iso ? { commit: true, value: iso } : { commit: false };
}

/**
 * A number box's draft as a number: "" is 0 (an emptied box means nothing),
 * an unreadable entry is null (the box goes back to the stored value).
 */
export function draftNumberValue(draft: string): number | null {
  const s = String(draft ?? "").trim().replace(/,/g, "");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** What a stored number shows in its box. */
export function numberDraftText(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "" : String(n);
}
