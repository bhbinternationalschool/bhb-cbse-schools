# Three free public lookups — IFSC, PIN code, ISBN

No API key, no account, no configuration. They are on as soon as they are
deployed, and each one replaces typing rather than a decision.

| Lookup | Endpoint | Where it shows |
|---|---|---|
| IFSC → bank + branch | `ifsc.razorpay.com/<code>` | Staff profile → Bank tab, under the IFSC field |
| PIN → district, state, localities | `api.postalpincode.in/pincode/<pin>` | Student form → address, under the PIN field |
| ISBN → title, author, publisher, year | `openlibrary.org/api/books` | Library → add title, under the ISBN field |

All three go through `GET /api/lookup?kind=…&q=…`, which answers one envelope:

```
{ ok: true,  kind: "ifsc", data: {…} }
{ ok: false, kind: "invalid" | "not_found" | "unavailable", message }
```

Those three failure kinds are deliberately not collapsed into one. "Check
that number", "we don't have that book" and "the service is away" call for
three different things on screen, and merging them is how a lookup starts
blaming the librarian for somebody else's outage.

## Why each one earns its place

**IFSC.** `bankFileExport` already rejects a malformed code. What it cannot
catch is a **well-formed code for the wrong branch** — and that is the
expensive one: the bank rejects the entire salary file over a single bad
beneficiary row, after the office has gone home. Reading "Union Bank of
India — SIGRA" under a field that should say Murdaha Bazar catches it in a
second. The check also warns when a branch does not accept NEFT, which
bounces the file for a different reason.

**PIN.** Fills district and state on the student address. It **offers**
rather than fills: the button appears once six digits are in, and nothing
moves until somebody presses it. An address a parent dictated at the counter
is not ours to overwrite because a post office spells the locality
differently.

**ISBN.** Fills **only the boxes still empty**. The librarian has the
physical book in hand and Open Library does not, so whatever they typed wins
over whatever a stranger catalogued. This saves typing; it does not correct
anybody.

## Validation happens before the network

An IFSC that fails the format, a PIN that is not six digits, and an ISBN
that **fails its own check digit** are all rejected in the browser, for
nothing. Most typos never reach the network — and a mistyped ISBN is told
"re-read the number" instead of waiting on a request that was always going
to come back empty.

## Shape tolerance, and one caveat worth knowing

These are third-party endpoints that owe us no compatibility. Every parser
takes `unknown`, reads defensively (upper- and lower-case keys, `"true"` as
well as `true`, an array where an object was documented) and returns `null`
rather than throwing. A library screen must not go blank because Open
Library renamed a field.

**The parsers were written against published documentation, not against a
live response.** The session that built them had all three hosts blocked by
its network egress policy, so nothing here has met the real services yet.
The failure mode if a shape was guessed wrong is `not_found` — the office
types the value, exactly as today — but the first real lookup on a deployed
environment is still worth watching. `openLookups.selftest.ts` pins the
documented shapes plus the drift cases, and CI runs it
(`npm run test:open-lookups`).

## Rate limiting

`/api/lookup` is **not** behind staff auth on purpose — the public admission
enquiry form fills city and state from a PIN before anyone has logged in. A
per-IP limiter (60/min, its own bucket) is the mitigation. It has its own
bucket rather than sharing the Maps proxy's so that map calls cannot spend
the enquiry form's budget and leave a parent staring at a field that quietly
stopped filling itself.

`lib/rateLimit.ts` is the factory for that. `lib/mapsRateLimit.ts` is the
same idea hard-wired to one bucket and is deliberately left alone: it guards
the **paid** Google proxies, it works, and rewriting it to prove a point
about duplication is not worth the risk to a live path.
