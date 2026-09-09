# Online classes

Live classes a teacher runs over a video link, scheduled against a section
in the ERP, announced to the section's parents on their phones, joined from
the parent app, with a record of who joined.

## What is where

| Piece | Path |
|---|---|
| Tables | `supabase/migrations/20260909100000_online_classes.sql` — `online_class_sessions`, `online_class_joins`, `google_staff_connections` |
| Rules (pure, self-tested) | `apps/web/src/lib/onlineClasses.ts` + `onlineClasses.selftest.ts` |
| Persistence, announce, remind, Meet sync | `apps/web/src/lib/onlineClasses.server.ts` |
| Google Meet REST v2 | `apps/web/src/lib/googleMeet.server.ts` |
| Per-staff Google grant (DB, was disk) | `apps/web/src/lib/googleClassroom.store.server.ts` |
| Staff API | `GET/POST/PATCH /api/v1/staff/online-classes`, `GET/POST /api/v1/staff/online-classes/:id/attendance` |
| Parent API | `GET /api/v1/parent/online-classes?studentId=`, `POST /api/v1/parent/online-classes/join` |
| Cron | `POST /api/online-classes/tick` every 5 min 07–21 Mon–Sat (`scripts/setup-cloud-scheduler.sh`) |
| Desk | `/online-classes` → `components/online-classes/OnlineClassesWorkspace.tsx` |
| App | parent tile "Online class", teacher tile "Online classes" (`online_class_host` mobile feature) |
| RBAC | module `online_classes`: admin full, office view/create/edit/export, teacher view/create/edit |

## The two ways a room exists

- **`google_meet`** — the ERP creates a Meet space on the *teacher's own*
  Google Workspace account through the Meet REST API, so the teacher is the
  host. Needs the teacher to have connected Google once (Online classes →
  Connect Google, or Homework → Classroom; one grant covers both). The
  space is `OPEN` (no knocking) because a class of thirty cannot wait to be
  admitted; the teacher can tighten it in the call.
- **`link`** — anybody with `online_classes.create` pastes a URL. Only https
  and only meeting hosts (Meet, Zoom, Teams, YouTube, Jitsi, Whereby, Webex):
  a link is pushed to every household in a section.

## The clock

All times are IST wall-clock strings (`date` + `HH:MM`), the school's own
bell words. Parents can join from **10 minutes before** the start; a class
nobody ended is closed **30 minutes after** its end time by the tick; the
"starting soon" push goes **15 minutes before**, once. `status` is what a
person said (scheduled / live / ended / cancelled); `phase` is what the
clock says on top of it (upcoming / joinable / live / over / cancelled).

## "Joined" is not the register — but it can propose one

`online_class_joins` records a family tapping Join inside the window, or a
Meet participant whose display name matched exactly one child on the
roster. It is a record of presence, not an attendance mark.

**Mark register from this class** (desk drawer and the app's Who-joined
sheet) turns it into one, with the teacher as author: the roster is
pre-filled — a register already marked for that date wins, otherwise
joined → P and everyone else → A (`proposeRegisterStatus`, self-tested) —
the teacher corrects, then saves. The save goes through
`POST /api/v1/staff/online-classes/:id/mark-register`, which needs
`attendance.edit` (the register's own permission, not the online-class
one) and calls `markAttendanceServer`, the same path as the Attendance
screen: register upsert, DB push, absent alerts to families, audit row.

## One-time setup still needed (not code)

1. **Enable the Google Meet REST API** on the GCP project that owns the
   OAuth client (`GOOGLE_OAUTH_CLIENT_ID`). Without it every Meet creation
   answers 403 and the form falls back to "paste a link".
2. The OAuth consent screen is Internal (Workspace only); the two new
   scopes `meetings.space.created` / `meetings.space.readonly` need no
   verification. Teachers who connected Google before 2026-09-09 must
   reconnect once — their grant carries no Meet scope, and the desk says so.
3. Run `scripts/setup-cloud-scheduler.sh` to create `bhb-online-classes-tick`.
4. Teachers need `@bhbinternational.school` accounts to host Meet rooms; a
   teacher without one pastes a link made on their phone.

## In-class questions, photographed answers, the after-class note

Added the same day (migration `20260909150000_online_class_qa.sql`; pure
rules in `lib/onlineClassQa.ts` + self-test; persistence in
`onlineClassQa.server.ts`).

- **Ask.** During a live class the teacher types a question (desk drawer
  "Questions & answers", or the app's Q&A screen). It is stored and pushed
  to every household in the section with a deep link to the answer screen.
- **Answer.** The child writes in the copy; the parent app photographs it
  and posts `multipart` to `/api/v1/parent/online-classes/answer`. Bytes
  are sniffed (JPG/PNG/WebP only, ≥200px, ≤8 MB) and stored privately at
  `school-files/online-classes/<session>/<question>/<student>.<ext>`. A
  second send replaces the first and clears the verdict. Photos are
  served by `/api/v1/online-classes/answer-photo/:answerId` to the family
  that sent it or staff in the section's scope — never `/api/file`, which
  is staff-only.
- **Check.** The teacher's wall lists answers by name and roll number as
  they arrive (polls every 8 s while the class is on), with right / wrong /
  partly buttons. The mark is always a person's; the family is pushed the
  result at once. A question can be closed to stop late answers.
- **Summary.** After the class the teacher writes one line on what was
  taught; `generateOnlineClassSummaryJson` (router route
  `online-class-summary`) expands it into a topic, a paragraph for the
  record and a homework task, using only the teacher's line and the class's
  own numbers (joined count, per-question tallies). The draft is saved to
  `online_class_summaries`; the teacher edits it; **Post homework** goes
  through `postHomeworkServer` behind `homework.edit`, exactly as the
  Homework screen would, and records the post id so it cannot be posted
  twice.
- Not read from the Meet audio: the API gives no transcript, and a
  recording needs a Workspace tier plus consent. The teacher's line is the
  truth of the lesson.

## Not built (deliberately, for now)

- WhatsApp announcements. Meta has 9 approved templates and none fits; the
  push notification is what parents get. Add a template when there is one.
- Recording / material attachments. Homework already carries links.
- AI reading of the handwritten answer as a hint. The teacher checks; a
  guess on a child's work is worse than a slower teacher.
- Web parent portal tab. The app is where parents are.
