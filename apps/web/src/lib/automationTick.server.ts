/**
 * One automation tick, end to end.
 *
 * Shared by the cron route (`/api/wa/automation/tick`, job secret) and the
 * staff button (`/api/wa/automation/run`, RBAC) so both do exactly the same
 * thing: read the rules from the database, resolve each due rule's audience
 * from live data, raise approval cards, SEND the ones that are approved, and
 * persist the result.
 *
 * The sending half is the point. Before it, an auto-run rule recorded a
 * completed run with `dispatched: 0` and nothing left the building.
 */

import "server-only";

import {
  evaluateAutomationTick,
  markApprovalDispatched,
  pendingApprovals,
  undispatchedApprovals,
  type AutomationRule,
  type AutomationState,
  type ResolvedAudiences,
} from "@/lib/automation";
import { resolveAutomationAudienceServer } from "@/lib/automationAudience.server";
import { dispatchAutomationApproval } from "@/lib/automationDispatch.server";
import {
  loadAutomationFromDb,
  saveAutomationToDb,
} from "@/lib/automationState.server";

export type AutomationTickReport = {
  lastTickAt: string;
  pendingApprovals: number;
  /** Approvals the tick sent for real this run. */
  dispatched: number;
  sent: number;
  failed: number;
  deferred: number;
  /** Rules whose audience could not be read, with the reason. */
  audienceErrors: { ruleId: string; error: string }[];
  persisted: boolean;
  persistError?: string;
  state: AutomationState;
};

/** Rules this tick will evaluate — the same test `evaluateAutomationTick` applies. */
function candidateRules(
  state: AutomationState,
  forceRuleIds?: string[],
): AutomationRule[] {
  const forced = new Set(forceRuleIds ?? []);
  return state.rules.filter((r) => forced.has(r.id) || r.enabled);
}

export async function runAutomationTick(opts: {
  /** Any request from the running server — the dispatch URL needs an origin. */
  originUrl: string;
  /** Evaluate a posted state instead of the tenant's stored one (tests). */
  state?: AutomationState;
  forceRuleIds?: string[];
  /** Resolve and propose, but do not send. */
  dryRun?: boolean;
}): Promise<AutomationTickReport> {
  const before = opts.state ?? (await loadAutomationFromDb());

  // Resolving is per-rule and independent, but the resolvers share hydration
  // (SIS, fees, admissions), so they run in sequence — parallel calls would
  // each pull the same roster.
  const audiences: ResolvedAudiences = {};
  const audienceErrors: { ruleId: string; error: string }[] = [];
  for (const rule of candidateRules(before, opts.forceRuleIds)) {
    const resolved = await resolveAutomationAudienceServer(rule);
    if (resolved.ok) {
      audiences[rule.id] = { ok: true, recipients: resolved.recipients, note: resolved.note };
    } else {
      audiences[rule.id] = resolved;
      audienceErrors.push({ ruleId: rule.id, error: resolved.error });
    }
  }

  let after = evaluateAutomationTick(before, {
    forceRuleIds: opts.forceRuleIds,
    audiences,
  });

  // Persist the cards BEFORE sending anything, and again after each one.
  //
  // Cloud Run cuts a request at its 300s timeout. Saving only at the end
  // meant a tick cut off mid-send had already delivered messages that the
  // stored state knew nothing about — so the next tick found the same card
  // still "approved" and sent the whole audience again. Families would be
  // chased twice for the same fee. Writing after each approval bounds that
  // to the one card actually in flight when the plug was pulled.
  let persisted = await saveAutomationToDb(after);
  if (!persisted.ok) {
    console.error("[automation-tick] persist failed:", persisted.error);
  }

  let dispatched = 0;
  let sent = 0;
  let failed = 0;
  let deferred = 0;

  for (const item of undispatchedApprovals(after)) {
    const rule = after.rules.find((r) => r.id === item.ruleId);
    const result = await dispatchAutomationApproval({
      item,
      module: rule?.module ?? "general",
      originUrl: opts.originUrl,
      dryRun: opts.dryRun,
    });
    dispatched++;
    sent += result.sent;
    failed += result.failed;
    deferred += result.deferred;
    after = markApprovalDispatched(after, item.id, result.ok, result.error, {
      sent: result.sent,
      failed: result.failed,
      deferred: result.deferred,
    });
    persisted = await saveAutomationToDb(after);
    if (!persisted.ok) {
      console.error("[automation-tick] persist failed:", persisted.error);
    }
  }

  return {
    lastTickAt: after.lastTickAt,
    pendingApprovals: pendingApprovals(after).length,
    dispatched,
    sent,
    failed,
    deferred,
    audienceErrors,
    persisted: persisted.ok,
    persistError: persisted.ok ? undefined : persisted.error,
    state: after,
  };
}
