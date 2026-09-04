/**
 * Dates of birth, written so they cannot be misread.
 *
 * "08/04/2020" is the 4th of August to an American file and the 8th of April
 * to an Indian one, and nothing in the string says which. That ambiguity is not
 * hypothetical here: the student import's date parser mis-handled it and
 * overwrote the day of 296 birth dates — about 42% of the roll — with their
 * month. See studentImport.selftest.ts for the incident.
 *
 * Spelling the month out removes the ambiguity at the source. "04-August-2020"
 * has exactly one reading, in any country, and survives a trip through Excel,
 * a printed form and a re-import unchanged.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const MONTH_INDEX: Record<string, number> = {};
for (const [i, m] of MONTHS.entries()) {
  MONTH_INDEX[m.toLowerCase()] = i + 1;
  MONTH_INDEX[m.slice(0, 3).toLowerCase()] = i + 1;
}
// The forms a hand-typed or exported date actually turns up in.
MONTH_INDEX.sept = 9;

/**
 * ISO `YYYY-MM-DD` → `DD-Month-YYYY`, e.g. "2020-08-04" → "04-August-2020".
 * Anything that is not a plain ISO date is returned untouched, so a half-typed
 * value in a form field is never mangled on its way to the screen.
 */
export function formatDobLong(iso: string | null | undefined): string {
  const s = (iso ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const [, y, mm, dd] = m;
  const name = MONTHS[Number(mm) - 1];
  if (!name) return s;
  return `${dd}-${name}-${y}`;
}

/**
 * `DD-Month-YYYY` → ISO, the inverse of the above. Also accepts a space or a
 * slash as the separator and a three-letter month, because that is what comes
 * back from Excel and from people typing.
 *
 * Returns "" when the value is not in this shape, so callers can fall through
 * to their other parsers rather than having to guess.
 */
export function parseDobLong(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  const m = /^(\d{1,2})[\s\-/]+([A-Za-z]{3,9})\.?[\s\-/]+(\d{4})$/.exec(s);
  if (!m) return "";
  const day = Number(m[1]);
  const month = MONTH_INDEX[m[2]!.toLowerCase()];
  const year = Number(m[3]);
  if (!month || day < 1 || day > 31) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
