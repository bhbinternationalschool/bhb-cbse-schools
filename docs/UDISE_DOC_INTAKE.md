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
3. **Read.** Gemini vision with `UDISE_DOC_EXTRACT_SYSTEM` (copy what is
   printed, never complete a number, a year alone is not a DOB).
   `parseUdiseDocExtract` drops anything that fails its rule: Aadhaar must be
   12 digits *and* pass the Verhoeff checksum (`lib/aadhaar.ts`), DOB must be
   a full ISO date, PIN six digits.
4. **Match.** One child → that child. Several → the name on the document or
   in the caption must pick exactly one, else nothing is written and the
   parent is asked to resend with the child's name. A parent's own Aadhaar
   applies to every child of the household.
5. **File.** Drive under `students/<id>`, vault slot `aadhaar` / `birthCert`
   / `addressProof` set to *received* with the proxy URL. A parent's Aadhaar
   has no slot; it is kept in the first child's Drive folder.
6. **Correct.** `planUdiseCorrections` decides per field, deterministically:
   - a name is changed only as a *spelling* variant of the name on record
     (`compareNames`: ≤25 % edit distance after stripping honorifics); a
     different name holds everything back for the office;
   - DOB and Aadhaar are written when valid; gender is filled, never flipped;
   - address + PIN go on the household.
   Student writes use `pushSisToDb` on a freshly read row, so the revision
   guard refuses a stale write; an audit row is written with Aadhaar masked.
7. **Tell.** Parent: a short ack in their template language, masked Aadhaar.
   Office (owner, principal, admin, office, accounts by RBAC role): WhatsApp
   text inside their 24h window, template `udise_doc_received`
   (`bhb_udise_doc_received`) outside it, a push, and an ERP inbox item — the
   message lists *Updated in SIS*, *Needs your decision*, and *Change in
   UDISE+ portal* in the portal's own field names.

## What it will never do

Write a number that fails its checksum; turn a year into a birthday; put a
stranger's card on a child because the surname matched; overwrite a gender;
send the full Aadhaar in a chat message.

## Tests

`npm run test:udise-doc-intake` (pure module), `test:wa-template-seeds`
(both templates), `test:automation-approvals`. The seeded templates need
`scripts/wa-submit-seed-templates.mts --submit` once, then Meta approval.
