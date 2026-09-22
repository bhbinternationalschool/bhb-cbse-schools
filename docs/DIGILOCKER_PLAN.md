# DigiLocker — design, and what the school must do first

**Status: not built.** This is the design and the onboarding path. There is
deliberately no code yet: DigiLocker access requires partner onboarding the
school has not started, and an integration nobody can call is dead code that
rots until it is wrong. Build when access lands; this document is what to
build.

## The problem it solves

Today a document reaches the ERP as a **photograph a parent sends on
WhatsApp**. The office then OCRs it (Google Vision), reads the name off it,
and somebody checks it by eye. That is the mechanism behind most of the
UDISE+ and APAAR backlog, and behind the 22 Sep APAAR consent bug — the
record held the father's Aadhaar and the flow could not tell whose card it
was looking at.

DigiLocker replaces the photograph with the **government-issued original**,
fetched with the parent's own consent. No OCR, no eyeballing, no "please
send a clearer photo".

## What it can and cannot give us

Our seven student document slots (`StudentDocKey` in `lib/sis.ts`):

| Slot | DigiLocker | Note |
|---|---|---|
| `aadhaar` | **Yes** — eAadhaar | The strongest case. Removes the Aadhaar photo flow and its OCR entirely, and carries the holder's name as issued, which is exactly what the APAAR/UDISE name match needs. |
| `birthCert` | **Sometimes** | Issued by the municipal body. Varies by local body and by year — older births are often not digitised at all. |
| `casteCert` | **Sometimes** | UP e-District issues into DigiLocker. Depends on where and when it was issued. |
| `incomeCert` | **Sometimes** | Same as caste. |
| `tc` | **No** | A transfer certificate is issued by the *previous school*. Unless that school issues into DigiLocker — almost none do — it stays a photograph. |
| `addressProof` | **Partly** | Whatever the family happens to hold (ration card, utility bill) — not a reliable slot. |
| `photo` | **No** | Not a document. |

So this is not a replacement for document intake. It is a much better path
for **Aadhaar first**, and an opportunistic one for the three certificates.
Plan the build in that order, and do not promise the office that the TC
chase goes away.

**CBSE marksheets** are the other real win, separate from the seven slots:
CBSE issues into DigiLocker, so a Class X/XII marksheet for an incoming
student can be fetched rather than photographed and typed.

## The honest counterweight

**The parent needs a DigiLocker account.** For a village family in Varanasi
that is a real barrier — an Aadhaar-linked mobile, an OTP, and an app they
have never opened. Expect adoption well under half in year one.

That shapes the build: DigiLocker is an **additional** path offered beside
the existing upload, never a replacement for it, and never a blocker on
admission. A family that cannot use it must see exactly what they see today.

## How it works

Standard OAuth 2.0 authorization code flow:

1. The ERP sends the parent to DigiLocker with our client id and a redirect
   back to us.
2. The parent signs in and **consents, per document or per scope**.
3. We receive a code, exchange it for an access token.
4. `Get List of Issued Documents` returns metadata — each entry carries a
   `doctype` and an `issuerid`.
5. `Pull Document` fetches the file (and, for some types, the structured XML
   behind it, which is better than the PDF because it needs no parsing).

The Authorized Partner API adds two custom key headers alongside the bearer
token. The full specification is the *DigiLocker Authorized Partner API
Specification* (v2.2, Oct 2022 at the time of writing) — read that version,
not this summary, when building.

## Onboarding — what the school must do

This is the blocking step, and it is the school's to do, not a developer's.

1. **Register on the API Setu partners portal** as the organisation
   (BHB International School), not as an individual.
2. **Request access to the DigiLocker Requester APIs.** Onboarding involves
   identity and purpose checks — you are asking for access to citizens'
   verified records, and "school ERP, to collect admission documents with
   parental consent" is the purpose to state.
3. **Provide the redirect URI**: `https://bhbinternational.school/api/integrations/digilocker/callback`
   (matching how the Meta OAuth callback is already registered).
4. **Receive** the client id, client secret and the two custom keys.
5. Give them to a developer to put in Secret Manager — never in the repo,
   never prefixed `NEXT_PUBLIC_`.

Expect this to take weeks, not days. Start it before any code is written.

## DPDP posture

This is the part that makes DigiLocker *better* than what we do now, and it
is worth stating plainly because it is the opposite of the Puter reasoning
in `PUTER_FREE_APIS.md`:

- The data stays in India, on government infrastructure.
- Consent is **explicit, per document, and given by the parent to
  DigiLocker** — not inferred by us from the fact that they sent a photo.
- We receive an issued original rather than storing a camera roll image of
  somebody's Aadhaar, which is a liability we currently carry.
- The consent is auditable on the government's side as well as ours.

One rule to carry into the build: **store the same minimum we store today.**
A pull that succeeds is not licence to keep more of a family's record than
the slot needs.

## What changes in the code

When access lands, roughly:

- `app/api/integrations/digilocker/authorize` and `/callback` — the OAuth
  pair, mirroring the existing Meta OAuth route shape.
- `lib/digilocker.ts` — pure: `doctype` → `StudentDocKey` mapping, issued-
  document list parsing, name normalisation for the UDISE/Aadhaar match.
  Testable without credentials, like `bhashini.ts` and `openLookups.ts`.
- `lib/digilocker.server.ts` — the token exchange and the two pulls.
- A "Fetch from DigiLocker" button beside each eligible upload slot, which
  **falls back to the existing upload** on any failure.
- `apaarConsent` gains a path where the consenting parent's Aadhaar came
  from their own DigiLocker, which is the cleanest possible answer to the
  22 Sep bug: the card is the consenter's by construction.

## Open questions to settle during onboarding

- Which UP issuers actually publish birth certificates into DigiLocker for
  Varanasi, and from which year? This decides whether `birthCert` is worth
  wiring at all.
- Does the school qualify as a Requester for **student** records, given the
  data subject is a minor and the consenting party is the parent? Ask
  explicitly during onboarding rather than discovering it in review.
- Is the structured XML available for the document types we care about, or
  only the PDF? The former removes OCR entirely; the latter only improves
  its input quality.
