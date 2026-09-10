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
  approvalIsStale,
  evaluateAutomationTick,
  markApprovalDispatched,
  pendingApprovals,
  ruleWillEvaluate,
  undispatchedApprovals,
  type AutomationRule,
  type AutomationState,
  type ResolvedAudiences,
} from "@/lib/automation";
import { resolveAutomationAudienceServer } from "@/lib/automationAudience.server";
import { dispatchAutomationApproval } from "@/lib/automationDispatch.server";
import {
  automationApprovalClaimKey,
  claimSendOnce,
  releaseSendClaim,
} from "@/lib/waSendClaim.server";
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
  /** Previewed or stubbed, never handed to Meta. */
  simulated: number;
  /** Cards whose snapshot had gone stale and were failed rather than sent. */
  stale: number;
  /** Cards skipped because another sender held the send-once claim. */
  blocked: number;
  /** Rules whose audience could not be read, with the reason. */
  audienceErrors: { ruleId: string; error: string }[];
  persisted: boolean;
  persistError?: string;
  state: AutomationState;
};

/**
 * Rules worth resolving an audience for — the same test the evaluation applies.
 *
 * Each resolve is a roster and fee-ledger read, so asking this first matters:
 * every enabled rule used to be resolved, including event-driven ones that a
 * tick never fires, and rules sitting inside their own quiet hours.
 */
function candidateRules(
  state: AutomationState,
  now: Date,
  forceRuleIds?: string[],
): AutomationRule[] {
  const forced = new Set(forceRuleIds ?? []);
  return state.rules.filter((r) =>
    ruleWillEvaluate(r, now, forced.has(r.id)),
  );
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
  const now = new Date();
  const before = opts.state ?? (await loadAutomationFromDb());

  // Resolving is per-rule and independent, but the resolvers share hydration
  // (SIS, fees, admissions), so they run in sequence — parallel calls would
  // each pull the same roster.
  const audiences: ResolvedAudiences = {};
  const audienceErrors: { ruleId: string; error: string }[] = [];
  for (const rule of candidateRules(before, now, opts.forceRuleIds)) {
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
    now,
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
  let simulated = 0;
  let stale = 0;
  /** Cards another sender already had in hand — see claimSendOnce. */
  let blocked = 0;

  for (const item of undispatchedApprovals(after)) {
    // The payload is a snapshot of a family's dues at the moment the card
    // was raised. Too old and it is the wrong figure, so it is failed with
    // a reason rather than sent — the next evaluation raises a fresh card.
    if (approvalIsStale(item, now)) {
      stale++;
      after = markApprovalDispatched(
        after,
        item.id,
        false,
        "Not sent — this card was raised more than 12 hours ago and its amounts are out of date. The next evaluation will raise a fresh one.",
        { sent: 0, failed: 0 },
      );
      persisted = await saveAutomationToDb(after);
      if (!persisted.ok) {
        console.error("[automation-tick] persist failed:", persisted.error);
      }
      continue;
    }

    // Claim this card before sending it. Two ticks can overlap — Cloud
    // Scheduler retries a request it believes timed out, and "Run
    // evaluation now" can land while the cron tick is mid-flight — and
    // both would find the same approved card and send it. The claim makes
    // the second one skip it instead.
    const claimKey = automationApprovalClaimKey(item.id);
    const claim = await claimSendOnce(
      claimKey,
      "automation tick",
      `${item.dispatchPayload.length} recipients · rule ${item.ruleId}`,
    );
    if (!claim.ok) {
      blocked++;
      console.warn(`[automation-tick] skipped ${item.id}: ${claim.message}`);
      continue;
    }

    const rule = after.rules.find((r) => r.id === item.ruleId);
    const result = await dispatchAutomationApproval({
      item,
      module: rule?.module ?? "general",
      originUrl: opts.originUrl,
      dryRun: opts.dryRun,
    });
    sent += result.sent;
    failed += result.failed;
    deferred += result.deferred;
    simulated += result.simulated;

    // A dry run and an unconfigured provider both come back as "simulated".
    // Marking those cards dispatched would retire the very messages the run
    // was previewing, so the card is left approved for a real tick to send.
    if (result.simulatedOnly) {
      // Nothing was really sent, so the card stays sendable — and a lock
      // is only earned by a real message.
      await releaseSendClaim(claimKey);
      continue;
    }

    dispatched++;
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
    simulated,
    stale,
    blocked,
    audienceErrors,
    persisted: persisted.ok,
    persistError: persisted.ok ? undefined : persisted.error,
    state: after,
  };
}
