import { NextRequest, NextResponse } from "next/server";
import { createRateLimiter } from "@/lib/rateLimit";
import { lookupIfsc, lookupIsbn, lookupPin } from "@/lib/openLookups.server";

/**
 * GET /api/lookup?kind=ifsc|pincode|isbn&q=<value>
 *
 * One route for the three free public lookups rather than three files that
 * would differ only in which function they call. Each answers the same
 * envelope, so a call site handles one shape:
 *
 *   { ok: true,  kind: "ifsc", data: {…} }
 *   { ok: false, kind: "not_found" | "invalid" | "unavailable", message }
 *
 * Deliberately NOT gated behind staff auth: the public admission enquiry
 * form fills city and state from a PIN before anybody has logged in. The
 * rate limit below is the mitigation, and it is all these endpoints need —
 * they are free, keyless and public, so abuse costs the school nothing but
 * the courtesy of not hammering somebody else's free service.
 *
 * Always HTTP 200 except for a bad request or the limiter. A lookup that
 * found nothing is a normal answer, not an error, and a call site that has
 * to branch on status codes to tell "no such book" from "service down" will
 * get it wrong.
 */

// Its own bucket, and roomier than the maps proxy's: a librarian entering a
// carton of new books does 50 ISBNs in a sitting, and that is the tool
// working, not abuse.
const limited = createRateLimiter({ windowMs: 60_000, max: 60 });

const KINDS = ["ifsc", "pincode", "isbn"] as const;
type Kind = (typeof KINDS)[number];

function isKind(v: string): v is Kind {
  return (KINDS as readonly string[]).includes(v);
}

export async function GET(req: NextRequest) {
  if (limited(req)) {
    return NextResponse.json({ ok: false, kind: "unavailable", message: "Too many lookups — wait a moment." }, { status: 429 });
  }
  const kind = (req.nextUrl.searchParams.get("kind") || "").trim().toLowerCase();
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!isKind(kind)) {
    return NextResponse.json({ ok: false, kind: "invalid", message: "Unknown lookup" }, { status: 400 });
  }
  if (!q) {
    return NextResponse.json({ ok: false, kind: "invalid", message: "Nothing to look up" }, { status: 400 });
  }

  const outcome =
    kind === "ifsc"
      ? await lookupIfsc(q)
      : kind === "pincode"
        ? await lookupPin(q)
        : await lookupIsbn(q);

  return outcome.ok
    ? NextResponse.json({ ok: true, kind, data: outcome.data })
    : NextResponse.json({ ok: false, kind: outcome.kind, message: outcome.message });
}
