# Puter — the free AI layer, and its fence

Puter (`js.puter.com`) gives a web app free `txt2img`, `img2txt`, `chat` and
`txt2speech` with **no API key and no server call**. This repo uses two of
them, on two staff-only screens, behind a flag that is off by default.

This document is mostly about what we deliberately did *not* do with it.

## Why it is free, and what that costs us

Puter runs on a **"User Pays"** model. The call executes in the visitor's
browser; the app has a small free allowance, and once that is spent **the
visitor** is asked to sign in to a Puter account.

Three consequences decide everything:

| Consequence | What follows |
|---|---|
| The call runs in a browser | Nothing server-side can use it — not `aiLlm.server.ts`, not the WhatsApp bots, not cron. Our actual AI spend is mostly there, and it is untouched. |
| A sign-in popup can appear | Nothing parent-facing may use it. A popup in front of a parent at a gate ends the flow. Staff screens only. |
| The data leaves India, to a third party | No student data, ever. Under the DPDP Act 2023 we have no consent for that transfer. |

So Puter is not a replacement for Gemini / OpenAI / Google Vision. It is a
free first pass in front of them, on work that carries no personal data.

## What is switched on

Set `NEXT_PUBLIC_PUTER_ENABLED=true` (exactly that word — `1` and `TRUE`
both mean off). Nothing else is needed: there is no key to obtain.

### 1. Admissions → Marketing → artwork

`components/admissions/MarketingArtwork.tsx` · `txt2img`

The copy generator above it already writes the words. This draws the picture
to put them over. There is **no paid path behind this one** — before it, the
office had no artwork at all — so if Puter is off the card is simply not
rendered.

Two rules are baked into the prompt and are not settings:

- **No text in the picture.** Image models render words as convincing
  nonsense, and a poster that invents a result percentage or a fee is a
  CBSE/ASCI problem, not a typo. The ERP's own accepted copy goes over the
  image afterwards.
- **No recognisable faces.** A generated child's face is a consent question
  nobody can answer. The prompt asks for children from behind, at a
  distance, or in silhouette.

Nothing is saved. The image lives in the tab until it is downloaded, which
keeps an unapproved draft out of the ERP.

### 2. Teaching → "Scan page" free first pass

`components/teaching/SyllabusOcrImport.tsx` · `img2txt`

A teacher photographs a printed textbook contents page. We now try Puter
first, in the browser, for nothing; its text goes to **the same parser** the
pasted-list path already uses, and lands in **the same review list** with the
same confidence marks and the same "nothing is saved until you confirm"
promise. The teacher sees one button and one flow, plus a line saying which
engine read the page.

It falls back to Google Vision, silently, whenever:

- the flag is off, the CDN is unreachable, or the SDK times out (12s);
- the staff member closes the Puter sign-in popup;
- the free allowance is spent (this one, and only this one, also shows a
  line saying so);
- the read is **thin** — `ocrFirstPassUsable()` rejects a result under 40
  characters, under 3 lines, or mostly non-letters. Half a contents page
  presented as a whole one is worse than no scan.

A printed textbook page carries no student data. That is precisely why this
surface is cleared and no other OCR path is — not the Aadhaar reader, not
the admission documents, not the bills.

## The fence

`lib/puterAi.ts` is pure and has no browser dependency, because a rule that
needs a browser to test is a rule nobody tests. `puterAi.selftest.ts` pins
it, and CI runs it (`npm run test:puter-ai`).

`assertPuterSafe(surface, text)` runs **before the SDK script tag is even
injected**, so a refused prompt never reaches Puter's CDN, let alone its
models. It refuses anything matching:

| Pattern | Catches |
|---|---|
| `\d{4}[\s-]?\d{4}[\s-]?\d{4}` | Aadhaar, APAAR |
| `(+91)?[6-9]\d{9}` | mobile numbers |
| `…@….tld` | email |
| `\d{8,}` | UDISE codes, any long id |
| `d/m/yyyy` | dates of birth |
| `ABCD0XXXXXX` | IFSC / bank codes |

Small numbers stay allowed on purpose — a fence that refused "Class 10" or
"42 seats" would simply be switched off, and a rule nobody can work with
protects nobody.

Adding a third surface is a decision, not an import: it goes in
`PUTER_SURFACES` **with its fallback named**, or `puterSurface()` throws.

## What we deliberately did not use

| Puter offers | Why not |
|---|---|
| `puter.ai.chat` for the tutor / drills | It is parent- and student-facing. A sign-in popup in front of a child, and their questions leaving our servers. |
| `puter.ai.chat` server-side to cut token spend | Impossible — browser only. |
| `puter.ai.txt2speech` for parent notices | Parent-facing, same popup problem, and the notices carry names and dues. |
| `puter.fs` / `puter.kv` | We have Supabase. Student records do not move to a third party to save nothing. |
| `puter.hosting` | We have Cloud Run and a mapped domain. |
| `img2txt` on Aadhaar / admission docs / bills | Personal data. Stays on Vision. |

## Turning it off

Remove `NEXT_PUBLIC_PUTER_ENABLED` (or set it to anything but `true`) and
redeploy. The artwork card disappears; the scan button goes back to Vision.
No data migration, because nothing was ever stored.
