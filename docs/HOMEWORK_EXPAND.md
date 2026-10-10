# Short homework, made complete for parents

A teacher writes `5A maths hw: ex 5.2 Q1-5, due kal`. The parent used to see
`Work: ex 5.2 Q1-5`, which means nothing without the book open. The school
has mapped every class, subject, chapter and topic — 68 books, 1,538
chapters, 5,558 topics across Nursery to Class 8 — so the reference can be
resolved into the child's own book.

## The three steps

1. **Resolve** (`homeworkExpand.ts`, pure, no model). The shorthand becomes a
   pointer into the mapped curriculum, or it becomes nothing.
2. **Write** (`expandHomeworkJson`, route `homework-expand`). The model turns
   the resolved facts into the message in English and Hindi. It may name only
   what the resolver handed it.
3. **Confirm.** The expanded draft is what the teacher sees in the class
   channel before replying YES. A homework message reaches every parent in
   the section; no model sends one unseen.

## What the resolver reads

| Written | Read as |
|---|---|
| `ex 5.2`, `अभ्यास 5.2` | chapter 5, exercise 2 |
| `ch 7`, `paath 3`, `पाठ ३`, `lesson 4`, `अध्याय 9` | chapter by number |
| `Q1-5`, `प्रश्न 1 से 5` | questions |
| `pg 45-46`, `पृष्ठ 45` | pages |
| anything left over | matched against chapter titles, then topic names |

Devanagari digits are read. A **bare** `exercise 4` is deliberately *not*
chapter 4: in most books it is the fourth exercise of whatever chapter the
class is on, and the ERP does not know which chapter that is.

## What it refuses

- **A chapter the book does not have resolves to nothing.** "ch 19" of a
  twelve-chapter book tells the teacher so; it never rounds to the nearest.
- **Two editions for one subject → the teacher decides.** Which book the
  class holds is not inferable from a chapter number.
- **Words that match several chapters are ambiguous, not a pick.** Hindi
  grammar topics (संज्ञा, मुहावरे) appear in most chapters of a reader —
  that returns ambiguous, with the candidates, every time.
- **A draft that names a chapter the facts did not carry is thrown away**
  (`expansionInventsChapter`) and the plain rendering is used instead. This
  is the only check that really matters: a wrong chapter number reads exactly
  as authoritative as a right one.
- **The teacher's own words stay verbatim** as the work. The expansion adds
  context around them, never replaces them.

## Without the model

`renderHomeworkExpansion` writes the same message deterministically, in both
languages, in the same order. No key, no budget, an unparseable reply, or a
refused draft — the parent still gets book, chapter, topics, work and due
date. It is not a degraded mode to apologise for.

## Where it plugs in

`waClassChannelServer.ts` expands the draft before the teacher is shown it;
the confirmed draft carries `bodyHi` and `chapterHint` through
`classChannelErpFields` into `postHomeworkServer`, which stores the Hindi
body and puts the chapter in `aiTutorHint` — so *Ask tutor* in the parent app
opens on that chapter rather than the whole subject.

## On WhatsApp

Until now nothing sent homework to parents at all. The `bhb_homework_published`
template has been approved in **both** languages since August and the
`auto_homework_published` rule has sat in the automation seed the whole time,
but nothing ever emitted the `homework.published` event the rule waits on — so
a published post reached families as an app push and nothing else. Production
has one homework post, `whatsapp_notified_count` 0.

`homeworkWa.server.ts` sends it directly, the way fee receipts are sent, rather
than through the automation engine: homework is due tomorrow, and an approval
queue a clerk clears next morning would deliver it after the child left for
school.

- **The full message first.** Inside a family's 24-hour window they get the
  whole expansion — book, chapter, what the chapter covers, the teacher's
  words — in their own language. A shut window costs one refused send, which
  Meta does not bill.
- **The template when the window is shut**, which is most families.
  `homework_published_full` (`bhb_homework_full`) shows the subject, the book,
  the chapter and what the chapter covers **in the message** — the director's
  instruction of 18 Sep 2026 was to stop sending parents to the app for it,
  so the body names no app and carries no app button, and the help on offer
  is "reply *TUTOR* on this number", which is the same tutor on the channel
  the message already arrived on.
  Meta cannot leave a line out of a template, so `formatChapterLine` degrades
  instead: subject · book · chapter — topics, then subject · book, then the
  subject alone. Never a bare dash, never untrue. It rejects a variable
  containing a newline, a tab or four consecutive spaces and forbids an empty
  one — hence `homeworkWaLine` and `homeworkWaDue`.
- **A new family, not an edit.** An edited template goes back into Meta's
  queue and homework would stop reaching families while it sat there.
  `chooseHomeworkFamily` prefers the new one the moment it is approved in
  BOTH languages and keeps sending the old one until then — the same
  arrangement as `fees_receipt` / `fees_receipt_doc`. **It needs
  `scripts/wa-submit-seed-templates.mts --submit` and Meta's approval before
  any parent sees the chapter.**
- **Once per post** (`claimSendOnce`) and **once per family**, not per child:
  two siblings in one section share a household and a phone.
- **The family's own language**, never the teacher's.
- **Quiet hours are not consulted**, for the same reason a receipt ignores
  them: this is not the school deciding to write to a family, it is work their
  child has to do, usually by tomorrow. Held until 8 a.m. it would arrive after
  the child left.

The class channel used to text-broadcast every confirmed draft to parents.
Plain text only reaches an open 24-hour window, so for most families it
silently failed while the teacher was told the class had been informed. On the
homework path that broadcast now goes to the co-teachers only, and the families
are reached through the template — with the old text broadcast kept as a
fallback for the case where the ERP write itself fails.

## The work comes back the same way

The message ends with "send a photo of the work to this number — it goes
straight to the subject teacher", and that is literally what happens.

1. **A parent photographs the finished work** and sends it. The webhook tries
   homework *before* the document intake, and only when homework is actually
   open for that family — the same gate the transport pin uses. Without it,
   every Aadhaar card a parent sends would be filed as somebody's classwork.
2. **Which homework** is decided by `chooseSubmissionTarget`: one candidate is
   obvious; a caption naming one child or one subject decides; a bare number
   answers the list we just sent. Anything else **asks**. Filing a child's work
   against their sibling's homework is a small humiliation for both of them and
   the teacher cannot tell it happened.
3. **It is filed** — one row in `homework_desk_submissions`, `channel`
   `whatsapp`, the photo to the child's Drive folder — and the desk shows it as
   received, with the code the teacher can reply with.
4. **The subject teacher gets it** on WhatsApp: the child, the class, the
   homework, the parent's own words, the photo itself, and a four-character
   code.
5. **The teacher replies `#A7K2 well done`** and the family reads exactly
   those words. Nothing is graded or marked by this; it is a remark.

### Why this matters more than convenience

Meta delivers free-form text only to a family that has messaged the school
within 24 hours. That single rule is why this ERP leans on approved templates
for everything and waits on Meta's queue to change a sentence. **A family that
has just sent their child's homework has opened that window themselves** — so
for the rest of that day the school can simply talk to them, and the teacher's
remark goes as plain text with no template at all. A loop the parents start
keeps the door open.

### What it will not do

Guess which child; accept a photo when no homework is open (it hands the image
back to the document intake, which is the right reader for an Aadhaar card);
mark or grade anything; rewrite a teacher's words. And a code that matches no
submission is handed on to the office relay, which uses the same code shape —
homework is checked first so the answer never depends on which table was read
first.

### Sent twice

`homework_desk_submissions` is UNIQUE on (post_id, student_id). Meta
re-delivers any webhook it does not get a prompt 200 for, and that
re-delivery races the desk read which filters out work already submitted — so
the second insert loses with a 23505. That is not a failure: the child's
homework IS recorded. It is answered with "we already have this", and the
teacher is not sent a second copy of the same photograph.

### A wipe this had to avoid

`pushHomeworkDeskToDb` upserts whole submission rows, so a column the desk
state does not carry is a column the next desk save resets to its default.
`channel`, `replyCode`, `teacherRemark`, `remarkAt` and `driveNote` are
therefore on the `HomeworkSubmission` type, in both row mappers **and** in
`normalizeSubmission` — the normaliser that sits between the read and the push.
This is the shape of the fee-line wipes of September 2026.

## The known gap

Nothing in the ERP knows where a class currently *is* in its book. Positional
shorthand resolves (that is most of it), but "revise today's lesson" or "do
the worksheet" cannot, and those go out as written with no chapter named.
Closing it needs either the teacher's recent posts as a running position or
one "which chapter?" quick reply remembered per class — which would also be
the syllabus-progress signal `nucleus_progress_rows` was meant to carry and
never has.

## Tests

`npm run test:homework-expand` — the parser (including Devanagari and the
bare-exercise refusal), resolution by position, title and topic against the
school's real Class 5 Maths chapters, the out-of-range and two-edition
refusals, the invented-chapter guard, and the plain rendering in both
languages.
