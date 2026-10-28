/**
 * data-layer 2.3b: lib readers take the reference data they read as a
 * parameter (screens pass `useScreenMasters().masters`, server callers pass
 * `await loadServerMasters()`). They no longer fall back to `loadMasters()` /
 * `loadSis()` — that fallback answered from whatever the tab's copy held,
 * and before the copy had loaded that was an EMPTY book: no classes, no
 * subjects, so "no subjects for this student", "no students on leave".
 *
 * R6 (unknown is never empty): a reader handed nothing refuses. A screen
 * shows "Loading…" until the data is there and never calls the reader
 * without it; an error here is a programming mistake, surfaced loudly.
 */
export class DataNotLoadedError extends Error {
  readonly what: string;
  readonly where: string;
  constructor(what: string, where: string) {
    super(`${where}: ${what} has not loaded yet — refusing to answer from an empty copy`);
    this.name = "DataNotLoadedError";
    this.what = what;
    this.where = where;
  }
}

/** The Masters book, or a refusal. */
export function requireMasters<T>(masters: T | null | undefined, where: string): T {
  if (masters == null) throw new DataNotLoadedError("the school setup (Masters)", where);
  return masters;
}

/** The student register, or a refusal. */
export function requireSis<T>(sis: T | null | undefined, where: string): T {
  if (sis == null) throw new DataNotLoadedError("the student register", where);
  return sis;
}

/** What a report runner answers when it is run before Masters has loaded. */
export const MASTERS_NOT_LOADED_MESSAGE =
  "The school setup (classes, sections, staff) has not loaded yet — wait a moment and try again.";
