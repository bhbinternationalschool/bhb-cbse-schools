# Revision drill — ask, check, correct, ask again

The evening before each paper, `lib/examEve.ts` already finds the child's
next exam and offers a **Start practice** button. What the button used to do
was hand a chat model one sentence — *"ask 5 practice questions, one at a
time, easiest first; after each answer say whether it is right and why"* —
and hope.

A chat model given that instruction loses count, accepts a wrong answer as
nearly right, drifts onto a chapter the class has not reached, and stops when
the child says "ok". None of which anybody sees.

So the loop now lives on the server. The model is used for the two things
only a model can do — **write one question** and **judge one answer** — and
everything else is decided by `nextDrillStep` from state the database holds.

## The loop

| | |
|---|---|
| Ask the scope | Which chapters the class has covered. Always first. |
| Ask a question | One, from chapters 1..scope, at the child's class level |
| Mark the answer | `right` / `close` / `wrong` |
| Correct | What went wrong, then how to do it |
| Ask again | A **different** question on the same idea |
| Finish | 3 right in a row, or 12 questions, whichever comes first |

`close` is the right method with a slip — an arithmetic error, a spelling, a
missing unit. It holds the streak rather than resetting it: punishing a child
who had the method right and the arithmetic wrong teaches the wrong lesson.

## Nothing is asked from outside what the class has been taught

**No record in this ERP says which chapters a paper covers.** The date
sheet's notes describe the paper ("Maths — Oral & Written"), not the portion,
and `nucleus_progress_rows` is empty, so there is no "how far has the class
got" either.

Rather than guess, the drill **asks the child**, from the real chapter list
of their own book (`school_textbooks` / `school_textbook_chapters`), and
never sets a question beyond their answer. Two guards behind that:

- the prompt only ever contains chapters within the scope;
- `parseDrillQuestion` throws away a question the model itself places beyond
  it, so the child sees nothing rather than a question about a chapter they
  have never been taught, the night before their paper.

And when the school's book for that class is not loaded, **the drill does not
run at all** — it hands back to the ordinary tutor rather than setting
questions from the model's memory of some other school's syllabus.

## A wrong answer is never just "wrong"

`parseDrillCheck` refuses a marking that calls an answer wrong and then says
nothing about why. The reply is what went wrong, in plain words, then the
method with the step they missed — and only then the next question, so the
correction is read before anything else is asked.

The re-ask is a **different** question on the same idea. Repeating the
identical question teaches a child to recall an answer, not to do the work.

## What the question is set from (agreed outcomes only)

Left to the chapter name alone, the model decides what a chapter teaches, and
two questions on one idea come back under two names — "unitary method", then
"value of one" — so "already tested this session" never sees the repeat.

Where a teacher has **agreed** with a chapter's learning outcomes (Teaching →
Learning outcomes), the drill has something better: the CASE components of
those standards, a fixed vocabulary of micro-skills. `lib/drillSkills.ts`
turns them into a numbered menu under the chapter list, the model puts the
number it used in `skillRef`, and the question is stored against that
**component id** rather than against a sentence it wrote.

Three things that follow, in the order they matter:

- **Nothing is widened.** The menu only narrows. A chapter nobody has agreed
  outcomes for contributes nothing, and the prompt is then exactly the one it
  was before any of this existed. Classes 1–2, Science and English carry no
  components at all, so for them this is a no-op by construction.
- **Only agreed outcomes reach it.** The read goes through
  `learning_chapter_outcomes`, which cannot show a match a teacher has not
  agreed with. See `docs/` on the Learning outcomes tab.
- **A number is checked before it is believed.** `parseDrillQuestion` reads a
  `skillRef` outside the menu it actually listed as 0. A wrong attribution is
  worse than none — it is what the next wrong answer would be walked back
  from.

## What sits underneath a wrong answer

A component belongs to a standard, and a standard has prerequisites (the SAP
Coherence Map edges, seeded in `learning_standard_prereqs`). When a child
gets a menu-set question wrong, the drill walks **one** step back and hands
the model those sentences as *what may actually be missing*.

**The retry still comes from the paper's own chapter.** The foundation is
context for an easier question, never the subject of one: the child sits this
paper tomorrow, and the drill's first rule is that nothing is asked from
outside what they have been taught. `foundationLine` puts that instruction in
the prompt itself, because the model is the thing that would otherwise drop a
Class 7 child to Class 4. One step back, at most two sentences.

## Where it stops

"Until the student is perfect" has to be able to end. Three right in a row —
one is luck, two is a coin — and a ceiling of twelve questions either way. A
child who cannot get three in a row at ten at night needs sleep and a teacher
in the morning, not a thirteenth question, and the drill says so kindly.

## What a session keeps

Each question stores what the child typed and what they were told about it —
`answer`, `whatWentWrong`, `howToDoIt`, `praise` — alongside the verdict.

The verdict alone says a child got something wrong. It does not say what they
were taught, or whether the marking was fair, and "what did it actually say to
them?" is the first question anyone asks about a drill that upset a child. A
session without these reads as a scoreboard rather than a lesson.

Both are capped (answer 300 characters, each note 400) because this lives in a
jsonb column that grows with every question of every child, and nobody needs a
thousand-word answer preserved.

## Off by default

`EXAM_DRILL_ENABLED` must be set. The half-yearly was running when this was
written, with seven paper days left; a drill engine that has never spoken to
a child does not introduce itself during somebody's exam week without a
person deciding so. Unset, every path falls back to exactly what shipped on
16 September.

## Money

Unchanged. The free first day per child and the day/week/month passes are the
tutor's own (`waTutorBot.server.ts`); the drill runs inside that session and
buys nothing new.

## Cost

Two model calls per question — one to set it, one to mark the answer — so a
drill that runs to the ceiling is at most 24 flash calls. Both are recorded
in `ai_generations` under `exam-drill-question` and `exam-drill-check`.

## Tests

`npm run test:exam-drill`: the scope question and its parsing (including
Devanagari digits and a number past the end of the book), the streak
including `close`, the mastery finish, the ceiling finish, the refusal of an
out-of-scope question, the refusal of a verdict with no explanation, and that
a re-ask never repeats the question just got wrong.

`npm run test:drill-skills`: the agreed-micro-skill menu — that scope is a
boundary and not advice, that the same data gives the same numbers on every
turn of a session, the caps, that an empty menu changes nothing at all, that
a `skillRef` off the end resolves to nothing, and that the prerequisite hint
carries "stay on the chapters above" with it.
