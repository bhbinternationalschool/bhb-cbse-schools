"use client";

/**
 * Browser side of the three free lookups — one call per kind, all through
 * /api/lookup, all returning the same LookupOutcome the server produced.
 *
 * Every failure path collapses to an outcome rather than a throw, including
 * the network itself: a form field that calls a lookup must never be able to
 * break the page it sits in. The worst case is `unavailable`, which means
 * the office types the value as it always has.
 */

import {
  LOOKUP_MESSAGES,
  type BookDetails,
  type IfscDetails,
  type LookupOutcome,
  type PinDetails,
} from "@/lib/openLookups";

type Envelope = {
  ok?: boolean;
  kind?: string;
  data?: unknown;
  message?: string;
};

const FAILURE_KINDS = ["invalid", "not_found", "unavailable"] as const;

function failureKind(v: unknown): "invalid" | "not_found" | "unavailable" {
  const s = String(v || "");
  return (FAILURE_KINDS as readonly string[]).includes(s)
    ? (s as "invalid" | "not_found" | "unavailable")
    : "unavailable";
}

async function call<T>(kind: string, q: string): Promise<LookupOutcome<T>> {
  const value = q.trim();
  if (!value) {
    return { ok: false, kind: "invalid", message: "Nothing to look up" };
  }
  try {
    const res = await fetch(
      `/api/lookup?kind=${encodeURIComponent(kind)}&q=${encodeURIComponent(value)}`,
    );
    const json = (await res.json().catch(() => ({}))) as Envelope;
    if (json.ok === true && json.data) {
      return { ok: true, data: json.data as T };
    }
    return {
      ok: false,
      kind: failureKind(json.kind),
      message: json.message || LOOKUP_MESSAGES.unavailable,
    };
  } catch {
    return { ok: false, kind: "unavailable", message: LOOKUP_MESSAGES.unavailable };
  }
}

/** Which bank and branch is behind this IFSC? */
export function lookupIfscApi(ifsc: string): Promise<LookupOutcome<IfscDetails>> {
  return call<IfscDetails>("ifsc", ifsc);
}

/** District, state and localities for a six-digit PIN. */
export function lookupPinApi(pin: string): Promise<LookupOutcome<PinDetails>> {
  return call<PinDetails>("pincode", pin);
}

/** Title, author, publisher, year and cover for an ISBN. */
export function lookupIsbnApi(isbn: string): Promise<LookupOutcome<BookDetails>> {
  return call<BookDetails>("isbn", isbn);
}
