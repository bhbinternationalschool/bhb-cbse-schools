/**
 * Run: npx tsx src/lib/automationSchedule.selftest.ts
 *
 * The schedule half of the 11 September 2026 incident.
 *
 * "Fee stage reminders" was set to 8:00 AM on Mon/Wed/Fri. Nothing in the
 * ERP ever read that: `computeNextRun` returned "24 hours from now", and a
 * rule that had never run counted as due on the next tick whatever the
 * clock said. So the rule the office had scheduled for Monday morning was
 * next due at 00:24 on Saturday — the time somebody happened to press a
 * button on Friday night.
 *
 * These tests pin the cron reader and the arming rule.
 */
import assert from "node:assert/strict";
import {
  createAutomationRule,
  emptyAutomation,
  evaluateAutomationTick,
  pendingApprovals,
  setRuleEnabled,
  updateAutomationRule,
  updateRuleSchedule,
  type AutomationState,
  type ResolvedAudiences,
} from "./automation";
import { nextCronRunIst, parseCronFields } from "./automationSchedule";

console.log("automationSchedule.selftest.ts");

/** An IST wall-clock instant, the way the office reads a schedule. */
function ist(
  y: number,
  m: number,
  d: number,
  h = 0,
  min = 0,
  sec = 0,
): Date {
  return new Date(Date.UTC(y, m - 1, d, h, min, sec) - 330 * 60_000);
}

function nextIso(expr: string, from: Date): string {
  const at = nextCronRunIst(expr, from);
  assert.ok(at, `expected ${expr} to have a next run`);
  return at.toISOString();
}

// --- the rule from the incident: 8 AM Mon / Wed / Fri ------------------
{
  const expr = "0 8 * * 1,3,5";
  // Friday 11 Sept, 00:24 IST — the minute the messages actually went out.
  assert.equal(
    nextIso(expr, ist(2026, 9, 11, 0, 24)),
    ist(2026, 9, 11, 8, 0).toISOString(),
    "later the same Friday morning, not 24 hours after the button",
  );
  // Friday evening, right after somebody pressed "Run evaluation now".
  assert.equal(
    nextIso(expr, ist(2026, 9, 11, 18, 54, 31)),
    ist(2026, 9, 14, 8, 0).toISOString(),
    "Monday 8 AM — the old code answered Saturday 18:54",
  );
  // Saturday and Sunday are not in the pattern.
  assert.equal(
    nextIso(expr, ist(2026, 9, 12, 9, 0)),
    ist(2026, 9, 14, 8, 0).toISOString(),
  );
}

// --- school-days pattern from the seeds -------------------------------
{
  assert.equal(
    nextIso("0 10 * * 1-6", ist(2026, 9, 13, 12, 0)), // Sunday noon
    ist(2026, 9, 14, 10, 0).toISOString(),
  );
  assert.equal(
    nextIso("0 8 * * *", ist(2026, 9, 10, 8, 0, 0)),
    ist(2026, 9, 11, 8, 0).toISOString(),
    "exactly on the minute means the NEXT one, never the same instant twice",
  );
  assert.equal(
    nextIso("0 8 * * *", ist(2026, 9, 10, 7, 59, 30)),
    ist(2026, 9, 10, 8, 0).toISOString(),
    "thirty seconds early is still today",
  );
}

// --- steps, lists and ranges ------------------------------------------
{
  assert.equal(
    nextIso("*/30 9-10 * * *", ist(2026, 9, 10, 9, 5)),
    ist(2026, 9, 10, 9, 30).toISOString(),
  );
  assert.equal(
    nextIso("15,45 * * * *", ist(2026, 9, 10, 9, 20)),
    ist(2026, 9, 10, 9, 45).toISOString(),
  );
  // 0 and 7 both mean Sunday.
  assert.equal(
    nextIso("0 7 * * 7", ist(2026, 9, 10, 9, 0)),
    ist(2026, 9, 13, 7, 0).toISOString(),
  );
  // Day-of-month and day-of-week both set = either one fires (cron's own
  // rule, kept so a hand-written expression behaves as its author expects).
  assert.equal(
    nextIso("0 8 1 * 5", ist(2026, 9, 1, 0, 0)), // 1 Sept is a Tuesday
    ist(2026, 9, 1, 8, 0).toISOString(),
  );
}

// --- unusable expressions say so instead of guessing ------------------
{
  assert.equal(parseCronFields("0 8 * *"), null, "four fields is not cron");
  assert.equal(nextCronRunIst("", ist(2026, 9, 10)), null);
  assert.equal(nextCronRunIst("banana", ist(2026, 9, 10)), null);
  assert.equal(nextCronRunIst("0 25 * * *", ist(2026, 9, 10)), null, "hour 25");
  assert.equal(
    nextCronRunIst("0 8 30 2 *", ist(2026, 9, 10)),
    null,
    "30 February never comes — say null, do not loop for ever",
  );
}

// --- a scheduled rule waits for its own time --------------------------
function feeRule(): { state: AutomationState; ruleId: string } {
  const created = createAutomationRule(emptyAutomation(), {
    name: "Fee stage reminders",
    module: "fees",
    triggerType: "schedule",
    cronExpr: "0 8 * * 1,3,5",
    actionType: "whatsapp_template",
    templateFamilyKey: "fee_reminder",
  });
  // The office's own rule has quiet hours off — that is how a card came to
  // be raised at 00:23 IST at all.
  const quiet = updateAutomationRule(created.state, created.rule.id, {
    quietHours: {
      enabled: false,
      startHour: 20,
      endHour: 8,
      timezone: "Asia/Kolkata",
    },
  });
  return {
    state: setRuleEnabled(quiet, created.rule.id, true),
    ruleId: created.rule.id,
  };
}

function audienceOf(ruleId: string, n: number): ResolvedAudiences {
  return {
    [ruleId]: {
      ok: true,
      note: `${n} recipients from live data`,
      recipients: Array.from({ length: n }, (_, i) => ({
        mobile: `90000000${String(i).padStart(2, "0")}`,
        language: "en" as const,
        label: `Child ${i}`,
        variables: { guardianName: "Ravi", childName: `Child ${i}` },
      })),
    },
  };
}

{
  const { state, ruleId } = feeRule();
  const rule = state.rules.find((r) => r.id === ruleId)!;
  assert.equal(rule.nextRunAt, "", "a fresh rule carries no next run");

  // Midnight tick, the shape of the incident.
  const midnight = evaluateAutomationTick(state, {
    now: ist(2026, 9, 11, 0, 24),
    audiences: audienceOf(ruleId, 146),
  });
  assert.equal(
    pendingApprovals(midnight).length,
    0,
    "00:24 is not 8 AM — nothing may be proposed, let alone sent",
  );
  const armed = midnight.rules.find((r) => r.id === ruleId)!;
  assert.equal(
    armed.nextRunAt,
    ist(2026, 9, 11, 8, 0).toISOString(),
    "but the rule is armed, so the desk can say when it will fire",
  );

  // A tick before the hour still does nothing.
  const early = evaluateAutomationTick(midnight, {
    now: ist(2026, 9, 11, 7, 45),
    audiences: audienceOf(ruleId, 146),
  });
  assert.equal(pendingApprovals(early).length, 0);

  // 8:00 arrives.
  const due = evaluateAutomationTick(early, {
    now: ist(2026, 9, 11, 8, 0, 30),
    audiences: audienceOf(ruleId, 146),
  });
  assert.equal(pendingApprovals(due).length, 1, "one card at 8 AM");
  assert.equal(pendingApprovals(due)[0]?.audienceCount, 146);
  assert.equal(
    due.rules.find((r) => r.id === ruleId)?.nextRunAt,
    ist(2026, 9, 14, 8, 0).toISOString(),
    "and the next one is Monday, not this time tomorrow",
  );
}

// --- pressing "Run evaluation now" does not move the schedule ---------
{
  const { state, ruleId } = feeRule();
  const forced = evaluateAutomationTick(state, {
    forceRuleIds: [ruleId],
    now: ist(2026, 9, 11, 18, 54, 31),
    audiences: audienceOf(ruleId, 146),
  });
  assert.equal(pendingApprovals(forced).length, 1, "a forced run proposes");
  assert.equal(
    forced.rules.find((r) => r.id === ruleId)?.nextRunAt,
    ist(2026, 9, 14, 8, 0).toISOString(),
    "a 6:54 PM test must not make the rule a 6:54 PM rule",
  );
}

// --- interval rules are unaffected: they start now --------------------
{
  const created = createAutomationRule(emptyAutomation(), {
    name: "Queue drain",
    module: "comms",
    triggerType: "interval",
    intervalMinutes: 30,
    actionType: "whatsapp_template",
    templateFamilyKey: "fee_reminder",
  });
  const on = setRuleEnabled(created.state, created.rule.id, true);
  const now = ist(2026, 9, 11, 10, 0);
  const ticked = evaluateAutomationTick(on, {
    now,
    audiences: audienceOf(created.rule.id, 2),
  });
  assert.equal(
    pendingApprovals(ticked).length,
    1,
    "an interval rule has no wall clock to wait for",
  );
  assert.equal(
    ticked.rules.find((r) => r.id === created.rule.id)?.nextRunAt,
    new Date(now.getTime() + 30 * 60_000).toISOString(),
  );
}

console.log("  all schedule assertions passed");

// --- a rule already carrying a drifted next-run is re-anchored --------
{
  const { state, ruleId } = feeRule();
  // Exactly what production held: "+24h from the 6:54 PM test", i.e. a
  // Mon/Wed/Fri 8 AM rule sitting on 00:24 on a Saturday.
  const drifted: AutomationState = {
    ...state,
    rules: state.rules.map((r) =>
      r.id === ruleId
        ? { ...r, nextRunAt: ist(2026, 9, 12, 0, 24, 31).toISOString() }
        : r,
    ),
  };
  const ticked = evaluateAutomationTick(drifted, {
    now: ist(2026, 9, 11, 20, 0),
    audiences: audienceOf(ruleId, 146),
  });
  assert.equal(
    ticked.rules.find((r) => r.id === ruleId)?.nextRunAt,
    ist(2026, 9, 14, 8, 0).toISOString(),
    "a next-run that is not an occurrence of the cron is moved onto one",
  );
  assert.equal(pendingApprovals(ticked).length, 0);

  // And the midnight it used to be pointed at passes quietly.
  const midnight = evaluateAutomationTick(ticked, {
    now: ist(2026, 9, 12, 0, 24, 40),
    audiences: audienceOf(ruleId, 146),
  });
  assert.equal(
    pendingApprovals(midnight).length,
    0,
    "nothing at 00:24 on a Saturday — this is the whole incident",
  );
}

// --- editing the time moves the next run at once ----------------------
{
  const { state, ruleId } = feeRule();
  const armed = evaluateAutomationTick(state, {
    now: ist(2026, 9, 11, 9, 0),
    audiences: audienceOf(ruleId, 3),
  });
  assert.equal(
    armed.rules.find((r) => r.id === ruleId)?.nextRunAt,
    ist(2026, 9, 14, 8, 0).toISOString(),
  );
  const moved = updateRuleSchedule(armed, ruleId, {
    cronExpr: "0 17 * * 1-6",
  });
  const next = moved.rules.find((r) => r.id === ruleId)?.nextRunAt || "";
  assert.ok(
    next && next !== ist(2026, 9, 14, 8, 0).toISOString(),
    "the old 8 AM next-run must not survive a change to 5 PM",
  );
  const shifted = new Date(Date.parse(next) + 330 * 60_000);
  assert.equal(shifted.getUTCHours(), 17, "5 PM IST");
  assert.equal(shifted.getUTCMinutes(), 0);
}

console.log("  drift repair and schedule edits pinned");
