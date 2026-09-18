# UDISE+ documents over WhatsApp

The school asks a family for the documents the UDISE+ register still lacks;
the family replies with a photo; the ERP reads it, files it on the child,
corrects the record where it safely can, and tells the office what to type
into the portal. Nobody re-keys an Aadhaar number.

## The loop

1. **Ask.** Masters → Automation → *UDISE+ documents request* (seeded off,
   approval-first, Mondays 10:00). Audience preset *UDISE+ documents missing*:
   one message per household, listing exactly what to send — child's Aadhaar,
   parent's Aadhaar, birth certificate (no DOB on record), address proof (no
   address + PIN on the household). A child with PEN and APAAR issued is not
   asked; a portal-side gap (verification pending) is not asked either.
   Template family `udise_docs_request` (`bhb_udise_docs_request`, en + hi).
2. **Receive.** `app/api/wa/webhook/route.ts`: a photo or PDF from a *known*
   household goes to `captureUdiseDocumentFromWhatsApp` after the 200 (Meta
   re-delivers slow webhooks). Unknown numbers and videos still reach the
   ordinary bot.
3. **Read.** `readParentDocument` (lib/aiLlm.server.ts) — Gemini vision with
   `UDISE_DOC_EXTRACT_SYSTEM` (copy what is printed, never complete a number,
   a year alone is not a DOB), recorded in `ai_generations` under route
   `wa/parent-document` like every other LLM call. `parseUdiseDocExtract`
   drops anything that fails its rule: Aadhaar must be 12 digits *and* pass
   the Verhoeff checksum (`lib/aadhaar.ts`), DOB must be a full ISO date, PIN
   six digits. A failed call — API error, truncated JSON, unparseable reply —
   returns a *failure*, never a document "of type other": see **Read, or
   not read** below.
4. **Route** on what the file IS (`documentRouteFor`), before anything else:
   an Aadhaar / birth certificate / address proof takes the record path
   below; a receipt or payment screenshot takes the payment path; anything
   else is handed to a person and nothing UDISE+ is said about it.
5. **Match** (record path only). One child → that child. Several → the name
   on the document or in the caption must pick exactly one, else nothing is
   written and the parent is asked to resend with the child's name. A
   parent's own Aadhaar applies to every child of the household. The child
   list comes from `childrenOfHousehold(sis, hh, thisSession)` — one row per
   child. The raw `status === "active"` filter returns one row per child per
   academic year, and used to ask a single-child family "which child is this
   for? (RAHUL / RAHUL)".
6. **File.** Drive under `students/<id>`, vault slot `aadhaar` / `birthCert`
   / `addressProof` set to *received* with the proxy URL. A parent's Aadhaar
   has no slot; it is kept in the first child's Drive folder.
7. **Correct.** `planUdiseCorrections` decides per field, deterministically:
   - a name is changed only as a *spelling* variant of the name on record
     (`compareNames`: ≤25 % edit distance after stripping honorifics); a
     different name holds everything back for the office;
   - DOB and Aadhaar are written when valid; gender is filled, never flipped;
   - address + PIN go on the household.
   Student writes use `pushSisToDb` on a freshly read row, so the revision
   guard refuses a stale write; an audit row is written with Aadhaar masked.
8. **Tell.** Parent: a short ack in their template language, masked Aadhaar.
   Office (owner, principal, admin, office, accounts by RBAC role): WhatsApp
   text inside their 24h window, template `udise_doc_received`
   (`bhb_udise_doc_received`) outside it, a push, and an ERP inbox item — the
   message lists *Updated in SIS*, *Needs your decision*, and *Change in
   UDISE+ portal* in the portal's own field names.

## Read, or not read

Three different things used to produce one answer: a Gemini error, a reply
truncated at the token limit, and a genuine "this is not an ID document".
All three became `docType: "other"`, and both the parent and the office were
told the document "could not be recognised" — a claim about the document,
when the truth was that nobody had read it. Nothing was recorded either way,
so afterwards there was no telling which had happened.

Now:

- every attempt writes an `ai_generations` row (`wa/parent-document`) with
  its status, error and tokens — the reading itself is never stored, only
  the document type;
- a failure returns a failure. The parent is told we could not read it and
  that a person will look, and is asked for nothing;
- a file we *did* read but cannot act on gets a plain "received, the office
  will look at it" — no UDISE+ wording, no question, and no list of the
  family's children. Unless the parent wrote something with it: a caption is
  the message and the file its attachment, so that goes to the ordinary bot,
  which answers the sentence and escalates by itself;
- both go to the office relay (`relayEscalation`, category by sender), which
  forwards the photograph itself to the office phones with a reply code.

## What it will never do

Write a number that fails its checksum; turn a year into a birthday; put a
stranger's card on a child because the surname matched; overwrite a gender;
send the full Aadhaar in a chat message.

## Tests

`npm run test:udise-doc-intake` (pure module), `test:wa-template-seeds`
(both templates), `test:automation-approvals`. The seeded templates need
`scripts/wa-submit-seed-templates.mts --submit` once, then Meta approval.
