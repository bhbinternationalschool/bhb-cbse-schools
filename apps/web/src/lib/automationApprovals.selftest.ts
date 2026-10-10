/**
 * Run: npx tsx src/lib/automationApprovals.selftest.ts
 *
 * The approval queue and the run log, against the three faults this school
 * actually hit on 10 September 2026:
 *
 *   - four PENDING cards for one rule, two of them two seconds apart, 146
 *     families on each. Approving all four would have sent every family the
 *     same fee reminder four times.
 *   - "Snooze 24h" cleared the guard, so the next tick half an hour later
 *     raised the card the office had just put down.
 *   - a rejected card left its run reading "proposed 146 · dispatched 0"
 *     for ever, so the Runs tab filled with rows that looked like work
 *     still waiting to go out.
 */
import assert from "node:assert/strict";
import {
  decideApproval,
  emptyAutomation,
  evaluateAutomationTick,
  markApprovalDispatched,
  pendingApprovals,
  setRuleEnabled,
  type AutomationState,
  type ResolvedAudiences,
} from "./automation";

console.log("automationApprovals.selftest.ts");

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

function armed(): { state: AutomationState; ruleId: string } {
  const base = emptyAutomation();
  const ruleId = base.rules[0]!.id;
  return { state: setRuleEnabled(base, ruleId, true), ruleId };
}

// --- pressing "Run evaluation now" twice does not stack two cards -------
{
  const { state, ruleId } = armed();
  const once = evaluateAutomationTick(state, {
    forceRuleIds: [ruleId],
    audiences: audienceOf(ruleId, 2),
  });
  assert.equal(pendingApprovals(once).length, 1);

  const twice = evaluateAutomationTick(once, {
    forceRuleIds: [ruleId],
    audiences: audienceOf(ruleId, 2),
  });
  assert.equal(
    pendingApprovals(twice).length,
    1,
    "a second forced run must refresh the open card, never add one",
  );
  assert.equal(twice.runs.length, 1, "and must not add a second run either");

  // Ten presses, still one card. This is the shape of the real failure.
  let many = twice;
  for (let i = 0; i < 8; i++) {
    many = evaluateAutomationTick(many, {
      forceRuleIds: [ruleId],
      audiences: audienceOf(ruleId, 2),
    });
  }
  assert.equal(pendingApprovals(many).length, 1);
  assert.equal(many.runs.length, 1);
}

// --- a forced re-run brings CURRENT numbers onto the open card ---------
{
  const { state, ruleId } = armed();
  const small = evaluateAutomationTick(state, {
    forceRuleIds: [ruleId],
    audiences: audienceOf(ruleId, 2),
  });
  assert.equal(pendingApprovals(small)[0]?.audienceCount, 2);

  // The audience grew from 2 to 146, which is exactly what happened here.
  const grown = evaluateAutomationTick(small, {
    forceRuleIds: [ruleId],
    audiences: audienceOf(ruleId, 146),
  });
  const card = pendingApprovals(grown)[0]!;
  assert.equal(card.audienceCount, 146, "the card shows today's audience");
  assert.equal(card.dispatchPayload.length, 146);
  assert.equal(
    grown.runs[0]?.stats.proposed,
    146,
    "and its run is updated in place, not duplicated",
  );
  assert.equal(grown.runs.length, 1);
}

// --- an unforced tick leaves a waiting card alone ---------------------
{
  const { state, ruleId } = armed();
  const first = evaluateAutomationTick(state, {
    forceRuleIds: [ruleId],
    audiences: audienceOf(ruleId, 3),
  });
  const cardId = pendingApprovals(first)[0]!.id;

  const later = evaluateAutomationTick(first, {
    forceRuleIds: [ruleId],
    audiences: audienceOf(ruleId, 3),
  });
  assert.equal(pendingApprovals(later)[0]?.id, cardId, "same card, not a new one");
}

// --- snoozing actually snoozes ---------------------------------------
{
  const { state, ruleId } = armed();
  const raised = evaluateAutomationTick(state, {
    forceRuleIds: [ruleId],
    audiences: audienceOf(ruleId, 5),
  });
  const cardId = pendingApprovals(raised)[0]!.id;
  const snoozed = decideApproval(raised, cardId, "snoozed", "office", 24);
  assert.equal(pendingApprovals(snoozed).length, 0);

  // Half an hour later the cron lands. Before the fix this raised the very
  // card the office had just put down.
  const nextTick = evaluateAutomationTick(snoozed, {
    now: new Date(Date.now() + 30 * 60_000),
    audiences: audienceOf(ruleId, 5),
  });
  assert.equal(
    pendingApprovals(nextTick).length,
    0,
    "a snoozed card blocks a new one until the snooze expires",
  );
  assert.equal(nextTick.approvals.length, 1);

  // Once the snooze has run out, a card is raised again — that is the point
  // of snoozing rather than rejecting.
  const afterSnooze = evaluateAutomationTick(snoozed, {
    now: new Date(Date.now() + 25 * 3600_000),
    forceRuleIds: [ruleId],
    audiences: audienceOf(ruleId, 5),
  });
  assert.equal(pendingApprovals(afterSnooze).length, 1);
}

// --- rejecting closes the run instead of leaving it "proposed" --------
{
  const { state, ruleId } = armed();
  const raised = evaluateAutomationTick(state, {
    forceRuleIds: [ruleId],
    audiences: audienceOf(ruleId, 146),
  });
  const cardId = pendingApprovals(raised)[0]!.id;
  assert.equal(raised.runs[0]?.status, "proposed");

  const rejected = decideApproval(raised, cardId, "rejected", "director");
  assert.equal(
    rejected.runs[0]?.status,
    "cancelled",
    "a turned-down card must not read as work still waiting",
  );
  assert.ok(rejected.runs[0]?.finishedAt, "and it is finished");
  assert.match(String(rejected.runs[0]?.error), /director/);
  // The proposed count is kept: 146 families WERE proposed and refused.
  assert.equal(rejected.runs[0]?.stats.proposed, 146);
  assert.equal(rejected.runs[0]?.stats.dispatched, 0);
}

// --- approving does NOT close the run; sending does ------------------
{
  const { state, ruleId } = armed();
  const raised = evaluateAutomationTick(state, {
    forceRuleIds: [ruleId],
    audiences: audienceOf(ruleId, 4),
  });
  const cardId = pendingApprovals(raised)[0]!.id;

  const approved = decideApproval(raised, cardId, "approved", "office");
  assert.equal(
    approved.runs[0]?.status,
    "proposed",
    "approved is not sent — the run stays open until the dispatcher reports",
  );

  const sent = markApprovalDispatched(approved, cardId, true, "", {
    sent: 3,
    failed: 1,
  });
  assert.equal(sent.runs[0]?.status, "completed");
  assert.equal(sent.runs[0]?.stats.dispatched, 3);
  assert.equal(sent.runs[0]?.stats.failed, 1);
  assert.equal(
    sent.approvals.find((a) => a.id === cardId)?.status,
    "dispatched",
  );
}

// --- a rule with nothing to send raises no card at all ---------------
{
  const { state, ruleId } = armed();
  const quiet = evaluateAutomationTick(state, {
    forceRuleIds: [ruleId],
    audiences: audienceOf(ruleId, 0),
  });
  assert.equal(pendingApprovals(quiet).length, 0);
  assert.equal(quiet.runs[0]?.status, "completed");
  assert.equal(quiet.runs[0]?.stats.proposed, 0);
}

console.log("  ok");
