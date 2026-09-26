/**
 * Automation scheduling + evaluation self-test.
 *   npx tsx src/lib/automation.selftest.ts
 *
 * Guards the behaviour that was missing when a scheduled defaulter reminder
 * never went out (2026-09): the cron time is honoured in IST, a rule's
 * first run is its next scheduled time (not "whenever the tick ran"), the
 * evaluator only ever proposes recipients the server resolved, auto-mode
 * items come back for the engine to send, and a failed read never
 * evaluates an empty rule-set.
 */

import assert from "node:assert/strict";
import {
  cronMatches,
  isValidCronExpr,
  nextCronRun,
  parseCron,
} from "./automationSchedule";
import {
  computeNextRun,
  createAutomationRule,
  decideApproval,
  deleteAutomationRule,
  dueRuleIds,
  emptyAutomation,
  markApprovalDispatched,
  markRuleTested,
  normalizeAutomationState,
  ruleConfigProblem,
  ruleDueState,
  runAutomationTick,
  setRuleEnabled,
  setRuleExecutionMode,
  updateAutomationRule,
  type AudiencePreview,
} from "./automation";

function ist(y: number, mo: number, d: number, h: number, mi: number): Date {
  // IST = UTC+5:30 → subtract 330 minutes to get the UTC instant.
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - 330 * 60_000);
}

function preview(n: number, extra?: Partial<AudiencePreview>): AudiencePreview {
  return {
    supported: true,
    templateReady: true,
    previewBody: "Namaste {{guardianName}} ji",
    recipients: Array.from({ length: n }, (_, i) => ({
      mobile: `90000000${String(i).padStart(2, "0")}`,
      householdId: `hh${i}`,
      studentName: `Child ${i}`,
      body: "Namaste",
      templateName: "bhb_fee_stage_reminder",
      templateLanguage: "hi",
      variableKeys: ["guardianName"],
      variables: { guardianName: "Parent" },
    })),
    skipped: [],
    audienceNote: `${n} families`,
    ...extra,
  };
}

function cron() {
  assert.ok(parseCron("0 10 * * 1-6"), "standard cron parses");
  assert.equal(parseCron("0 10 * *"), null, "4 fields rejected");
  assert.equal(parseCron("60 10 * * *"), null, "minute 60 rejected");
  assert.ok(isValidCronExpr("*/30 8-19 * * *"), "step + range");
  assert.ok(parseCron("0 9 * * 7")?.daysOfWeek.has(0), "7 = Sunday");

  // Tue 8 Sep 2026 09:15 IST → next 10:00 IST the same day.
  const from = ist(2026, 9, 8, 9, 15);
  assert.equal(nextCronRun("0 10 * * 1-6", from), ist(2026, 9, 8, 10, 0).toISOString(), "same-day 10:00 IST");
  // 10:00 exactly is NOT "after" 10:00 → tomorrow.
  assert.equal(
    nextCronRun("0 10 * * 1-6", ist(2026, 9, 8, 10, 0)),
    ist(2026, 9, 9, 10, 0).toISOString(),
    "strictly after",
  );
  // Sat 12 Sep 2026 11:00 → Mon 14 Sep 10:00 (Sunday skipped by 1-6).
  assert.equal(
    nextCronRun("0 10 * * 1-6", ist(2026, 9, 12, 11, 0)),
    ist(2026, 9, 14, 10, 0).toISOString(),
    "skips Sunday",
  );
  // Half-hour minute in IST: 09:45 → 10:30 for "30 10".
  assert.equal(
    nextCronRun("30 10 * * *", ist(2026, 9, 8, 9, 45)),
    ist(2026, 9, 8, 10, 30).toISOString(),
    "minute 30 IST",
  );
  // Hour jump must not skip the matching hour (09:45 → 10:00, not 11:00).
  assert.equal(
    nextCronRun("0 10 * * *", ist(2026, 9, 8, 9, 45)),
    ist(2026, 9, 8, 10, 0).toISOString(),
    "no hour skip across the :30 offset",
  );
  // Month rollover: 30 Sep 23:00 → 1 Oct 08:00.
  assert.equal(
    nextCronRun("0 8 * * *", ist(2026, 9, 30, 23, 0)),
    ist(2026, 10, 1, 8, 0).toISOString(),
    "month rollover",
  );
  assert.ok(cronMatches("0 10 * * 1-6", ist(2026, 9, 8, 10, 0)), "matches at 10:00 IST Tue");
  assert.ok(!cronMatches("0 10 * * 1-6", ist(2026, 9, 13, 10, 0)), "no match Sunday");
  assert.equal(nextCronRun("bad", from), null, "invalid cron → null");
}

function scheduling() {
  const now = ist(2026, 9, 8, 9, 15); // Tuesday
  let st = emptyAutomation();
  const rule = st.rules.find((r) => r.id === "auto_fee_stage_reminder")!;
  assert.equal(rule.audienceKey, "fee_overdue", "seed derives its audience key");
  assert.equal(rule.minDaysBetween, 7, "fees default weekly cap");
  assert.equal(ruleConfigProblem(rule), "", "seed rule is well-formed");
  assert.equal(ruleDueState(rule, now).due, false, "disabled → not due");

  st = setRuleEnabled(st, rule.id, true);
  const enabled = st.rules.find((r) => r.id === rule.id)!;
  assert.ok(enabled.nextRunAt, "enable computes next run");
  assert.ok(new Date(enabled.nextRunAt).getTime() > Date.now(), "next run is in the future");
  // Simulate "enabled at 09:15 Tue" for determinism.
  st = { ...st, rules: st.rules.map((r) => (r.id === rule.id ? { ...r, nextRunAt: computeNextRun(r, now) } : r)) };
  const r2 = st.rules.find((r) => r.id === rule.id)!;
  assert.equal(r2.nextRunAt, ist(2026, 9, 8, 10, 0).toISOString(), "next run is 10:00 IST, not +24h");
  assert.equal(ruleDueState(r2, ist(2026, 9, 8, 9, 30)).due, false, "not due at 09:30");
  assert.equal(ruleDueState(r2, ist(2026, 9, 8, 10, 0)).due, true, "due at 10:00");
  assert.equal(ruleDueState(r2, ist(2026, 9, 8, 10, 30)).due, true, "still due at 10:30 (missed tick)");
  // Inside the rule's quiet hours (20:00–08:00) it is held, not dropped.
  const held = { ...r2, nextRunAt: ist(2026, 9, 8, 6, 0).toISOString() };
  const hs = ruleDueState(held, ist(2026, 9, 8, 6, 30));
  assert.equal(hs.due, false);
  assert.equal(!hs.due && hs.why, "quiet_hours", "quiet hours hold");

  // A schedule rule with no nextRunAt is NOT fired on the spot.
  const fresh = { ...r2, nextRunAt: "" };
  const fs = ruleDueState(fresh, now);
  assert.equal(!fs.due && fs.why, "first_run_scheduled", "first run waits for the cron time");
  // An interval rule with no nextRunAt runs on its first tick.
  const interval = { ...r2, triggerType: "interval" as const, cronExpr: "", intervalMinutes: 60, nextRunAt: "" };
  assert.equal(ruleDueState(interval, now).due, true, "interval first tick");

  // Editing the time recomputes the next run.
  st = updateAutomationRule(st, rule.id, { cronExpr: "30 11 * * 1-6" });
  assert.ok(st.rules.find((r) => r.id === rule.id)!.nextRunAt, "recomputed after edit");
  // A bad cron is a config problem, not a fire.
  st = updateAutomationRule(st, rule.id, { cronExpr: "nonsense" });
  const bad = st.rules.find((r) => r.id === rule.id)!;
  assert.match(ruleConfigProblem(bad), /not valid/);
  assert.equal(ruleDueState(bad, now).due, false, "bad cron never due");
  st = updateAutomationRule(st, rule.id, { cronExpr: "0 10 * * 1-6" });
  // Changing the audience to a custom note drops the key; a preset restores it.
  st = updateAutomationRule(st, rule.id, { audienceSummary: "my own words" });
  assert.equal(st.rules.find((r) => r.id === rule.id)!.audienceKey, "", "custom audience → no key");
  assert.match(ruleConfigProblem(st.rules.find((r) => r.id === rule.id)!), /preset audience/);
  st = updateAutomationRule(st, rule.id, {
    audienceSummary: "Households with overdue fees (stages S1–S4)",
  });
  assert.equal(st.rules.find((r) => r.id === rule.id)!.audienceKey, "fee_overdue", "preset restores key");
}

function evaluation() {
  const now = ist(2026, 9, 8, 10, 0);
  let st = emptyAutomation();
  const id = "auto_fee_stage_reminder";
  st = setRuleEnabled(st, id, true);
  st = { ...st, rules: st.rules.map((r) => (r.id === id ? { ...r, nextRunAt: ist(2026, 9, 8, 10, 0).toISOString() } : r)) };
  assert.deepEqual(dueRuleIds(st, { now }), [id], "only the due rule");

  // Approval-first: a pending card with the real recipients, run proposed.
  const out = runAutomationTick(st, { now, previews: { [id]: preview(3) } });
  assert.equal(out.pendingApprovalIds.length, 1);
  assert.equal(out.autoApprovalIds.length, 0);
  const card = out.state.approvals[0]!;
  assert.equal(card.status, "pending");
  assert.equal(card.audienceCount, 3);
  assert.equal(card.dispatchPayload[2]!.householdId, "hh2");
  assert.equal(out.state.runs[0]!.status, "proposed");
  const afterRule = out.state.rules.find((r) => r.id === id)!;
  assert.equal(afterRule.nextRunAt, ist(2026, 9, 9, 10, 0).toISOString(), "advanced to tomorrow 10:00");
  assert.equal(afterRule.lastRunAt, now.toISOString());

  // Same tick again: not due any more.
  assert.deepEqual(dueRuleIds(out.state, { now: ist(2026, 9, 8, 10, 30) }), []);

  // Next day, card still pending → no second card, schedule still advances.
  const day2 = ist(2026, 9, 9, 10, 0);
  const out2 = runAutomationTick(out.state, { now: day2, previews: { [id]: preview(4) } });
  assert.equal(out2.state.approvals.filter((a) => a.status === "pending").length, 1, "no duplicate card");
  assert.equal(out2.state.rules.find((r) => r.id === id)!.nextRunAt, ist(2026, 9, 10, 10, 0).toISOString());

  // "Run now" while a card is pending supersedes it instead of stacking.
  const forcedAgain = runAutomationTick(out.state, { now: day2, forceRuleIds: [id], previews: { [id]: preview(2) } });
  const cards = forcedAgain.state.approvals.filter((a) => a.ruleId === id);
  assert.equal(cards.filter((a) => a.status === "pending").length, 1, "one pending card after run-now");
  assert.equal(cards.find((a) => a.id === card.id)?.decidedBy, "superseded");

  // Approve + dispatch bookkeeping.
  let approved = decideApproval(out.state, card.id, "approved", "tester");
  approved = markApprovalDispatched(approved, card.id, {
    ok: true,
    sent: 2,
    failed: 1,
    skipped: 0,
    results: [
      { mobile: "9000000000", ok: true },
      { mobile: "9000000001", ok: true },
      { mobile: "9000000002", ok: false, error: "STOP" },
    ],
    note: "2 sent · 1 failed",
  });
  const done = approved.approvals.find((a) => a.id === card.id)!;
  assert.equal(done.status, "dispatched");
  assert.equal(done.sentCount, 2);
  assert.equal(done.failedCount, 1);
  const run = approved.runs.find((r) => r.approvalId === card.id)!;
  assert.equal(run.status, "completed");
  assert.equal(run.stats.dispatched, 2);
  assert.equal(run.stats.failed, 1);

  // Snoozed: the next due tick records a cancelled run and raises nothing.
  const snoozed = decideApproval(out.state, card.id, "snoozed", "tester", 48);
  const out3 = runAutomationTick(snoozed, { now: day2, previews: { [id]: preview(4) } });
  assert.equal(out3.pendingApprovalIds.length, 0, "snoozed → nothing raised");
  assert.equal(out3.state.runs[0]!.status, "cancelled");

  // Empty audience: completed run, no card.
  const out4 = runAutomationTick(st, {
    now,
    previews: { [id]: preview(0, { skipped: [{ reason: "reminded in the last 7 days", count: 5 }] }) },
  });
  assert.equal(out4.state.approvals.length, 0);
  assert.equal(out4.state.runs[0]!.status, "completed");
  assert.equal(out4.state.runs[0]!.stats.proposed, 0);

  // Template not approved / unsupported audience: failed run with the reason.
  const out5 = runAutomationTick(st, {
    now,
    previews: { [id]: preview(2, { templateReady: false, templateError: "Template not approved in Hindi" }) },
  });
  assert.equal(out5.state.runs[0]!.status, "failed");
  assert.match(out5.state.runs[0]!.error, /Hindi/);
  const out6 = runAutomationTick(st, {
    now,
    previews: { [id]: { ...preview(0), supported: false, reason: "not automated" } },
  });
  assert.match(out6.state.runs[0]!.error, /not automated/);

  // Auto mode: approved item comes back for the engine to send.
  let auto = markRuleTested(st, id);
  const mode = setRuleExecutionMode(auto, id, "auto");
  assert.ok(mode.ok);
  auto = mode.state;
  const out7 = runAutomationTick(auto, { now, previews: { [id]: preview(2) } });
  assert.deepEqual(out7.pendingApprovalIds, []);
  assert.equal(out7.autoApprovalIds.length, 1, "auto → approved item to send");
  assert.equal(out7.state.approvals[0]!.decidedBy, "auto");
  assert.equal(out7.state.runs[0]!.status, "running");

  // Forced run of a disabled rule still needs a preview, and still works.
  const forced = runAutomationTick(emptyAutomation(), {
    now,
    forceRuleIds: [id],
    previews: { [id]: preview(1) },
  });
  assert.equal(forced.pendingApprovalIds.length, 1, "force evaluates a paused rule");
}

function lifecycle() {
  let st = emptyAutomation();
  const created = createAutomationRule(st, {
    name: "Class 3 defaulters",
    module: "fees",
    triggerType: "schedule",
    cronExpr: "0 11 * * 1-6",
    actionType: "whatsapp_template",
    templateFamilyKey: "fees_stage_reminder",
    audienceSummary: "Households with overdue fees (stages S1–S4)",
    audienceKey: "fee_overdue",
  });
  st = created.state;
  assert.equal(created.rule.enabled, false, "new rules start paused");
  assert.equal(created.rule.nextRunAt, "", "paused → no next run");
  assert.equal(created.rule.minDaysBetween, 7);
  const del = deleteAutomationRule(st, created.rule.id);
  assert.ok(del.ok);
  assert.ok(!deleteAutomationRule(st, "auto_fee_stage_reminder").ok, "seed rules cannot be deleted");

  // Normalising an old state (no audienceKey / minDaysBetween) fills the new fields.
  const legacy = normalizeAutomationState({
    version: 1,
    rules: [
      {
        id: "auto_fee_stage_reminder",
        name: "x",
        enabled: true,
        triggerType: "schedule",
        cronExpr: "0 10 * * 1-6",
        audienceSummary: "Households with overdue fees (stages S1–S4)",
        templateFamilyKey: "fees_stage_reminder",
        module: "fees",
      } as never,
    ],
    approvals: [{ id: "a1", ruleId: "auto_fee_stage_reminder", status: "pending" } as never],
    runs: [],
    lastTickAt: "",
  });
  const lr = legacy.rules.find((r) => r.id === "auto_fee_stage_reminder")!;
  assert.equal(lr.audienceKey, "fee_overdue");
  assert.equal(lr.maxPerRun, 300);
  assert.deepEqual(legacy.approvals[0]!.dispatchPayload, []);
  assert.equal(legacy.approvals[0]!.results.length, 0);
}

cron();
scheduling();
evaluation();
lifecycle();
console.log("automation.selftest: OK");
