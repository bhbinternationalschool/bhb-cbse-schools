# ERP Command Desk — run the ERP by sending it a message

Plan, September 2026. Companion to `AI_ROADMAP_2026-08.md`.

Staff send a text or voice note on WhatsApp, or speak into the mobile app, and the ERP
does the work. Reads are answered at once. Anything that changes a record is shown back
first and runs only after a "yes".

| | |
|---|---|
| Channels | WhatsApp · voice in the staff app · ERP assistant |
| Commands in first release | 22 (12 read, 10 write) |
| Build, one developer who knows the codebase | 33–42 working days (7–9 weeks) |
| Money, payroll, masters, results | stay inside the ERP for now (see *Later*) |

## Status

| Date | Done |
|---|---|
| 2026-09-05 | **Phase 0, WhatsApp branch shipped.** Command engine (`lib/erpCommands.ts` pure + `lib/erpCommands.server.ts`), staff command branch in the unified WhatsApp bot for owner / staff / teacher flows, voice-note transcription for commands, regex-first parse with LLM fallback (`generateErpCommandJson`), RBAC via the sender's staff record, section scope via `staffAllowedSections`, confirm-card plumbing for future write commands, director pause switch (`commands off` / `commands on`), per-staff hourly cap, audit rows in `erp_commands`. First commands live: **absent list for a section** and **COMMANDS help**. Kill switch: `ERP_WA_COMMANDS=off`. Migration `20260905100000` widens the bot-slice constraint for the new `commands` slice. |
| 2026-09-05 | **Mobile command bar shipped.** `POST /api/v1/commands` runs the same engine for the staff app (keyed by staff id, channel `app`); `StaffCommandBar` (text + on-device Hindi/English speech, one-tap suggestions, Confirm/Cancel for future write cards) sits at the top of the teacher and principal home screens. Migration `20260905100000` applied to the BHB School Supabase project. |
| 2026-09-05 | **ERP assistant hookup shipped.** The floating assistant runs the command engine for staff before page guides and the model, so "5A me aaj kaun absent hai" typed into the ERP returns the list instead of a guide. Confirm / Cancel buttons render in the chat for future write cards; an "ERP commands" quick prompt shows the help. Same engine, channel `app`, keyed by staff id. |
| 2026-09-05 | **Director's daily digest shipped.** `POST /api/erp-commands/digest/tick` (Cloud Scheduler job `bhb-erp-commands-digest-tick`, 19:20 / 20:20 / 21:20 IST, sends once after `ERP_COMMANDS_DIGEST_HOUR`, only on days with commands) reads the day's `erp_commands` audit rows and sends every owner-designated staff member one WhatsApp message: totals, by command, by channel, by person, every write, every denial. Falls back to an approved template (`ERP_COMMANDS_DIGEST_TEMPLATE`) when the director's 24-hour window is closed; a phone push goes alongside. The director can also pull it any time with **commands report**. **Phase 0 complete.** |
| 2026-09-05 | **Phase 1 started: a student's pending fees.** `student_fees` — "Amay ki fees pending", "show me all dues of Aarav Sharma", "fees Amay Gupta 4B", "roll 12 4B fees", Hindi too. Name matching per word prefix with class/roll narrowing; two matches → asks back with class and roll. Reply: total due now with overdue-since, by month, by head with concession applied, pay-ahead months, last receipt, masked parent mobile. Fee desk / leadership see the concession policy name and a sibling line; class teachers see net figures for their own sections only. Same ledger computation as the counter (`computeHouseholdDues`), scoped to the session year. Devanagari matching fixed across the parser. |
| 2026-09-05 | **Today's attendance summary.** `attendance_summary` — "attendance summary", "aaj ki attendance", "kal ki hazri report", "आज की उपस्थिति" (attendance words with no section; a section means the absent list). Office and leadership get the school: present % with counts, sections marked vs pending (holiday sections excluded per class-group holiday policy), per-class line with per-section present/total, and staff present / absent / leave with the names not punched in. Teachers get the same for their own sections, no staff line. Same registers and holiday classification as the principal snapshot. |
| 2026-09-05 | **Class defaulters.** `class_defaulters` — "Class 3 defaulters" (whole class, grouped by section), "5A defaulters", "class 5 ke bakayedar", "fees pending list 7B", "class 3 me kisne fees nahi di", "कक्षा 3 के बकायेदार". Count and total overdue, then each student with amount, days overdue, oldest due date, and a plan marker; capped at 30 with a pointer to Fees → Defaulters. Same rows as the fee desk's playbook (`listLiveDefaulters`). Fee desk / office / leadership see any class; teachers only their sections, and a whole-class ask is trimmed to those with a note. A name in the message still means one student's ledger. The Hindi "कक्षा" now resolves as a class word. |
| 2026-09-05 | **Today's collection.** `collection_today` — "aaj ka collection", "today's collection", "kal ka collection", "collection report", "aaj kitna cash aaya", "आज का कलेक्शन". Total and receipt count, by payment mode (gateway tenders shown as "Online (Cashfree)"), cheques awaiting clearance, receipts by counter / paper book / online link, by cashier when more than one, day-close status with cash over/short, and month so far. Live (non-voided) vouchers of the session year, same rows as the fee desk. Fee desk / office / leadership only. |
| 2026-09-05 | **Free teachers in a period.** `free_teachers` — "who is free in period 3", "period 3 me kaun free hai", "3rd period khali kaun hai", "abhi kaun free hai" (current period by IST bell times; a break counts as the period about to start), "free teachers next period", "kal 5th period kaun khali hai". Free = active teaching staff not on the grid that period, not substituting, not time-blocked, not absent (staff attendance A / LE / HD). Listed lightest load first with periods that day and substitutions given; then the period's uncovered classes for absent teachers, and substitutions already arranged. Non-working weekday, before school, after school and unknown period all answer plainly. Anyone with timetable view. Known gap: approved leave requests are browser-side state today, so server-side absence comes from the staff attendance register only. |
| 2026-09-05 | **Pending student leaves.** `pending_leaves` — "pending leaves", "leave requests", "5A leave requests", "kitni chutti pending hai", "leave approvals", "कितनी छुट्टी बाकी है". Requests awaiting approval, oldest first: student, class, roll, dates with day count, type, reason (trimmed), how long ago, and who approves (class teacher ≤3 days, principal otherwise); plus how many students are on approved leave today. Teachers see their sections, office and leadership the school; a class-section narrows. Same reset-then-hydrate read as the parent app's leave list. Staff leave is not included — staff HR state is browser-side today. |
| next | Homework posted, bus manifest, student details, school snapshot, admissions this week. |

## Where commands are given

All three channels feed **one command engine** on the server, so a command means the same
thing wherever it is typed or spoken.

1. **WhatsApp to the school number (primary).** Text or voice note from a staff member's
   registered mobile; reply in the same chat; writes arrive as a card with *Confirm* /
   *Cancel* buttons.
   Already built: `waRoleResolver` identifies staff by mobile, `sarvam.server.ts` /
   `googleSpeech.server.ts` transcribe Hindi and English, `waInteractive.ts` renders buttons.
   Missing: a staff command branch in `app/api/wa/webhook`.
2. **Mic in the staff mobile app (hands-free).** Hold the mic, speak, see the result. For
   teachers in class and the transport desk on the road.
   Already built: dictation (`dictate_field.dart`). Missing: a command bar that posts the
   transcript to the engine and renders the confirm card.
3. **ERP assistant, inside the ERP (desk).** The floating assistant (`ErpAiChatbot`) today
   explains and navigates; it becomes the same engine with a screen for tables and links.

## How one command travels

1. **Identify** — sender's mobile or login → staff record → RBAC roles and class links
   (`waRoleResolver`, `rbac.ts`). Unknown numbers get nothing.
2. **Understand** — the LLM (OpenAI/Gemini, already configured in `aiLlm.server.ts`)
   picks one command from a fixed catalogue and fills typed fields. Names → IDs from
   masters: "5A", "Aarav Sharma", "Bus 3".
3. **Check** — `hasPermission(module, action)` exactly as the screen does; teachers only
   touch their own sections (`staffAllowedSections`). Ambiguous matches are asked back.
4. **Confirm** — reads run at once; writes are shown as a card (what changes, for whom),
   run on "yes", expire after a few minutes.
5. **Do and record** — the engine calls the same server function the `/api/v1` routes
   call. Every AI-initiated write goes to `writeAudit` tagged `ai-command` with the
   original message.

The AI never writes to the database directly. It only calls functions the mobile app and
ERP screens already call, so the list of commands and the list of things it can break are
the same list.

## Phase 0 — foundation (12–15 days)

| Piece | What it is | Effort |
|---|---|---|
| Command engine | Catalogue with typed fields, LLM intent + field extraction, name→ID resolution, RBAC check, confirm token, audit write. `lib/erpCommands.server.ts` | 5–6 d |
| WhatsApp staff branch | New branch in the inbound webhook for staff senders: text / voice note in, reply + confirm card out | 3 d |
| Mobile command bar | Mic + text bar on staff home; result and confirm card | 2–3 d |
| Assistant hookup | `ErpAiChatbot` sends to the engine; renders tables, links, confirm card | 1 d |
| Controls | Director-only on/off switch in Masters, daily digest of AI actions to the director, rate limits | 1–2 d |

## Phase 1 — read commands, answered at once (12 commands, 7–9 days)

| You say | You get | Who | Effort |
|---|---|---|---|
| `5A me aaj kaun absent hai` | Absent list for the section today, count, whether marked at all (`attendance/roster`) | Class teacher, principal, director | 0.5 d |
| `Today's attendance summary` | Present % by class, unmarked sections, staff not punched in | Principal, director | 1 d |
| `Aarav Sharma ki fees pending` | Dues by head, last receipt, concession, parent mobile; asks back on duplicate names (`fees/ledger`) | Fee desk, principal, director | 1 d |
| `Class 3 defaulters` | Overdue students in the class, total outstanding | Fee desk, principal, director | 0.5 d |
| `Aaj ka collection` | Today's receipts by mode, day-close status (`receipts`) | Fee desk, director | 0.5 d |
| `Who is free in period 3 today` | Free teachers + today's substitution summary (`ai/substitution-summary`) | Principal, coordinator | 1 d |
| `Pending leave requests` | Student and staff leave awaiting approval (`leave/list`) | Class teacher, principal | 0.5 d |
| `Homework posted today for 6B` | Today's homework by subject, or "none yet" with teachers named (`homework/feed`) | Teaching staff, principal | 0.5 d |
| `Bus 3 manifest` | Route students, stops, driver/attendant, today's boarding (`transport/manifest`) | Transport desk, director | 0.5 d |
| `Riya Verma details` | Class, section, roll, parent mobiles, route, house. No documents, no Aadhaar | Office, class teacher, principal | 0.5 d |
| `School snapshot` | `principal/snapshot` + `owner/anomalies` as one message | Principal, director | 0.5 d |
| `Admissions this week` | Leads, visits, applications, conversions | Admissions, director | 1 d |

## Phase 2 — write commands, run after "yes" (10 commands, 14–18 days)

Ordered by server readiness. The first five reuse functions the mobile app already calls.

| You say | After confirm | Who | Effort |
|---|---|---|---|
| `Post homework 6B maths: exercise 4.2, due Monday` | Homework created (`homework/post`) | Subject teacher of that section | 1 d |
| `Mark 5A attendance: absent roll 4, 11, 19` | Others present, named rolls absent; rejected if already marked, offers correction (`attendance/mark`) | Class teacher | 1.5 d |
| `Class 4 parents ko bhejo: kal PTM 9 baje` | Approved WA template filled and sent to the class (`staff/broadcast`); free text never sent raw | Class teacher own sections, principal any | 1.5 d |
| `Staff broadcast: meeting 3 pm in library` | In-app + WA to all staff or a group (`owner/broadcast`) | Principal, director | 1 d |
| `Raise complaint: 7A projector not working` | Complaint created and routed (`complaints/create`) | Any staff | 0.5 d |
| `Approve Aarav's leave` | Pending student leave approved, parent informed. **Needs a server approve function** — approval lives only in `student-leave-desk` today | Class teacher, principal | 2–3 d |
| `Send fee reminder to class 3 defaulters` | Reminder template per parent with own amount; quiet hours + once-per-week rule | Fee desk, director | 2 d |
| `Payment link for Riya Verma, term 2` | Cashfree payment link for exact dues, sent to parent; receipt still posts via existing webhook | Fee desk, director | 2–3 d |
| `Book PTM slot for Riya Verma, 10:30` | Slot booked for the parent, parent notified. `ptm/book` is parent-only today; staff variant added | Class teacher, office | 1.5 d |
| `Bus 3 ko batao: 20 minute late` | Delay notice to parents on the route via transport template | Transport desk, director | 1 d |

Every write command also understands "undo" within the same conversation where the record
allows it (unpost homework, cancel unsent broadcast, cancel a payment link). Deleting
anything older is never available by command.

## Later — what stays inside the ERP for now

These modules save whole-module state blobs from the browser (`fees_state`,
`payroll_state`, `exams_state`, `school_comms_state` …) with the guards in the browser
(`sessionWriteGuard`, `mastersWriteGuard`). The server has no safe single-record write
path yet. The collection registry (`lib/data/registry.ts`, `desk_writable_tables`) fixes
this module by module; the estimate is that migration before any command.

| Module | Why | Before commands |
|---|---|---|
| Fee receipts, refunds, concessions, day close | Money movement; highest audit risk | 2 wk, then 1 wk of commands |
| Payroll run, salary changes, advances | Statutory output; stays two-person | 2 wk |
| Student / staff master edits, admissions status | Identity records feed everything | 1–2 wk |
| Exam marks entry, result publishing | Publishing is already an approval-gated decision | 1–2 wk |
| Notices and holiday announcements | Same blob style; a small server function unlocks "announce holiday tomorrow" | 3–4 d |
| Year close, fee structure, timetable | Rare, high consequence | not planned |

## Rules that hold in every phase

- **Staff only.** Parents, visitors, unknown numbers can never trigger a command, and their
  messages are never passed to the engine as instructions (prompt-injection boundary).
- **Same permissions as the screen.** Owner-only stays owner-only.
- **Every write shows before it runs.** Confirm cards name students, class, amount, template.
- **Everything is logged.** Audit carries message, sender, channel, resolved command; the
  director gets a daily digest.
- **Ask, do not guess.** Duplicate names, class without section, amount not matching the
  ledger → ask back.
- **Templates only, outward.** Anything to parents uses an approved WA template.
- **Quiet hours and limits.** Existing quiet-hour rules apply; one confirm per write;
  per-user hourly cap.
- **One switch.** Director can pause the command desk in Masters; WhatsApp then replies
  "commands are paused".

## WhatsApp cost per message (Meta, India)

| Message | Until 30 Sep 2026 | From 1 Oct 2026 |
|---|---|---|
| Staff → school number (inbound) | free | free |
| Reply to staff inside 24-h window (result, confirm card, "done") | free | ~₹0.115 |
| Utility template to a parent (receipt, due reminder, PTM slot, bus delay) | ~₹0.115 outside a window, free inside | ~₹0.115 always |
| Marketing template (admissions, events) | ~₹0.78 | ~₹0.78 |

Design rule that follows: one reply per command (result and confirm card in a single
message), no "processing…" messages. Heavy users (fee desk) can use the mobile app command
bar, which costs nothing per message.

## Timeline

| Weeks | Work | Days |
|---|---|---|
| 1–3 | Phase 0. Ends with `5A me kaun absent hai` working on WhatsApp for one class teacher | 12–15 |
| 3–5 | Phase 1 reads, rolled out to principal, fee desk, class teachers as each lands | 7–9 |
| 5–9 | Phase 2 writes; homework and attendance first, money-adjacent last | 14–18 |
| **Total** | One developer. Running cost ≈ one LLM call per command, plus WA replies to staff: free inside the 24-hour window until 30 Sep 2026, then ~₹0.115 per reply (utility rate, India) from 1 Oct 2026. 50 staff × 10 commands/day ≈ ₹60/day | **33–42** |
