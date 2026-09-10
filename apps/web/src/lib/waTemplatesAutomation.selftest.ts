/**
 * Quick self-test: npx tsx src/lib/waTemplatesAutomation.selftest.ts
 */

import {
  applyMetaTemplateSync,
  buildTemplateBodyParameters,
  emptyWaTemplates,
  mapMetaTemplateStatus,
  normalizeWaTemplatesState,
  seedWaTemplates,
} from "./waTemplates";
import {
  decideApproval,
  emptyAutomation,
  evaluateAutomationTick,
  markApprovalDispatched,
  markRuleTested,
  pendingApprovals,
  setRuleEnabled,
  normalizeAutomationState,
  setRuleExecutionMode,
  undispatchedApprovals,
  updateAutomationRule,
} from "./automation";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function main() {
  const seeds = seedWaTemplates();
  assert(seeds.length >= 40, `expected EN+HI seed catalog, got ${seeds.length}`);
  assert(
    seeds.every((t) => t.language === "en" || t.language === "hi"),
    "all seeds must be en|hi",
  );
  assert(
    seeds.some((t) => t.carousel.length >= 2),
    "expected carousel marketing templates",
  );
  assert(
    seeds.some((t) => t.headerFormat === "IMAGE" || t.headerFormat === "DOCUMENT"),
    "expected media header templates",
  );

  assert(mapMetaTemplateStatus("APPROVED") === "approved", "APPROVED map");
  assert(mapMetaTemplateStatus("PENDING") === "pending", "PENDING map");
  assert(mapMetaTemplateStatus("REJECTED") === "rejected", "REJECTED map");

  let tpl = emptyWaTemplates();
  tpl = applyMetaTemplateSync(tpl, [
    {
      name: "bhb_registration_invite",
      language: "en",
      status: "APPROVED",
      id: "meta_1",
    },
  ]);
  const approved = tpl.templates.find(
    (t) => t.metaName === "bhb_registration_invite" && t.language === "en",
  );
  assert(approved?.status === "approved", "sync should approve matching seed");

  const params = buildTemplateBodyParameters(approved!, {
    guardianName: "Ravi",
    childName: "Asha",
    schoolName: "BHB",
    registerLink: "https://example.com/register",
  });
  assert(params.length === approved!.variables.length, "param count");

  const merged = normalizeWaTemplatesState({ version: 1, templates: [] });
  assert(merged.templates.length === seeds.length, "normalize reseeds empty");

  let auto = emptyAutomation();
  assert(auto.rules.length >= 10, "automation seed rules");
  const ruleId = auto.rules[0]!.id;
  auto = setRuleEnabled(auto, ruleId, true);

  // No resolved audience → no approval card. The tick used to invent two
  // demo mobiles here, which an auto-run rule would have really messaged.
  const noAudience = evaluateAutomationTick(auto, { forceRuleIds: [ruleId] });
  assert(
    pendingApprovals(noAudience).length === 0,
    "no audience raises no approval",
  );
  assert(
    noAudience.runs[0]?.status === "failed" && !!noAudience.runs[0]?.error,
    "no audience records a failed run with the reason",
  );

  auto = evaluateAutomationTick(auto, {
    forceRuleIds: [ruleId],
    audiences: {
      [ruleId]: {
        ok: true,
        note: "1 recipient from live data",
        recipients: [
          {
            mobile: "9000000001",
            language: "hi",
            label: "Asha · V-A",
            variables: { guardianName: "Ravi", childName: "Asha" },
          },
        ],
      },
    },
  });
  const pending = pendingApprovals(auto);
  assert(pending.length === 1, "approval-first creates pending item");
  assert(
    pending[0]!.dispatchPayload.length === 1 &&
      pending[0]!.dispatchPayload[0]!.mobile === "9000000001" &&
      pending[0]!.dispatchPayload[0]!.language === "hi",
    "approval carries the resolved recipient, in that family's language",
  );

  const modeBlock = setRuleExecutionMode(auto, ruleId, "auto");
  assert(!modeBlock.ok, "auto mode blocked before tested");
  auto = markRuleTested(auto, ruleId);
  const modeOk = setRuleExecutionMode(auto, ruleId, "auto");
  assert(modeOk.ok, "auto mode after tested");

  auto = decideApproval(auto, pending[0]!.id, "approved", "selftest");
  assert(
    auto.approvals.find((a) => a.id === pending[0]!.id)?.status === "approved",
    "approval decided",
  );

  // Approved but not yet sent — the next tick picks it up rather than
  // leaving it approved and undelivered forever.
  assert(
    undispatchedApprovals(auto).some((a) => a.id === pending[0]!.id),
    "approved-but-unsent card is queued for the next tick",
  );

  // An auto-run rule stays "running" until something really dispatches it.
  const live = setRuleExecutionMode(
    markRuleTested(setRuleEnabled(emptyAutomation(), ruleId, true), ruleId),
    ruleId,
    "auto",
  );
  if (!live.ok) throw new Error("auto mode for the dispatch check");
  let autoState = evaluateAutomationTick(live.state, {
    forceRuleIds: [ruleId],
    audiences: {
      [ruleId]: {
        ok: true,
        note: "1 recipient from live data",
        recipients: [
          { mobile: "9000000002", label: "Kabir · VI-B", variables: {} },
        ],
      },
    },
  });
  const autoRun = autoState.runs.find((r) => r.ruleId === ruleId);
  assert(
    autoRun?.status === "running" && autoRun.stats.dispatched === 0,
    "auto-run does not report a completed send before dispatch",
  );
  const autoCard = autoState.approvals.find((a) => a.ruleId === ruleId)!;
  autoState = markApprovalDispatched(autoState, autoCard.id, true, "", {
    sent: 1,
    failed: 0,
  });
  const doneRun = autoState.runs.find((r) => r.approvalId === autoCard.id);
  assert(
    doneRun?.status === "completed" && doneRun.stats.dispatched === 1,
    "dispatch result is what the run reports",
  );

  // The fee threshold is a number the resolver reads, not a phrase in the
  // audience label. It survives normalize and is settable per rule.
  const feeRule = emptyAutomation().rules.find((r) => r.module === "fees")!;
  assert(feeRule.minAmountPaise === 0, "seeded fee rule has no floor");
  const withFloor = updateAutomationRule(emptyAutomation(), feeRule.id, {
    minAmountPaise: 500000,
  });
  assert(
    withFloor.rules.find((r) => r.id === feeRule.id)?.minAmountPaise === 500000,
    "fee floor is set on the rule",
  );
  assert(
    normalizeAutomationState(withFloor).rules.find((r) => r.id === feeRule.id)
      ?.minAmountPaise === 500000,
    "fee floor survives normalize",
  );
  assert(
    normalizeAutomationState({
      version: 1,
      rules: [{ ...feeRule, minAmountPaise: -5 } as never],
    }).rules.find((r) => r.id === feeRule.id)?.minAmountPaise === 0,
    "a negative floor normalizes to no floor",
  );

  // Pressing "Run evaluation now" twice must not message the same families
  // twice — an auto-run rule that just sent is skipped.
  const cardsBefore = autoState.approvals.length;
  autoState = evaluateAutomationTick(autoState, {
    forceRuleIds: [ruleId],
    audiences: {
      [ruleId]: {
        ok: true,
        note: "1 recipient from live data",
        recipients: [
          { mobile: "9000000002", label: "Kabir · VI-B", variables: {} },
        ],
      },
    },
  });
  assert(
    autoState.approvals.length === cardsBefore,
    "auto-run does not re-send within the guard window",
  );

  console.log("waTemplatesAutomation.selftest: OK");
}

main();
