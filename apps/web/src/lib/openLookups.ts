/**
 * Three free, keyless public lookups — and the parsing that keeps them honest.
 *
 *   IFSC   ifsc.razorpay.com/<code>        bank + branch behind an IFSC
 *   PIN    api.postalpincode.in/pincode/…  district, state, localities
 *   ISBN   openlibrary.org/api/books       title, author, publisher, cover
 *
 * All three replace typing, never a decision. Each one fills a form the
 * office was going to fill by hand, the office sees what arrived, and a
 * failed lookup leaves them exactly where they are today — typing. So none
 * of them blocks a save, and none of them writes on its own.
 *
 * Two rules the parsers exist to enforce:
 *
 *  - **Validate locally before spending a request.** An IFSC that fails the
 *    format, an ISBN that fails its checksum and a PIN that is not six
 *    digits are all caught here, in the browser, for nothing. Most typos
 *    never reach the network.
 *  - **Never trust the shape.** These are third-party endpoints that owe us
 *    no compatibility: fields get renamed, an array becomes an object, a
 *    500 comes back as HTML. Every parser takes `unknown`, reads defensively,
 *    and returns null rather than throwing — a library screen must not go
 *    blank because Open Library changed a key.
 *
 * This module is pure and client-safe so openLookups.selftest.ts can pin all
 * of that without a network. The fetching lives in openLookups.server.ts.
 *
 * NOT VERIFIED AGAINST A LIVE RESPONSE. This session's egress policy blocks
 * all three hosts, so the shapes below come from each service's published
 * documentation, and the parsers are written to tolerate drift rather than
 * to assume. The first real call on a deployed environment is still worth
 * watching; a shape we guessed wrong degrades to "not found", which is the
 * same as today.
 */

/* ── IFSC ────────────────────────────────────────────────────────────── */

/**
 * The format every Indian IFSC follows: four letters (bank), a zero, then
 * six alphanumerics (branch). Shared with bankFileExport so the salary file
 * and the lookup cannot disagree about what "valid" means.
 */
export function ifscFormatOk(ifsc: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalizeIfsc(ifsc));
}

export function normalizeIfsc(ifsc: string): string {
  return String(ifsc || "").trim().toUpperCase().replace(/\s+/g, "");
}

export type IfscDetails = {
  ifsc: string;
  bank: string;
  branch: string;
  city: string;
  district: string;
  state: string;
  /** Whether the branch accepts each rail — a NEFT salary file needs NEFT. */
  neft: boolean;
  rtgs: boolean;
  imps: boolean;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Razorpay returns the word "true"/"false" as often as a real boolean. */
function flag(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = str(v).toLowerCase();
  return s === "true" || s === "yes" || s === "1";
}

export function parseIfscResponse(raw: unknown): IfscDetails | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  // The documented keys are upper-case; accept the lower-case spelling too
  // rather than return "not found" if that ever changes.
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const hit = str(o[k]) || str(o[k.toLowerCase()]);
      if (hit) return hit;
    }
    return "";
  };
  const ifsc = normalizeIfsc(pick("IFSC"));
  const bank = pick("BANK");
  // A body with neither is not an IFSC record — most likely an error page.
  if (!ifsc && !bank) return null;
  return {
    ifsc,
    bank,
    branch: pick("BRANCH"),
    city: pick("CITY", "CENTRE"),
    district: pick("DISTRICT"),
    state: pick("STATE"),
    neft: flag(o.NEFT ?? o.neft),
    rtgs: flag(o.RTGS ?? o.rtgs),
    imps: flag(o.IMPS ?? o.imps),
  };
}

/**
 * One line for the office: which bank and branch this code actually is.
 * Shown beside the field so a wrong-but-well-formed code is caught by a
 * human reading "Union Bank Of India · SIGRA" and knowing it should be
 * Murdaha Bazar.
 */
export function ifscSummary(d: IfscDetails): string {
  const where = [d.branch, d.city || d.district, d.state].filter(Boolean).join(" · ");
  return [d.bank, where].filter(Boolean).join(" — ");
}

/* ── PIN code ────────────────────────────────────────────────────────── */

export function normalizePin(pin: string): string {
  return String(pin || "").replace(/\D/g, "").slice(0, 6);
}

export function pinFormatOk(pin: string): boolean {
  // An Indian PIN is six digits and never starts with 0.
  return /^[1-9]\d{5}$/.test(normalizePin(pin));
}

export type PinDetails = {
  pincode: string;
  district: string;
  state: string;
  /** Post office / locality names under this PIN, for a picker. */
  localities: string[];
};

export function parsePinResponse(raw: unknown): PinDetails | null {
  // The service answers with a single-element ARRAY, not an object.
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first || typeof first !== "object") return null;
  const o = first as Record<string, unknown>;
  if (str(o.Status ?? o.status).toLowerCase() !== "success") return null;
  const offices = o.PostOffice ?? o.postOffice;
  if (!Array.isArray(offices) || offices.length === 0) return null;

  const rows = offices.filter(
    (r): r is Record<string, unknown> => !!r && typeof r === "object",
  );
  if (rows.length === 0) return null;

  const localities = Array.from(
    new Set(rows.map((r) => str(r.Name)).filter(Boolean)),
  );
  return {
    pincode: normalizePin(str(rows[0].Pincode)),
    district: str(rows[0].District),
    state: str(rows[0].State),
    localities,
  };
}

/* ── ISBN ────────────────────────────────────────────────────────────── */

export function normalizeIsbn(isbn: string): string {
  return String(isbn || "").toUpperCase().replace(/[^0-9X]/g, "");
}

/**
 * Check the ISBN's own check digit. This is the cheapest validation in the
 * whole module: a mistyped ISBN fails arithmetic in the browser, so the
 * librarian is told "check that number" instead of waiting on a request
 * that was always going to come back empty.
 */
export function isbnChecksumOk(isbn: string): boolean {
  const s = normalizeIsbn(isbn);
  if (s.length === 10) {
    // X is only legal as the final check digit, where it means ten.
    if (/X/.test(s.slice(0, 9))) return false;
    let sum = 0;
    for (let i = 0; i < 10; i += 1) {
      const ch = s[i];
      const v = ch === "X" ? 10 : Number(ch);
      if (Number.isNaN(v)) return false;
      sum += v * (10 - i);
    }
    return sum % 11 === 0;
  }
  if (s.length === 13) {
    if (/X/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 13; i += 1) {
      const v = Number(s[i]);
      if (Number.isNaN(v)) return false;
      sum += v * (i % 2 === 0 ? 1 : 3);
    }
    return sum % 10 === 0;
  }
  return false;
}

export type BookDetails = {
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  /** Four-digit year pulled out of whatever date string arrived. */
  year: string;
  coverUrl: string;
};

function namesOf(v: unknown): string {
  if (!Array.isArray(v)) return "";
  return v
    .map((x) => (x && typeof x === "object" ? str((x as Record<string, unknown>).name) : str(x)))
    .filter(Boolean)
    .join(", ");
}

/** "October 1, 1998" / "1998-10" / "1998" all yield "1998". */
export function yearFrom(date: unknown): string {
  const m = str(date).match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/);
  return m ? m[1] : "";
}

/**
 * Open Library keys its answer by the bibkey you asked with
 * ("ISBN:9780140328721"), and returns `{}` for a book it does not have.
 * We ignore the key and take the single entry, so a normalised ISBN that
 * differs from the one echoed back still resolves.
 */
export function parseOpenLibraryResponse(raw: unknown, isbn: string): BookDetails | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.values(raw as Record<string, unknown>);
  const book = entries.find((e) => e && typeof e === "object") as
    | Record<string, unknown>
    | undefined;
  if (!book) return null;
  const title = str(book.title);
  if (!title) return null;
  const subtitle = str(book.subtitle);
  const cover = book.cover;
  const coverUrl =
    cover && typeof cover === "object"
      ? str((cover as Record<string, unknown>).medium) ||
        str((cover as Record<string, unknown>).large) ||
        str((cover as Record<string, unknown>).small)
      : "";
  return {
    isbn: normalizeIsbn(isbn),
    title: subtitle ? `${title}: ${subtitle}` : title,
    author: namesOf(book.authors),
    publisher: namesOf(book.publishers),
    year: yearFrom(book.publish_date),
    coverUrl,
  };
}

/* ── Shared ──────────────────────────────────────────────────────────── */

/**
 * What a call site gets back. `kind` says whether to show the result, say
 * "check that number", or say nothing at all and let the office type — the
 * three are different, and collapsing them into `null` is how a lookup
 * starts blaming the librarian for an outage.
 */
export type LookupOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "invalid" | "not_found" | "unavailable"; message: string };

export const LOOKUP_MESSAGES = {
  ifscInvalid: "That is not a valid IFSC — four letters, a zero, then six characters.",
  ifscNotFound: "No bank has this IFSC. Check it against the passbook or cheque.",
  pinInvalid: "A PIN code is six digits.",
  pinNotFound: "No post office found for that PIN.",
  isbnInvalid: "That ISBN does not check out — re-read the number on the back of the book.",
  isbnNotFound: "Not in Open Library — type the details in yourself.",
  unavailable: "Lookup unavailable just now — type the details in yourself.",
} as const;
