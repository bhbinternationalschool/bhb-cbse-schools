# Reviewing concessions with AI — what it can and cannot tell you

Researched 2026-09-08 against production.

---

## 1. The finding that decides the whole design

You asked who is taking a concession **on what ground**. The honest answer is
that the school does not record grounds. It records mechanisms.

Every one of the 149 approved grants has a `reason` filled in, so the field
looks complete. Read them and they say things like:

> `Fee Take · Counter concession · from Tuition Fee · April · receipt RCV-00096`

That is *where the discount was applied*, not *why the family qualifies*.

| What the reason actually records | Grants | Students |
|---|---|---|
| **Counter concession — mechanism, no ground** | **108** | **99** |
| RTE — a real, checkable ground | 18 | 3 |
| Imported from `fee_discount_report.xlsx` — ground unknown | 16 | 16 |
| Changed at the counter by a named person | 3 | 3 |
| Other | 4 | 4 |

**For 99 of the 120 children receiving a concession, nobody wrote down why.**

No model can recover a fact that was never recorded. An AI asked "on what
ground is this discount given?" would do the one thing it must never do here —
invent a plausible reason for a real family's money. So that is not the
feature to build.

## 2. What the data can and cannot support

**Sibling status cannot be the ground.** 110 of the 120 concession holders are
in a multi-child household — but so are 543 of the other 560. Being one of
several children describes 95% of the school, so a sibling rule would not
distinguish anybody. If the school wants a sibling policy that is a *pricing*
decision, not an explanation of the current discounts.

**RTE is real but tiny.** 18 grants across just 3 children — it is per-fee-head,
so it looks larger in the grant count than it is.

**Payment behaviour cannot be used yet.** The dues cache is stale (see
`FEES_CONCESSION_APP_INSIGHTS_PLAN.md` §1 and PR #105): for 2026-27 it credits
₹1 against ₹36.7 lakh billed, so every family reads as owing everything. Any
"do they actually pay?" input would be reading a broken number. **Rebuild
first, then use it.**

Also note only 237 of 680 active students carry 2026-27 dues at all. Until the
duplicate per-year identities are resolved, per-child money facts are not safe
inputs to anything.

---

## 3. What to build instead

Not "why does this family have a discount" — the school cannot answer that
either. Two features that are answerable, useful, and honest.

### A. The concession case file (the one worth building)

For each child holding a concession, assemble what the school **does** know and
put it in front of a human as a question, not a verdict:

- the discount: what, how much, on which heads, since when, expiring when;
- who granted it and through which route (counter / import / director);
- household: how many children here, which classes, transport used or not;
- whether a guardian appears on the staff roster (a staff ward is a real,
  checkable ground the school currently does not tag);
- whether siblings in the same household hold different discounts — the
  clearest sign of an inconsistency;
- and once the dues are rebuilt: what they have paid this session.

The model's only job is to write the **question** for the reviewer: *"Both
children in this household are here; one has ₹150 off tuition and the other
none. Was that intended?"* Deterministic code decides which families to surface
and on what basis; the model writes the sentence. That is the house rule
already in `lib/aiLlm.server.ts`, and it is exactly right for this.

### B. Turning 171 definitions into a policy

There are **171 distinct concession definitions for 149 grants** — more ways to
give a discount than children receiving one: `₹150 off`, `₹165 off`, `₹190
off`, `₹125 off`, each its own record, most tagged `other` rather than a real
kind.

The model groups them into the policies they appear to be — *"these 32 are the
same ₹150 tuition discount under six names"* — as a **draft for a human to
approve, never an automatic merge**. The output is a proposed policy list the
school can adopt: sibling, staff ward, hardship, RTE, and the amounts that go
with each.

That is what converts 171 negotiations into something a school can apply
consistently and explain to a parent who asks why their neighbour pays less.

---

## 4. What this must never do

**No scoring families by deservingness, need, or likelihood to pay.** It is 680
children in one school; a model has nothing to learn here that a person cannot
see, and a wrong judgement attached to a family's name is a real harm for no
gain. The output is a case file and a question — the school decides.

**No inventing a ground.** Where the reason says only "Counter concession", the
case file says *"no ground recorded"* and stops. That absence is itself the
finding, and the fix is a form field at the counter, not a model.

**No automatic changes to anyone's discount.** Every action stays a human one,
recorded against the person who took it — the same rule the receipt repair
path now follows.

---

## 5. Order of work

1. **Rebuild the dues** (PR #105) — until then, payment facts are unusable.
2. **Record the ground at the counter.** A required "why" on a counter
   concession, from a short list (sibling / staff ward / hardship / RTE /
   director's discretion) plus a note. This costs one afternoon and is worth
   more than any analysis: it stops the hole getting deeper while the rest is
   built.
3. **Tag staff wards**, by matching guardian mobiles against the staff roster —
   a real ground the school already has the data for and does not use.
4. **Build A**, the case file, over the 120 children.
5. **Build B**, the policy consolidation, once A has shown what the real
   patterns are.

Step 2 matters most and needs no AI at all. Everything after it gets better the
longer step 2 has been running.
