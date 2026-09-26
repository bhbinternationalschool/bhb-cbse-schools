/**
 * The automation engine, server-side: one tick = load rules → build each
 * due rule's real audience → raise approvals (or auto-approve) → SEND the
 * auto-approved ones → save. Approving a card from Masters → Automation
 * runs the same send path, so "Approve & send" and auto mode cannot drift.
 *
 * Before 2026-09 the tick only did bookkeeping: an auto-mode rule was
 * marked "approved" with nothing dispatched, and the only code that ever
 * called WhatsApp was the browser's Approve button — with two sample
 * numbers. A rule the director scheduled to remind defaulters therefore
 * produced no message to any family, and no error either.
 */

import "server-only";

import {
  dueRuleIds,
  isInQuietHours,
  markApprovalDispatched,
  decideApproval,
  runAutomationTick,
  type AudiencePreview,
  type AutomationApprovalItem,
  type AutomationSendResult,
  type AutomationState,
  type DispatchOutcome,
} from "@/lib/automation";
import { resolveAutomationAudience } from "@/lib/automationAudience.server";
import { recordAutomationSends } from "@/lib/automationLedger.server";
import {
  loadAutomationFromDb,
  saveAutomationToDb,
} from "@/lib/automationState.server";
import { logHouseholdWaSend } from "@/lib/householdMessageLog.server";
import { istDateOf } from "@/lib/teaching";
import {
  buildWaTemplateBodyComponent,
  sendWaWithFailover,
  waOutboundConfigured,
} from "@/lib/waSend";

/* ─── Sending one approval ──────────────────────────────────────────── */

/**
 * Send every recipient on an approval. Each family gets its own template
 * in its own language with its own variables; results are recorded per
 * recipient so the card can show who got it and who did not.
 */
export async function sendApprovalPayload(
  item: AutomationApprovalItem,
  opts?: { now?: Date },
): Promise<DispatchOutcome> {
  if (!waOutboundConfigured()) {
    return {
      ok: false,
      error: "WhatsApp sending is not configured on the server (WHATSAPP_TOKEN / WHATSAPP_PHONE_ID)",
      sent: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };
  }
  const todayIso = istDateOf(opts?.now);
  // Resume-safe: a card that was interrupted mid-send (deploy, timeout)
  // keeps the results it already has, and a re-approval only sends to the
  // families that did not get it.
  const alreadySent = new Set(item.results.filter((x) => x.ok).map((x) => x.mobile));
  const results: AutomationSendResult[] = item.results.filter((x) => x.ok);
  const remindedOn: Record<string, string> = {};
  let sent = results.length;
  let failed = 0;
  const errors: string[] = [];

  for (const r of item.dispatchPayload) {
    if (!r.mobile || alreadySent.has(r.mobile)) continue;
    const template =
      r.templateName
        ? {
            name: r.templateName,
            language: r.templateLanguage || r.language || "en",
            components: [
              buildWaTemplateBodyComponent(r.variableKeys || [], r.variables || {}),
            ],
          }
        : undefined;
    const res = await sendWaWithFailover({
      primaryMobile: r.mobile,
      fallbackMobile: r.fallbackMobile,
      template,
      body: template ? undefined : r.body,
      clientMessageId: `auto_${item.id}_${r.householdId || r.mobile}`,
    });
    results.push({
      mobile: r.mobile,
      householdId: r.householdId,
      ok: res.ok,
      error: res.ok ? undefined : res.error,
      providerId: res.providerId,
    });
    if (res.ok) {
      sent += 1;
      if (r.householdId) remindedOn[r.householdId] = todayIso;
    } else {
      failed += 1;
      if (res.error && errors.length < 3 && !errors.includes(res.error)) errors.push(res.error);
    }
    await logHouseholdWaSend({
      mobile: res.usedFallback && r.fallbackMobile ? r.fallbackMobile : r.mobile,
      purpose: `automation:${item.templateFamilyKey || item.ruleId}`,
      via: template ? "template" : "text",
      templateName: template?.name,
      preview: r.body,
      status: res.ok ? "sent" : "failed",
      error: res.ok ? undefined : res.error,
      waMessageId: res.providerId,
    });
  }

  await recordAutomationSends(remindedOn);

  const attempted = sent + failed;
  const ok = attempted > 0 && sent > 0;
  return {
    ok,
    error: ok ? undefined : errors[0] || (attempted === 0 ? "No recipients with a mobile number" : "Every send failed"),
    sent,
    failed,
    skipped: Math.max(0, item.dispatchPayload.length - attempted),
    results,
    note: `${sent} sent${failed ? ` · ${failed} failed` : ""}${errors.length ? ` · ${errors[0]}` : ""}`,
  };
}

/** Approve a pending card and send it. Idempotent: a card already sent is refused. */
export async function dispatchApprovalServer(
  state: AutomationState,
  approvalId: string,
  by: string,
): Promise<{ ok: boolean; state: AutomationState; outcome?: DispatchOutcome; error?: string }> {
  const item = state.approvals.find((a) => a.id === approvalId);
  if (!item) return { ok: false, state, error: "Approval not found" };
  if (item.status === "dispatched") {
    return { ok: false, state, error: "Already sent" };
  }
  if (item.status !== "pending" && item.status !== "approved" && item.status !== "snoozed") {
    return { ok: false, state, error: `Approval is ${item.status}` };
  }
  const rule = state.rules.find((r) => r.id === item.ruleId);
  if (rule && rule.quietHours.enabled) {
    if (isInQuietHours(rule.quietHours)) {
      return {
        ok: false,
        state,
        error: `Inside quiet hours (${rule.quietHours.startHour}:00–${rule.quietHours.endHour}:00 ${rule.quietHours.timezone}) — nothing sent. Approve again after ${rule.quietHours.endHour}:00.`,
      };
    }
  }
  const approved = item.status === "approved" ? state : decideApproval(state, approvalId, "approved", by);
  const outcome = await sendApprovalPayload(item);
  return {
    ok: outcome.ok,
    state: markApprovalDispatched(approved, approvalId, outcome),
    outcome,
    error: outcome.ok ? undefined : outcome.error,
  };
}

/* ─── The tick ──────────────────────────────────────────────────────── */

export type ServerTickResult = {
  ok: boolean;
  error?: string;
  state?: AutomationState;
  evaluated: string[];
  pendingApprovals: number;
  autoSent: number;
  autoFailed: number;
  notes: string[];
  persisted: boolean;
  persistError?: string;
};

let tickInFlight: Promise<ServerTickResult> | null = null;

/**
 * One full tick. Serialised per process: Cloud Scheduler retries and a
 * person pressing "Run now" at the same moment must not both send.
 */
export async function runServerAutomationTick(opts?: {
  forceRuleIds?: string[];
  now?: Date;
  /** Evaluate and raise approvals but do not send auto-mode rules or save. */
  dryRun?: boolean;
  /** State to evaluate instead of the DB copy (tests). */
  state?: AutomationState;
}): Promise<ServerTickResult> {
  if (tickInFlight) return tickInFlight;
  tickInFlight = (async () => {
    try {
      return await runServerAutomationTickInner(opts);
    } finally {
      tickInFlight = null;
    }
  })();
  return tickInFlight;
}

async function runServerAutomationTickInner(opts?: {
  forceRuleIds?: string[];
  now?: Date;
  dryRun?: boolean;
  state?: AutomationState;
}): Promise<ServerTickResult> {
  const now = opts?.now || new Date();
  let before: AutomationState;
  if (opts?.state) {
    before = opts.state;
  } else {
    const read = await loadAutomationFromDb();
    if (!read.ok) {
      return {
        ok: false,
        error: `Automation state could not be read: ${read.error}`,
        evaluated: [],
        pendingApprovals: 0,
        autoSent: 0,
        autoFailed: 0,
        notes: [],
        persisted: false,
      };
    }
    before = read.state;
  }

  const due = dueRuleIds(before, { forceRuleIds: opts?.forceRuleIds, now });
  const previews: Record<string, AudiencePreview | undefined> = {};
  for (const id of due) {
    const rule = before.rules.find((r) => r.id === id);
    if (!rule) continue;
    previews[id] = await resolveAutomationAudience(rule, { now });
  }

  const tick = runAutomationTick(before, {
    forceRuleIds: opts?.forceRuleIds,
    now,
    previews,
  });
  let state = tick.state;
  let autoSent = 0;
  let autoFailed = 0;

  if (!opts?.dryRun) {
    // Persist the raised approvals BEFORE sending, so a crash mid-send
    // leaves a card (marked approved, not dispatched) rather than nothing.
    const first = await saveAutomationToDb(state);
    if (!first.ok) {
      return {
        ok: false,
        error: `Could not save automation state: ${first.error}`,
        state,
        evaluated: due,
        pendingApprovals: tick.pendingApprovalIds.length,
        autoSent: 0,
        autoFailed: 0,
        notes: tick.notes,
        persisted: false,
        persistError: first.error,
      };
    }
    for (const approvalId of tick.autoApprovalIds) {
      const item = state.approvals.find((a) => a.id === approvalId);
      if (!item) continue;
      const outcome = await sendApprovalPayload(item, { now });
      state = markApprovalDispatched(state, approvalId, outcome);
      autoSent += outcome.sent;
      autoFailed += outcome.failed;
      tick.notes.push(`${item.ruleName}: ${outcome.note || outcome.error || ""}`);
    }
  }

  const persisted = opts?.dryRun ? { ok: true as const, error: undefined } : await saveAutomationToDb(state);
  if (!persisted.ok) console.error("[automation-tick] persist failed:", persisted.error);

  return {
    ok: true,
    state,
    evaluated: due,
    pendingApprovals: state.approvals.filter((a) => a.status === "pending").length,
    autoSent,
    autoFailed,
    notes: tick.notes,
    persisted: persisted.ok,
    persistError: persisted.ok ? undefined : persisted.error,
  };
}

/** What a rule would send right now — no state change, no send. */
export async function previewRuleAudience(
  state: AutomationState,
  ruleId: string,
  opts?: { ignoreCap?: boolean },
): Promise<AudiencePreview | { supported: false; reason: string }> {
  const rule = state.rules.find((r) => r.id === ruleId);
  if (!rule) return { supported: false, reason: "Rule not found" };
  return resolveAutomationAudience(rule, { ignoreCap: opts?.ignoreCap });
}
