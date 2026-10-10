# What the app should show about fees and concessions

Researched 2026-09-08 against production, not against assumptions. Every
number below is from the live database and the query is given, so each can be
re-run and argued with.

---

## 1. What the data actually says

### The money

| | |
|---|---|
| Active students | 680 |
| **Children owing something** | **248** (36% of the school) |
| Households owing | 182 |
| Total outstanding | **₹71,49,207** |
| Collected (all receipts, live) | ₹21,16,181 |
| Billed for 2026-27 | ₹36,67,609 |
| Concession given 2026-27 | ₹98,651 (2.7% of the book) |

### The finding that matters most

**Three quarters of what is owed is more than 90 days old.**

| Age of the debt | Amount | Share |
|---|---|---|
| **Over 90 days** | **₹53,92,555** | **75%** |
| 31–90 days | ₹7,38,397 | 10% |
| 0–30 days | ₹5,29,343 | 7% |
| Not yet due | ₹4,88,912 | 7% |

This is not a cash-flow timing problem. A school with a timing problem has its
money sitting in the 0–30 day band. Three quarters sitting past 90 days is an
**ageing debt** problem, and ageing debt does not age well — the older a due
gets, the less likely it is ever collected. Nothing in the app or the ERP
currently shows this at all.

### The finding that will mislead you if nobody fixes it

The outstanding splits almost exactly in half by year:

| Year | Student rows | Outstanding |
|---|---|---|
| 2025-26 | 213 | ₹35,80,250 |
| 2026-27 | 237 | ₹35,68,957 |

Not one student id appears in both years — yet **202 admission numbers do**.
The same child is carried as two different student rows, one per academic
year, so their old dues and their new dues sit under different ids.

That is why "450 students have dues" is wrong and the true figure is **248
children**. Any screen that counts `student_id` will roughly double-count, and
any screen that shows one "open dues" number silently adds last year's book to
this year's.

**This is a data problem, and no dashboard fixes it.** Building a screen on top
of it just publishes the error faster. See §4.

### The concessions

| | |
|---|---|
| Approved grants | 149 |
| Students with a concession | 120 (18% of the school) |
| **Distinct concession definitions** | **171** |
| Expiring by 31 Mar 2027 | 59 |
| Cost this year | ₹98,651 |

**171 definitions for 149 grants.** There are more ways to give a discount than
there are children receiving one. The list reads `Tuition Fee · ₹150 off`,
`₹165 off`, `₹190 off`, `₹125 off`, `₹250 off` — each a separate record. Only a
handful carry a real policy kind (`hardship`); most are `other`.

In plain terms: the school does not have a concession *policy*, it has 171
individual negotiations. Nobody can answer "what do we give a second sibling?"
because there is no such rule — there are thirty-two children with ₹150 off and
ten with ₹165 off, and the difference between them is lost.

And **59 of these expire on 31 March 2027**, which is a renewal cliff nobody
is currently watching.

---

## 2. What the app shows today

The principal's home already has: collected today, collected this month, open
dues, students with dues, attendance present/absent/marked, staff
present/absent.

That is a reasonable *status* screen. What it cannot do is tell anyone whether
things are getting better or worse, which families to act on, or what a
decision would cost. Two of its four money tiles are the misleading numbers
described above.

---

## 3. What to add, in order of value

### Phase 1 — make the existing numbers honest (small, do first)

Nothing new to compute; this is correcting what is already shown.

1. **Split open dues by year.** "This year ₹35.7L · Earlier years ₹35.8L".
   One number that mixes them is not useful to anybody.
2. **Count children, not student rows.** 248, not 450.
3. **Collection rate for the year**: ₹21.2L of ₹36.7L billed = 58%. A running
   total answers nothing; a rate answers "how are we doing".

### Phase 2 — the ageing view (the highest-value new screen)

A single card, four bars: over 90 / 31–90 / 0–30 / not yet due. Tap a band to
get the families in it, oldest first, each with a WhatsApp button that now
sends from the school's number.

This is the screen that turns ₹53.9 lakh from a fact into a list of calls. It
is also the one that will show, week by week, whether chasing is working —
because the over-90 bar either shrinks or it does not.

### Phase 3 — concessions as a policy question

1. **Cost of concessions this year**, against the book: ₹98,651 of ₹36.7L.
   Small today — but nobody currently knows that, which means nobody would
   notice it becoming large.
2. **The renewal cliff**: 59 grants expiring 31 Mar 2027, listed, with two
   reminders before the date.
3. **171 definitions for 149 grants**, said out loud on the screen, with the
   duplicates grouped. The value here is not the number; it is that seeing it
   is what starts the conversation about having a policy.

### Phase 4 — AI, and only where it earns its place

The ERP already has 33 AI routes and a house pattern that is worth keeping to
(`docs/` and `lib/aiLlm.server.ts`): **deterministic code decides who and what,
the model only writes the prose**, every call is audited in `ai_generations`,
and nothing the model writes is saved by the route.

Three uses that fit that rule and are genuinely worth having:

1. **A weekly collections note for the director.** The deterministic layer
   computes what moved — which bands shrank, which families paid, which
   promises were broken — and the model writes six sentences of it. There is
   already `collections-draft` and `leadership-digest` to build from.
2. **Per-family chase drafts** in the family's own language, from the facts of
   *that* family's dues. This exists in the web as `collections-draft`; it is
   not on the phone.
3. **A concession consistency check.** Given the 171 definitions, ask the model
   to group them into the policies they appear to be — "these 32 are the same
   ₹150 tuition discount under 6 names" — as a *draft for a human to approve*,
   never an automatic merge.

**Where AI should not go:** predicting who will default, or scoring families by
likelihood to pay. The data is 680 children in one school; there is not enough
of it for a model to learn anything a person could not see, and a wrong score
attached to a family is a real harm for no gain. Ageing and payment history
already answer "who to call first" deterministically and can be explained to
the parent.

---

## 4. Do this before any of it

**Fix the duplicate per-year student rows.** 202 children have their dues split
across two identities. Until that is resolved:

- every per-child total is wrong for those 202 families;
- a parent can be chased for last year's dues under a record that is not the
  one the counter shows;
- and any screen built on it inherits the error and gives it authority.

This is the same class of problem as the fee-line incidents this week: the data
says something the school does not mean, and the interface repeats it
confidently. Correct the records first, then build the views.

---

## 5. Queries behind every number here

```sql
-- children owing, households, and the ageing bands
with d as (
  select o.household_id, s.admission_no, o.academic_year_code,
         o.balance_paise, o.due_on
  from fee_desk_open_dues o join sis_students s on s.id = o.student_id
  where o.balance_paise > 0
)
select count(distinct admission_no) children_owing,
       count(distinct household_id) households_owing,
       sum(balance_paise) total,
       sum(balance_paise) filter (where due_on < current_date - 90) over_90d,
       sum(balance_paise) filter (where due_on between current_date - 90 and current_date - 31) d31_90,
       sum(balance_paise) filter (where due_on between current_date - 30 and current_date) d0_30,
       sum(balance_paise) filter (where due_on > current_date) not_yet_due
from d;

-- the duplicate identities
with y as (select distinct student_id, academic_year_code
           from fee_desk_open_dues where balance_paise > 0)
select count(*) from (
  select s.admission_no from y join sis_students s on s.id = y.student_id
  where coalesce(s.admission_no,'') <> ''
  group by s.admission_no having count(distinct y.academic_year_code) > 1
) x;

-- concession spread
select count(distinct c.id) definitions,
       count(g.id) filter (where g.status='approved') grants,
       count(distinct g.student_id) filter (where g.status='approved') students
from masters_desk_concessions c
full join masters_desk_concession_grants g on g.concession_id = c.id;
```
