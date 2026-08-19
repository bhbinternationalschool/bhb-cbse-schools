# Student birthday cards & greetings (2026-08-19)

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

**Safety**
- Card URLs are public but signed (HMAC over student · date · design · format with `CRON_SECRET`); a tampered URL is 403. Cards for staff previews need a session.
- No AI anywhere in this flow — the wish text is a template the school edits.
- Module state `birthday_settings` (settings + log) syncs like every other module; nothing is stored in localStorage only.
