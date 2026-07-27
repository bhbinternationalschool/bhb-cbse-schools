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
  markRuleTested,
  pendingApprovals,
  setRuleEnabled,
  setRuleExecutionMode,
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
  auto = setRuleEnabled(auto, auto.rules[0]!.id, true);
  auto = evaluateAutomationTick(auto, { forceRuleIds: [auto.rules[0]!.id] });
  const pending = pendingApprovals(auto);
  assert(pending.length >= 1, "approval-first creates pending item");

  const modeBlock = setRuleExecutionMode(auto, auto.rules[0]!.id, "auto");
  assert(!modeBlock.ok, "auto mode blocked before tested");
  auto = markRuleTested(auto, auto.rules[0]!.id);
  const modeOk = setRuleExecutionMode(auto, auto.rules[0]!.id, "auto");
  assert(modeOk.ok, "auto mode after tested");

  auto = decideApproval(auto, pending[0]!.id, "approved", "selftest");
  assert(
    auto.approvals.find((a) => a.id === pending[0]!.id)?.status === "approved",
    "approval decided",
  );

  console.log("waTemplatesAutomation.selftest: OK");
}

main();
