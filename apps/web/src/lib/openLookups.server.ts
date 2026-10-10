import "server-only";

/**
 * Fetching for the three free lookups. The parsing and every rule live in
 * openLookups.ts; this file is the network and nothing else.
 *
 * Why it runs on the server rather than in the browser, when all three
 * endpoints are public and keyless:
 *
 *  - two of the three have no CORS headers we control, so a browser call
 *    would work or not depending on the service's mood;
 *  - Next's fetch cache is here, so a hundred admissions rows sharing one
 *    Varanasi PIN cost one request a day rather than a hundred;
 *  - it keeps one place to add a timeout, a User-Agent and a rate limit,
 *    which is the difference between a dependency and a liability.
 *
 * Nothing here throws. Every failure — bad shape, 404, timeout, the service
 * being down — comes back as a LookupOutcome the caller can show, because
 * the fallback for all three is the same thing the office does today: type
 * it in.
 */

import {
  LOOKUP_MESSAGES,
  type BookDetails,
  type IfscDetails,
  type LookupOutcome,
  type PinDetails,
  ifscFormatOk,
  isbnChecksumOk,
  normalizeIfsc,
  normalizeIsbn,
  normalizePin,
  parseIfscResponse,
  parseOpenLibraryResponse,
  parsePinResponse,
  pinFormatOk,
} from "@/lib/openLookups";

/** Long enough for a slow public endpoint, short enough that a form does not hang. */
const TIMEOUT_MS = 6_000;

/**
 * A day. All three answers are effectively static — a branch does not move,
 * a PIN does not change district, a book does not get a new author — so a
 * short cache would only cost requests against services that ask us to be
 * polite.
 */
const REVALIDATE_S = 86_400;

/**
 * Open Library rate-limits or blocks a generic User-Agent, and asks callers
 * to identify themselves. The others do not ask, but a named caller is the
 * courtesy that keeps a free service free.
 */
const UA = "BHB-School-ERP/1.0 (+https://bhbinternational.school)";

type FetchResult =
  | { ok: true; json: unknown }
  | { ok: false; status: number };

async function fetchJson(url: string): Promise<FetchResult> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: REVALIDATE_S },
    });
    if (!res.ok) return { ok: false, status: res.status };
    // A service having a bad day answers 200 with an HTML error page, so the
    // parse is inside the try: a SyntaxError here is "unavailable", not a crash.
    return { ok: true, json: await res.json() };
  } catch {
    return { ok: false, status: 0 };
  }
}

/* ── IFSC ────────────────────────────────────────────────────────────── */

/**
 * Does this IFSC exist, and whose branch is it?
 *
 * The format check in bankFileExport already catches a malformed code. What
 * it cannot catch is a well-formed code for a branch that does not exist, or
 * for the wrong branch — and that is the one that matters, because the bank
 * rejects the entire salary file over a single bad beneficiary row, after
 * the office has already left for the day.
 */
export async function lookupIfsc(
  input: string,
): Promise<LookupOutcome<IfscDetails>> {
  const ifsc = normalizeIfsc(input);
  if (!ifscFormatOk(ifsc)) {
    return { ok: false, kind: "invalid", message: LOOKUP_MESSAGES.ifscInvalid };
  }
  const res = await fetchJson(`https://ifsc.razorpay.com/${encodeURIComponent(ifsc)}`);
  if (!res.ok) {
    return res.status === 404
      ? { ok: false, kind: "not_found", message: LOOKUP_MESSAGES.ifscNotFound }
      : { ok: false, kind: "unavailable", message: LOOKUP_MESSAGES.unavailable };
  }
  const data = parseIfscResponse(res.json);
  if (!data) {
    return { ok: false, kind: "not_found", message: LOOKUP_MESSAGES.ifscNotFound };
  }
  return { ok: true, data };
}

/* ── PIN code ────────────────────────────────────────────────────────── */

/** PIN → district, state and the localities under it, for address autofill. */
export async function lookupPin(
  input: string,
): Promise<LookupOutcome<PinDetails>> {
  const pin = normalizePin(input);
  if (!pinFormatOk(pin)) {
    return { ok: false, kind: "invalid", message: LOOKUP_MESSAGES.pinInvalid };
  }
  const res = await fetchJson(`https://api.postalpincode.in/pincode/${pin}`);
  if (!res.ok) {
    return { ok: false, kind: "unavailable", message: LOOKUP_MESSAGES.unavailable };
  }
  const data = parsePinResponse(res.json);
  if (!data) {
    // This service answers 200 with Status:"Error" for an unknown PIN, so a
    // failed parse here is far more likely "no such PIN" than an outage.
    return { ok: false, kind: "not_found", message: LOOKUP_MESSAGES.pinNotFound };
  }
  return { ok: true, data };
}

/* ── ISBN ────────────────────────────────────────────────────────────── */

/** ISBN → title, author, publisher, year, cover for the library catalogue. */
export async function lookupIsbn(
  input: string,
): Promise<LookupOutcome<BookDetails>> {
  const isbn = normalizeIsbn(input);
  if (!isbnChecksumOk(isbn)) {
    return { ok: false, kind: "invalid", message: LOOKUP_MESSAGES.isbnInvalid };
  }
  const url =
    "https://openlibrary.org/api/books" +
    `?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`;
  const res = await fetchJson(url);
  if (!res.ok) {
    return { ok: false, kind: "unavailable", message: LOOKUP_MESSAGES.unavailable };
  }
  const data = parseOpenLibraryResponse(res.json, isbn);
  if (!data) {
    // Open Library answers 200 `{}` for a book it does not hold — common for
    // Indian school publishers, and not an error.
    return { ok: false, kind: "not_found", message: LOOKUP_MESSAGES.isbnNotFound };
  }
  return { ok: true, data };
}
