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
| 2026-09-05 | **Homework posted.** `homework_posted` — "homework posted today for 6B", "6B homework", "aaj 6B ka homework", "homework status", "kal kis class me homework nahi hua", "आज 6B का गृहकार्य". One section: each published post by subject with teacher, due date and submit flag, or "none yet" with the section's subject teachers named. No section: posts per section and the sections with nothing yet. Teachers their sections, office and leadership the school. A message with content words beyond the question ("Homework: page 42 ex 4.2", "6B homework maths ch 3") is NOT treated as a query and reaches the class channel untouched, so teachers' posts keep working. |
| 2026-09-05 | **Bus manifest.** `bus_manifest` — "Bus 3 manifest", "bus 3 ka manifest", "route A students", "which children are on bus 2". Stops in boarding order with the children due at each (class and roll), rider and stop counts, driver name with masked mobile and vehicle registration, today's boarding marks when any, and suspended riders listed apart. Route matched on bus number, route code or name, exact first then partial; several matches or none list the routes to pick from. Riders scoped to the year actually on the bus, as the driver's own manifest endpoint derives it. Gated on `transport.view`, so drivers and transport staff — not every teacher. |
| 2026-09-05 | **Student details.** `student_details` — "Riya Verma details", "student details Aarav Sharma", "Amay Gupta 4B info", "Riya Verma ki jankari", "who is Kabir Ali". Class, section, roll, admission number, gender, date of birth, blood group; father and mother with mobiles; family WhatsApp when it differs; guardian when not a parent; locality; transport route and stop from the live assignment; siblings in school; and flags for a medical note or CWSN. **Never** Aadhaar, PAN, PEN/APAAR, documents, or the medical text itself — a flag points to the ERP profile instead, and a self-test asserts the reply cannot contain them. Mobiles are shown in full to the office, leadership and the child's own class teacher; masked for everyone else, with a line saying the office can share them. Same name matching and ask-back as the fees command. |
| 2026-09-05 | **School snapshot.** `school_snapshot` — "school snapshot", "school status", "aaj ka school report", "daily summary", "how is the school doing". Fees (today, month, open dues, students owing), attendance (present %, sections marked, registers pending), staff present/absent, admissions pipeline with follow-ups due, and a "needs attention" list (documents expiring in 30 days, low stock, failed WhatsApp sends in 24h). Composed from the same `buildPrincipalSnapshot` the home page uses, plus the WhatsApp failure count from owner anomalies; a failed WhatsApp count degrades to zero rather than failing the whole reply. Office and leadership only. The trigger is anchored to the whole message so "5A attendance status", "collection report" and "commands report" keep their own commands. |
| 2026-09-05 | **Admissions this week. Phase 1 complete.** `admissions_week` — "admissions this week", "admissions report", "is hafte ke admission", "admissions this month", "new enquiries today", "इस हफ्ते के दाखिले". New enquiries with their sources, how many applied / verified / enrolled / lost, the classes asked for, why leads were lost, follow-ups overdue and due today, and the open pipeline. Period defaults to the last 7 days; "month" and "today" also work. Admissions desk, office and leadership. **All 12 Phase 1 read commands are live on WhatsApp, the staff app and the ERP assistant.** |
| 2026-09-05 | **Known gap found while building Phase 2:** the WhatsApp class channel confirms a teacher's homework and broadcasts it to parents immediately, but the ERP record is only written when a staff member later opens Comms → Class Channels in a browser (`applyClassChannelDraftToErp` is called from the React panel). Parents get the homework; the ERP may not have it. Not changed here — it is existing behaviour outside this task — but `lib/homeworkPost.server.ts` now exists to fix it server-side when you want it done. |
| 2026-09-05 | **Phase 2 begins: post homework — the first write command.** `post_homework` — "Post homework 6B maths: exercise 4.2, due Monday". Needs a posting verb, a section, and subject-then-colon-then-text; the due date is optional and points **forward** ("kal" here means tomorrow, unlike a report's "kal"). Confirm card shows the section, subject, the text as typed, the due date and how many families will be notified; on Confirm it publishes and notifies parents. **App and ERP assistant only** — on WhatsApp the class-channel bot has owned teacher homework posts since before this desk existed, so a new `channels` restriction on a command definition makes the desk step aside there entirely. Permission and section scope are re-checked at confirm time, not trusted from the card. The write itself moved into `lib/homeworkPost.server.ts`, now shared with `POST /api/v1/homework/post` so the two cannot drift. |
| 2026-09-05 | **Mark attendance.** `mark_attendance` — "Mark 5A attendance: absent roll 4, 11, 19", "5A attendance absent 4, 11 baaki present", "mark 6B attendance all present", "Mark 5A attendance: absent Riya Verma, late 7, leave 12". Everyone not named is marked present. Roll numbers and names both work; a name that matches two students, or a roll that isn't in the section, marks **nothing** and asks. The confirm card resolves rolls to names — "4. Aarav Sharma", not "roll 4" — so it can actually be checked, and shows the present count out of the roster. An already-marked register is refused with its current numbers and who marked it, unless the message starts with *correct*, which shows a replace warning on the card. Absent families are alerted on confirm, as from the app. Write path extracted to `lib/attendanceMark.server.ts`, shared with `POST /api/v1/attendance/mark`. Section scope re-checked at confirm. |
| 2026-09-05 | **Message a class's parents.** `class_message` — "Class 4 parents ko bhejo: kal PTM 9 baje", "message 5A parents: bring sports uniform", "5A ke parents ko batao: kal chutti hai". Needs a sending verb, the word *parents*, a section, and the message after a colon; the words after the colon reach families unedited. Sent as the approved **School notice broadcast** utility template with the staff member's words in it — free text is never sent raw, because most parents are outside Meta's 24-hour window. Hindi script picks the Hindi template when one is approved. If no notice template is approved the command refuses and says how to get one approved, rather than sending nothing silently. The confirm card shows the message **exactly as parents will receive it**, the family count, and how many opted out. Sending goes through `lib/waBroadcast.server.ts` (opt-out filtering, chunking, the same dispatch queue as the staff broadcast route). |
| 2026-09-05 | **Staff broadcast.** `staff_broadcast` — "Staff broadcast: meeting 3 pm in library", "tell all staff: …", "sabhi staff ko bhejo: …". Needs a staff audience word, a sending verb or *broadcast*, and the message after a colon; a parent word or a section in the head means it is the class-message command instead. Every active staff member gets a phone notification carrying the message as written, and WhatsApp goes out as the approved notice template when one is approved. With no approved template the card says WhatsApp is skipped rather than implying it sent. Office and leadership only, re-checked at confirm. |
| 2026-09-05 | **Log a family's complaint.** `raise_complaint` — "Raise complaint for Riya Verma: bus did not come today", "Riya Verma ki shikayat darj karo: …". Files against the child's household with source *office*, into the same server store the parent app and WhatsApp Flow tickets use, so it lands in one complaints queue. Category is guessed from the words (transport / fees / staff behaviour / safety / facilities / academic) and shown on the card to be checked; the workspace remains the system of record for it. The family's words are filed unedited, and the card says plainly that the family is not messaged. **Scope note:** the plan's original example, "raise complaint: 7A projector not working", is a *staff facilities issue*, not a family complaint — `StaffRequest` in `staffHr` is the right shape for it but that module is browser-side state with no server write path, so it is deferred with the other blob modules. The parser deliberately returns nothing for that form rather than filing it against some family. |
| 2026-09-05 | **Approve / reject leave** — the first command needing a new server function. `decide_leave` — "Approve Aarav's leave", "reject Kabir Ali leave: no medical certificate", "Aarav Sharma ki chutti manjoor karo". Listing pending leaves never decides one, and a decision with no name decides nothing. Two pending requests for one child asks which, listing dates and reasons. The card shows the span, type, reason, the note, and **who normally decides it** (class teacher ≤3 days, principal otherwise) so a teacher can see when they are deciding above their level. New `lib/studentLeaveDecide.server.ts` writes the decision to the database (the ERP screen decides in the browser, where nothing persists off-device) and pushes each touched register; the family is notified. **Deliberate difference from the ERP screen:** `applyLeaveToAttendance` creates a register for every date in the range, marking every *other* child present — for leave approved in advance that pre-marks a whole class on days nobody has taught. The command only touches dates already registered or in the past, and the card says how many days remain for the teacher to mark. If the decision cannot be saved to the database, the command reports the failure instead of claiming a decision that would vanish. |
| 2026-09-05 | **Fee reminders to a class's defaulters.** `fee_reminder` — "Send fee reminder to class 3 defaulters", "fee reminder 5A defaulters", "class 5 ke bakayedar ko fee reminder bhejo". Unlike a notice broadcast every family gets **different words** — their child, their amount, their overdue days — so `lib/feeReminder.server.ts` sends one templated message per recipient. Three guards, all asserted: **quiet hours** 20:00–08:00 IST (re-checked at confirm, since a card can sit until after 8 pm), **once a week per family** via a ledger in the command desk's own store slice (so the fee desk, a class teacher and an automation cannot all chase the same family on one Tuesday), and **STOP** honoured as everywhere else. The card lists every family with their own amount, plus who was skipped and why. Viewing defaulters never starts messaging. Fee desk, office and leadership only. |
| 2026-09-05 | **Payment link for a family.** `pay_link` — "Payment link for Riya Verma", "send pay link to Aarav Sharma", "Amay Gupta 4B ko payment link bhejo". Raises a Cashfree checkout for **everything the student currently owes** and WhatsApps it to the parent via the approved pay-link template. Future months are excluded — a link for money not yet owed reads as a demand for it — and the card says so. New `lib/feePayLink.server.ts` composes what the counter does across the browser and `/api/payments/attach-gateway`: build the link from open dues, mirror it into the server cache, attach the gateway with the existing `attachCashfreeToPaymentLink`, push it to the database, then send. **If the database push fails the link is not sent** — a parent must never be asked to pay against a link the school has no record of. With no approved pay-link template the link is still created and the reply hands over the URL to share manually, rather than pretending it was sent. Nothing about the payment itself is new: the checkout, the webhook that books the receipt and the WhatsApp receipt are all existing paths. Fee desk, office and leadership only. |
| next | Book PTM, bus delay notice — the last two Phase 2 commands. |

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
