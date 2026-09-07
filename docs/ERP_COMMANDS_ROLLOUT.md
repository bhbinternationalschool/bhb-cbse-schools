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

**What a command can do to a family:** nothing without a confirm card first.
Every write shows the card, and permission *and* section scope are re-checked
when you tap Confirm, not trusted from the card.

---

## 4. There is no per-person pilot

Worth stating plainly, because it shapes the rollout: **the code has no
allowlist.** The desk is on for every staff member with a mobile, or off for
everyone. "Try it with just my number first" is not supported today.

That is a gap, not a decision. A small `ERP_WA_COMMANDS_ALLOW` list of
mobiles, consulted at check 1, would make a true pilot possible and is a
short change. Until it exists, the two honest options are everyone or nobody.

---

## 5. Recommended sequence

### Stage A — ship the code without shipping the behaviour

1. Set `ERP_WA_COMMANDS=off` on the Cloud Run service.
2. Deploy `main`.
3. Confirm the rest of the release is healthy. Staff WhatsApp behaves exactly
   as it did before: class channel, attendance bot, leadership snapshots all
   unchanged.

Nothing about the desk is live. This is the state I previously — and
wrongly — described as the default.

### Stage B — go live

1. Remove `ERP_WA_COMMANDS` (or set it to anything other than `off`).
2. Redeploy.
3. **The desk is live for all 28 staff from that moment.** There is a window
   between the deploy finishing and anyone sending `commands off`. Reads in
   that window are harmless; a write cannot happen by accident, because it
   needs a command *and* a confirmation.
4. Send `commands off` from a director number if you want to park it while
   you watch, then `commands on` when ready.

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

- [ ] Decide Stage A or straight to Stage B, knowing B is live for all 28 staff at once
- [ ] Approved WhatsApp templates exist for the writes you intend to use
      (fee reminder, pay link, notice, bus delay) — Masters → WhatsApp templates
- [ ] `ERP_COMMANDS_DIGEST_HOUR` set if you want the director's nightly digest
- [ ] Cloud Scheduler job for the digest tick created from
      `scripts/setup-cloud-scheduler.sh`
- [ ] The 4 director/principal numbers know that `commands off` is the brake
- [ ] Someone is watching Comms → WhatsApp inbox for the first hour

---

## Related

- `docs/AI_ERP_COMMANDS_PLAN.md` — what each command does and why it refuses
  what it refuses
- `lib/erpCommands.server.ts` — the order of checks, in the file header
- `lib/erpCommands.ts` — the catalogue, parsers and confirm-card formatters
