# Birthday cards & greetings (2026-08-19, staff added 2026-09-22)

**Where:** Students → **Birthdays**.

**What it does**
- Finds every active student whose date of birth falls today (per-session duplicate rows counted once; 29-Feb celebrated on 28-Feb in non-leap years).
- Renders a **birthday card PNG** server-side (`/api/birthday/card`, `next/og`) in the design the school picked — Confetti · Balloons · Night stars · Pastel floral · Classic crest · Minimal bold — and in four formats: Square 1:1 (WhatsApp / Instagram), Story 9:16, Landscape (Facebook / web), A5 print. The card carries the school crest and name, the student's photo from the record (initial badge when there is none), name, class, date and a wish line (editable).
- Sends a **WhatsApp greeting to the family** (their language from Students → Family; school default otherwise) with the card: as an approved **image-header template** outside Meta's 24h window, or free text + card link inside it. Family quiet hours defer to the next tick; STOP opt-outs are enforced at send; a send log keeps each day idempotent.
- Optionally posts **one greeting a day on the school's social pages** (names-only group card by default; the student's photo card only when the school explicitly opts in — parents' consent is the school's responsibility).
- Manual per student: download PNG (any format), open WhatsApp with the message, send now, dry run.

**Setup**
1. Masters → WhatsApp templates: create and get approved a template (suggested name `birthday_greeting`, header **IMAGE**, body with variables, e.g. *"Dear {{1}}, the whole {{3}} family wishes {{2}} a very happy birthday! 🎂"*). In Students → Birthdays pick it; map body variables in order from: childName · firstName · guardianName · className · age · schoolName · cardLink.
2. Turn **Send greetings automatically** on and choose the IST hour. Save.
3. Cloud Scheduler: `bash scripts/setup-cloud-scheduler.sh` adds `bhb-birthday-tick` (hourly, `POST /api/birthday/tick`, `x-cron-secret`). The tick sends only after the chosen hour, only when auto-send is on, never twice.

## Staff birthdays (Students → Birthdays, same screen)

**What it does**
- Finds every **active** staff member whose `dateOfBirth` (Staff → HR) falls
  today, and wishes them on their **own** WhatsApp number (`mobile`, else
  `altMobile`), with the same card in the same design.
- Rides the **same daily tick and the same send hour** as the student flow.
  Auto-send is the master switch; "Wish staff on their birthday too" adds them
  to it. `force` on the tick overrides the clock but never that opt-in.
- Manual per staff member: download PNG, open WhatsApp, send now, dry run —
  a hand send works whether or not automatic staff greetings are on.

**What is deliberately different from the student flow**
- **No quiet hours and no household language.** Those belong to families; a
  colleague is their own recipient, so the school default language applies.
- **Never posted on social.** A colleague's birthday is not marketing.
- **Its own WhatsApp template.** The students' template body says
  "{{childName}} of {{className}}", so reusing it would send a teacher a
  message calling them a student. Pick a separate staff template (or leave it
  blank for free text inside the 24h window).
- **Off by default.** Staff dates of birth arrive through HR imports, and a
  wrong one is a message to a colleague.

**Who signs the card**
- Student cards: **Principal**. Staff cards: **Director**. Both take an
  optional name in Students → Birthdays → Card design; blank signs by office
  alone. The school's name is already in the card header, so the signature
  line carries only the person and the office.

**Safety**
- Card URLs are public but signed (HMAC over subject · date · design · format with `CRON_SECRET`); a tampered URL is 403. A staff card signs `staff:<id>`, so a signature minted for a student never opens a colleague's card. Previews from the office need a session.
- The send log records `subject` ("student" or "staff") beside the id, so the two never collide and a day is never sent twice on either side. Rows written before staff birthdays existed are read from the old `studentId` field and keep counting as sent, so the upgrade re-sends nothing.
- No AI anywhere in this flow — the wish text is a template the school edits.
- Module state `birthday_settings` (settings + log) syncs like every other module; nothing is stored in localStorage only.

## Staff & teacher cards (offline)

The flow above is **students only** — it reads dates of birth from the student
register and messages families. A teacher's birthday has no such record behind
it, so staff cards are made offline instead of being added to the register:

```bash
node scripts/greeting-card.mjs \
  --name "Vishnu Om Tripathi" \
  --role "Teacher · BHB International School" \
  --wish "Thank you for the care you bring to our classrooms every day." \
  --signer "<the director's name>" \
  --format square --format story
```

- Writes PNGs to `out/greeting-cards/` (gitignored) — Square 1:1 for a WhatsApp
  chat, Story 9:16 for a status. Send the file by hand; nothing is stored and no
  message goes out on its own.
- Who signs it follows who receives it: `--audience staff` (the default) signs
  from the **Director**, `--audience student` from the **Principal** — the
  person the school puts in front of children and their families. `--signer`
  is the name above that office; `--from` replaces the whole line.
- `--occasion` changes the headline ("Happy Birthday" by default), so the same
  card serves a farewell or a thank-you. `--date` overrides the printed date,
  which otherwise is today in IST.
- Needs a Chromium on the machine; it finds the usual paths, or pass `--chrome`.
