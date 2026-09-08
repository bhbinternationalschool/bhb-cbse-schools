# ERP command desk — rollout runbook

What happens when this ships, in what order the switches are consulted, and
how to stage it. Written after the desk was merged (PR #85) and before it has
ever answered a real staff member.

Everything below was read out of the code, not remembered. The line
references are the ones that decide behaviour.

---

## 1. The one thing to know first

**`ERP_WA_COMMANDS` is a kill switch, not an on switch.** Unset means ON.

```ts
// lib/erpCommands.server.ts
export function erpCommandsEnabledByEnv(): boolean {
  const v = (process.env.ERP_WA_COMMANDS || "").trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false" || v === "no");
}
```

So there is nothing to switch on. **The next production deploy of `main`
makes all 22 commands live for every staff member whose mobile is on the
roster**, including the write commands that message parents.

If that is not what you want on this deploy, set `ERP_WA_COMMANDS=off` on the
Cloud Run service *before* deploying.

---

## 2. Order of checks

Every inbound staff WhatsApp message runs this gauntlet, in this order. The
order matters more than any single check.

| # | Check | Fails → |
|---|---|---|
| 1 | **Env kill switch** `ERP_WA_COMMANDS` | branch does nothing; other bots answer as before |
| 1½ | **Allowlist** `ERP_WA_COMMANDS_ALLOW` — absent since 2026-09-08, so this check passes for everyone | silent for anyone not on it, exactly like the kill switch |
| 2 | Voice note transcribed to text | asks you to type it |
| 3 | **Director pause switch** — `commands off` / `commands on` | non-director is told only the director may |
| 4 | Pending confirm card (`YES` / `NO`) | expired after 5 minutes |
| 5 | Parse — regex first, model only for command-shaped text | not a command → other bots answer |
| 6 | **Runtime pause** (`store.paused`) | replies "paused", spends no model call |
| 7 | Hourly cap — **30 per staff member per hour** | "that's a lot of commands this hour" |
| 8 | Mobile must match a staff record | "your number isn't linked to a staff record" |
| 9 | RBAC module + action for that command | "your role doesn't include …" |

### The consequence that matters

**Check 1 runs before check 3.** So:

- `ERP_WA_COMMANDS=off` → the desk is *completely dead*, and **you cannot turn
  it back on from WhatsApp**. `commands on` is never reached. Re-enabling
  needs an env change and a redeploy.
- Runtime `commands off` → paused for everyone, and reversible **instantly**
  from WhatsApp with `commands on`. This is the switch to use day to day.

---

## 3. Who can do what

**Who can run any command at all:** anyone whose mobile matches an active
staff record — flow `teacher`, `staff` or `owner`. Parents, visitors and
unknown numbers never reach the branch, and their messages are never passed
to the engine as instructions.

At BHB today that is **28 of 35 active staff** (the other 7 have no mobile on
file, so they cannot be reached or recognised).

**Who can pause and resume:** flow `owner` only, which is inferred from the
designation or the person's name matching
`/owner|trustee|director|principal|founder|chairman/`
(`lib/waRoleResolver.ts`). At BHB that is **4 people** — 3 Directors and the
Principal.

**What each of them can actually run** is a separate question, decided by
RBAC rather than by the WhatsApp flow. The two resolvers do not agree, and
the difference matters:

| Person | How the role is resolved | Commands |
|---|---|---|
| Director (the pilot number) | protected super-admin **email** → `owner` | 24 / 24 |
| Principal | designation "Principal" matches → `principal` | 24 / 24 |
| Beena Singh, Kanchan Singh | **explicit assignment** to `owner`, 2026-09-08 | 24 / 24 |

An earlier version of this table claimed those two held `office` from
2026-09-07. They did not: `rbac_state` in the live database held **zero
assignments** when it was read on 2026-09-08, so whatever was done on the
7th never reached the server. Both now hold `owner` — written into the live
`rbac_state` row on 2026-09-08 at the director's instruction, `role_owner`,
primary, unrestricted scope, no expiry, with an audit entry each.

`owner` is the widest role in the system: every module, every action,
including billing, policy override and **audited impersonation**.
`principal` would have given the same 24 / 24 command coverage without
impersonation; `owner` was asked for deliberately.

The assignments were needed at all because `rbac.inferRoleCodes` has
designation patterns for principal, admin, office, accounts, driver,
teacher and gate, but **none for "director"** — so a Director without a
super-admin email falls through to `support` (3 modules, effectively no
commands). That is deliberate: a comment dated 2026-09-06 records that
unmatched staff used to sign in as principal, which was tightened on
purpose, and elevation is meant to come from an explicit assignment where a
human decides it. A future Director needs the same assignment.

Note what an explicit assignment does to the fallback: once someone has one
active assignment, `resolveSessionRoleScopes` stops inferring from their
designation entirely. For `owner` that is harmless — it is a superset of
anything the designation would have given — but for a narrow role it is a
replacement, not an addition.

**What a command can do to a family:** nothing without a confirm card first.
Every write shows the card, and permission *and* section scope are re-checked
when you tap Confirm, not trusted from the card.

---

## 4. Who the desk answers

`ERP_WA_COMMANDS_ALLOW` limits the desk to named mobiles. When it is set,
**only those numbers** may use it — on WhatsApp and in the app alike.
Everyone else sees exactly the WhatsApp they saw before the desk existed: no
reply, no hint that a feature exists, other bots answering as usual. Empty or
unset means everyone, which is the shipped behaviour.

**Current state: SCHOOL-WIDE.** As of 2026-09-08 there is no
`ERP_WA_COMMANDS_ALLOW` line in `deploy/desk-cutover-runtime.env`, and an
absent allowlist means every staff member whose mobile is on an active
staff record — 28 people at BHB.

**Where it lives when you want one: `deploy/desk-cutover-runtime.env`,
committed.** Not on the Cloud Run service by hand, and not as a cloudbuild
substitution fed from `.env.local` the way the notify mobiles are. Both of
those fail the same way, and the failure is the dangerous direction:

- Set by hand with `gcloud run services update`, it is erased by the next
  deploy, because `--set-env-vars` replaces the whole environment.
- As a substitution defaulting to `""`, the build trigger — which has no
  `.env.local` — would supply an empty allowlist. **Empty means everyone.**

That is why the pilot value was committed while a pilot was the intent.
Now that school-wide IS the intent, the same failure direction is the
harmless one, and there is no value to keep anywhere.

Commas, spaces, newlines, `+91` and a leading `0` are all tolerated, because
this gets pasted out of a phone book. A person is matched on any number the
school knows them by — the number they messaged from, plus the mobile and
alternate mobile on their staff record — so a director on the list messaging
from their second phone still reaches their own brake.

**If you ever set a list again, put the director's number on it.** The
check sits at step 1½, ahead of the `commands off` brake, so somebody who
is not on the list cannot pause the desk either — a school could be locked
out of its own brake by an allowlist that forgot the person holding it.

### What school-wide actually reaches, at BHB today

28 staff have a mobile on an active record, and they do NOT all get a
usable desk — RBAC decides that separately, from the designation:

| Resolves to | Staff with mobiles | Gets |
|---|---|---|
| `teacher` (Teacher, TGT, PPRT, Sports Teacher) | 16 | their own sections |
| `owner` (super-admin email) | 1 | everything |
| `principal` | 1 | everything |
| `accounts` (Accountant) | 1 | fees |
| `driver` | 3 | route manifest |
| `owner` (explicit assignment, the 2 Directors) | 2 | everything |
| **`support` — refused every command** | **4** | nothing |

The two Directors were in that `support` row until 2026-09-08; they now
hold `owner` by explicit assignment (§3). **Four** are still refused
everything: a Counsellor, a Computer Operator, a Peon, and one staff member
with no designation at all. `rbac.inferRoleCodes` has no pattern for
"counsellor" or "operator", so they fall through to `support` and are told
"your role doesn't include …" on everything — which reads as the desk being
broken rather than as a permission they lack.

Fix each with one assignment in the ERP: Settings → Roles. `office` is the
right size for the Counsellor and the Computer Operator; the Peon needs
`gate` or nothing at all.

---

## 5. Where the rollout got to

Stages A and B are history now; this records what happened rather than
what to do.

- **Stage A — ship the code, not the behaviour.** Done and passed.
- **Stage B — one-number pilot.** `ERP_WA_COMMANDS_ALLOW` was pinned to
  the director's mobile in `deploy/desk-cutover-runtime.env`, committed so
  a redeploy could not silently widen it. The reads were verified against
  live data from that number.
- **Stage B2 — school-wide.** Decided 2026-09-08: the allowlist line was
  removed. All 28 staff with a mobile on an active record can reach the
  desk from the deploy that carries this change.

**This step has no undo short of another deploy**, so it is worth doing on
a quiet morning with somebody watching Comms → WhatsApp inbox. What each
person can actually run is decided by RBAC, not by this switch — see §4
for the six people at BHB who will be refused everything until somebody
gives them a role.

### Stage C — the first real test, from your own number

Reads first. None of these send anything to anyone:

```
help
5A me aaj kaun absent hai
attendance summary
Amay Gupta 4B ki fees pending
class 3 defaulters
aaj ki collection
```

Then **one** write, against a family you can ring afterwards:

```
Payment link for <a student you choose>
```

Read the confirm card before tapping Confirm. It shows the amount, what it
covers, the guardian's name and their masked number. Cancel is always safe —
nothing is sent until you confirm.

### If anything looks wrong

Send **`commands off`** from a director number. That parks the whole desk for
every staff member immediately, with no deploy. `commands on` resumes it.

---

## 5b. What the desk does NOT answer, and what happens then

Since 2026-09-07 the staff keyword bot is **silent unless summoned**.

Before that it answered every staff message the desk stepped aside from,
which on a number staff also use to talk to the school meant a greeting
got a menu and a half-typed thought got a canned line about admissions.

| A staff member sends | Answered by |
|---|---|
| a command (`5A me aaj kaun absent hai`) | the desk |
| `help` | the desk — the full command list |
| `IN` / `OUT` | the attendance punch bot, unchanged |
| `menu` / `main` / `start` | the greeting menu, unchanged |
| `school bot` | the old staff bot, awake for 30 minutes |
| `bot off` | closes it again |
| anything else | **nothing** — logged to Comms → WhatsApp inbox for a human |

The silence is deliberate and it is the part to watch during the pilot: a
staff member who does not know about `school bot` will read it as the
number being dead. The desk's `help` reply says so in its last line,
which is the only place they can find out.

**Parents, visitors, admission enquiries, vendors and job applicants are
untouched.** They have nothing but that bot, so for them every keyword and
greeting works exactly as before. This rule applies only to a sender who
resolves to an active staff record.

The teacher class channel (homework to parents) and the staff attendance
punch bot both run BEFORE this gate and are unaffected.

## 5c. An outsider who messages the school number

Unchanged in principle — a vendor, a job seeker or a stranger has nothing
but the bots, so they are still greeted, asked their name, and asked what
they need. Three things changed on 2026-09-07, all of them from one live
thread that had been looping since 18 August.

| They send | Before | Now |
|---|---|---|
| a forwarded link, or a photo with no caption | full purpose menu, every time | **logged, no reply** |
| something that is not a usable name | accepted as their name | refused, re-asked |
| a third unusable reply | asked again, forever | **parked** — one "the office will reply", thread flagged |
| anything naming a real purpose, after parking | — | picked straight back up |
| `menu` | restarts | restarts (unchanged) |

**What the office sees.** A parked thread is escalated once and sits in
Comms → WhatsApp inbox with its full history. Nothing is deleted and no
message is hidden — the bot simply stops talking, and a person decides
whether it is worth answering.

**A name is now refused** if it carries a URL, runs past 60 characters or
six words, or is not mostly letters. The thread that prompted this had
`https://www.facebook.com/share/r/1BkJUpZ93g/good morning have a glorious
day` recorded as a visitor's name and read back to them, in bold, on every
reply for three weeks.

**Purpose detection now checks job before admission.** "Apply" belongs to
both and admission held it, so "I want to apply for a teacher vacancy"
was creating an admission lead with an enquiry number for the office to
chase.

**What is still true:** who they are and why they are writing is entirely
self-declared. Nobody verifies it. For an admission enquiry there is a
real lead record; for everything else it is a labelled thread for a human.

---

## 6. What reaches a parent, and when

Only after a staff member confirms a write command. Always as an approved
WhatsApp template — free text is never sent to a parent, because most
families are outside Meta's 24-hour window.

| Command | What the family gets |
|---|---|
| `fee_reminder` | one reminder each, their own child and amount; quiet hours 20:00–08:00 IST, once a week per family |
| `pay_link` | a Cashfree link for current dues; not sent at all if the link fails to save |
| `class_message` | the approved notice template with the staff member's words in it |
| `bus_delay` | their own child and stop; **no** quiet hours, deliberately |
| `mark_attendance` | absent alert to that child's family |
| `post_homework` | a homework notification (app channel only) |
| `decide_leave` | app notification of the decision; no WhatsApp |
| `book_ptm` | app notification; WhatsApp only if a notice template is approved |
| `raise_complaint` | **nothing** — the card says plainly that the family is not messaged |
| `staff_broadcast` | staff only, never families |

**A template family must be approved in BOTH Hindi and English, or the
command refuses.** Not "send whichever half exists" — that writes to a
parent in a language they did not choose, and the concrete case was a
family who had just paid at the counter being told, in the wrong
language, to pay a link (see `templateFamilyReady`, PR #101). The refusal
names the missing language so the office knows what to chase.

At BHB on 2026-09-07 only `fees_pay_link` was approved at all, and only in
Hindi — so **every** parent-facing write refuses today, the pay link
included, until Meta approves the English halves.

Where no approved template exists, the command says so rather than sending
nothing silently or implying it sent.

---

## 7. Cost

Staff replies are free inside Meta's 24-hour window until **30 Sep 2026**.
From **1 Oct 2026** a utility template costs about **₹0.115** (India). One
model call per command that the regexes do not match; the common commands
match without one.

At 50 staff × 10 commands a day that is roughly **₹60/day** from October.

---

## 8. Before you go live — checklist

- [ ] `ERP_WA_COMMANDS_ALLOW` absent from `deploy/desk-cutover-runtime.env`
      — that absence IS school-wide. Nothing to set by hand on the service;
      the next deploy would erase it anyway
- [x] The two Directors hold `owner` by explicit assignment (2026-09-08)
- [ ] The **four** staff still resolving to `support` have been given a role,
      or they will be refused every command (§4) — a Counsellor, a Computer
      Operator, a Peon, and one with no designation
- [ ] Approved WhatsApp templates exist for the writes you intend to use.
      **Both languages, or the command refuses.** Today only
      `attendance_absent` and `fees_receipt` are approved in en AND hi, so
      `mark_attendance` is the one write that reaches a family; the pay
      link, fee reminder, class message and bus delay all refuse until
      their second halves are approved — Masters → WhatsApp templates
- [ ] `ERP_COMMANDS_DIGEST_HOUR` set if you want the director's nightly digest
- [ ] Cloud Scheduler job for the digest tick created from
      `scripts/setup-cloud-scheduler.sh`
- [ ] The 4 director/principal numbers know that `commands off` is the brake
- [ ] Someone is watching Comms → WhatsApp inbox for the first hour
- [ ] **All 28 staff** know that anything which is not a command gets no
      reply now, and that `school bot` brings the old menu back — with the
      pilot over, this is the change most of them will notice first
- [ ] Whoever watches Comms knows that a *parked* outsider thread is one
      the bot gave up on and a person has to answer

---

## Related

- `docs/AI_ERP_COMMANDS_PLAN.md` — what each command does and why it refuses
  what it refuses
- `lib/erpCommands.server.ts` — the order of checks, in the file header
- `lib/erpCommands.ts` — the catalogue, parsers and confirm-card formatters
