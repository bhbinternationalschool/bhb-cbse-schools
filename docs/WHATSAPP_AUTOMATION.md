# WhatsApp automation (Masters → Automation)

Scheduled WhatsApp rules — "remind every defaulting family at 10:00 on school
days" — run by the server, not by whichever browser happens to be open.

## What was wrong before 2026-09-10

A rule scheduled to remind defaulters produced no message and no error:

| Symptom | Cause |
|---|---|
| Nothing sent to any family | The tick "previewed" every rule with two hard-coded sample numbers (`9876543210`, `9123456780`) and never read the fee desk. |
| Ran at odd times | The cron time was never read; the tick added 24 h to whenever it first ran. |
| Auto mode sent nothing | The server tick only marked an item "auto-approved" with `dispatched: 0`. The only send path was the browser's Approve button. |
| Rules "reset" | A failed DB read fell back to seeded defaults, and the tick saved those over the real rules. |
| Stale approvals / lost cards | The screen edited a localStorage copy and pushed it whole, overwriting what the scheduler had raised. |
| `(reminder —)` in the message | `{{stage}}` was never filled. |

## How it works now

```
Cloud Scheduler  ──every 30 min 08:00–19:59 IST──▶  POST /api/wa/automation/tick
                                                        │
                            load rules from Supabase (fail closed on read error)
                                                        │
                       for each rule whose nextRunAt ≤ now (cron in IST, quiet hours held)
                                                        │
                    build the REAL audience  ── lib/automationAudience.server.ts
                      · listLiveDefaulters (Fees → Defaulters ledger), one message per family
                      · family's own language; template must be approved in en AND hi
                      · weekly cap (shared with the WhatsApp "fee reminder" command), STOP, family quiet hours
                                                        │
                 approval-first ──▶ card in Approvals tab (real names, class, amount, masked mobile)
                 auto-send      ──▶ sent immediately, per-family result recorded
                                                        │
                                       save; advance nextRunAt to the next cron time
```

* `lib/automation.ts` — pure rule / approval / run logic (`runAutomationTick`, `computeNextRun`, `ruleDueState`).
* `lib/automationSchedule.ts` — real 5-field cron evaluation in IST (`nextCronRun`, `cronMatches`).
* `lib/automationAudience.server.ts` — audience resolvers. Automated today: **Overdue fee households** (`fee_overdue`) and **Fees due in next 3 days** (`fee_due_soon`). Other presets are labels only and the rule records a failed run saying so.
* `lib/automationEngine.server.ts` — tick, sending, approval dispatch (`sendWaWithFailover`, `household_message_log`).
* `lib/automationLedger.server.ts` — the once-per-N-days ledger, shared with the ERP command desk (`feeRemindedOn`).
* `app/api/wa/automation/tick` — scheduler entry (cron secret).
* `app/api/wa/automation/desk` — the screen's API (session + `wa_automation` RBAC): rules, preview, run now, approve/reject/snooze.

## Using it — send a fee reminder to defaulters every school day at 10:00

1. **Masters → WhatsApp templates**: `fees_stage_reminder` must be **approved at Meta in both English and Hindi**. Half-approved families are refused, never sent the wrong language.
2. **Masters → Automation → Fee stage reminders** (built-in rule):
   * Schedule: `10:00`, School days (Mon–Sat). The scheduler checks every 30 min, so 10:15 goes out at 10:30.
   * Audience: **Overdue fee households — automated**.
   * "Don't message the same family again within": 7 days (default).
3. Press **Preview who gets it** — the list is built from today's Fees → Defaulters ledger. Check names, classes, amounts, language split.
4. Press **Enable**. The status strip shows *Scheduled · next run 11 Sep 2026, 10:00 am IST*.
5. First runs are **approval-first**: at 10:00 a card appears in the **Approvals** tab with every family. Tap **Approve & send**. Per-family sent/failed shows under *Recently decided*.
6. Happy with two or three runs? **Mark tested → Switch to auto-send**. From then on the 10:00 tick sends by itself; the Runs tab shows `12 sent · 1 failed`.

**Run now** on a rule builds today's list immediately (approval-first → card; auto → sends). It replaces an older pending card for the same rule.

## Rules that will not send, and why the screen says so

| Badge | Meaning |
|---|---|
| paused | Rule is off. |
| needs setup | Invalid schedule, no template, or free-text audience. |
| label only | Audience preset the server cannot build yet (e.g. "Class parents"). |
| approval-first | Will raise a card at the scheduled time and wait. |
| auto-send | Will send at the scheduled time. |

Quiet hours (rule default 20:00–08:00 IST) *hold* a due rule until the first check after 08:00 — nothing is dropped. Per-family quiet hours (Household prefs) skip that family for the run.

## Operations

* Scheduler job: `bhb-wa-automation-tick`, `*/30 8-19 * * *` Asia/Kolkata, 300 s deadline (`scripts/setup-cloud-scheduler.sh`). Re-run the script after deploying to pick up the deadline change.
* Manual tick: `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://bhbinternational.school/api/wa/automation/tick` → `{ evaluated, pendingApprovals, autoSent, notes }`.
* Dry run: body `{"dryRun":true}` evaluates and reports without sending or saving.
* A read failure returns HTTP 500 (Cloud Scheduler shows red and retries); it never evaluates an empty rule-set.
* Every send is in `household_message_log` (`purpose = automation:<family>`), with Meta delivery ticks in `wa_message_delivery`.
* Self-tests: `npm run test:automation`, `npm run test:wa-templates-automation`.

## Not automated yet

Event-driven rules (absent marked, homework published…) and the non-fee audience presets are still labels: their modules do not raise events into this engine. The screen marks them so nobody schedules one expecting a send.
