"use client";

import { useCallback, useEffect, useState } from "react";
import { ensureAutomationHydrated } from "@/lib/automationPersistence";
import {
  loadAutomation,
  markRuleTested,
  normalizeAutomationState,
  saveAutomation,
  setRuleEnabled,
  setRuleExecutionMode,
  updateAutomationRule,
  updateRuleSchedule,
  writeAutomationLocalRaw,
  type AutomationApprovalItem,
  type AutomationState,
} from "@/lib/automation";
import {
  useDemoSession,
  useSessionReadOnly,
} from "@/components/shell/SessionContext";

export function useAutomationDesk() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const [state, setState] = useState<AutomationState | null>(() =>
    typeof window !== "undefined" ? loadAutomation() : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const by = session.fullName || session.roleCode || "masters";

  const refresh = useCallback(() => {
    setState(loadAutomation());
  }, []);

  useEffect(() => {
    refresh();
    void (async () => {
      await ensureAutomationHydrated();
      refresh();
    })();
  }, [refresh]);

  function flash(msg: string, ms = 2800) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), ms);
  }

  function commit(next: AutomationState, msg?: string) {
    if (readOnly) {
      flash("Session is closed — automation is read-only");
      return false;
    }
    setState(next);
    saveAutomation(next);
    if (msg) flash(msg);
    return true;
  }

  /**
   * Decide one card on the server, which also sends it.
   *
   * The browser cannot see which templates Meta has approved (an unhydrated
   * `loadWaTemplates()` reports none), so deciding here used to fall back to
   * free text — invisible to any family outside the 24-hour window. The
   * route resolves the approved template per family language instead.
   */
  async function decideApprovalServer(
    approvalId: string,
    decision: "approved" | "rejected" | "snoozed",
    snoozeHours?: number,
  ) {
    if (!state) return;
    if (readOnly) {
      flash("Session is closed — automation is read-only");
      return;
    }
    try {
      const res = await fetch("/api/wa/automation/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, decision, snoozeHours }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        sent?: number;
        failed?: number;
        deferred?: number;
        simulated?: number;
        state?: AutomationState;
      };
      if (json.state) {
        const next = normalizeAutomationState(json.state);
        writeAutomationLocalRaw(next);
        setState(next);
      }
      if (!res.ok || !json.state) {
        flash(json.error || "Could not update this card", 5000);
        return;
      }
      if (decision === "rejected") return flash("Rejected");
      if (decision === "snoozed") return flash("Snoozed 24h");
      if (json.simulated && !json.sent) {
        flash(
          json.error ||
            "Nothing was sent — no WhatsApp provider is configured. The card is still waiting.",
          6000,
        );
        return;
      }
      const parts = [
        `${json.sent ?? 0} sent`,
        json.failed ? `${json.failed} failed` : "",
        json.deferred ? `${json.deferred} held for quiet hours` : "",
      ].filter(Boolean);
      flash(
        json.error ? `${parts.join(" · ")} — ${json.error}` : parts.join(" · "),
        5000,
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : "Dispatch failed", 5000);
    }
  }

  async function dispatchApproval(item: AutomationApprovalItem) {
    await decideApprovalServer(item.id, "approved");
  }

  /**
   * Run the tick on the SERVER and take back what it persisted.
   *
   * Evaluating in the browser cannot read the roster, the fee ledger or the
   * admissions pipeline, so it could only ever propose a made-up audience.
   * The route resolves the real recipients, raises the cards, sends whatever
   * is already approved, and saves — this just adopts the result.
   */
  async function evaluateTick(forceRuleIds?: string[]) {
    if (readOnly) {
      flash("Session is closed — automation is read-only");
      return;
    }
    try {
      const res = await fetch("/api/wa/automation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(forceRuleIds?.length ? { forceRuleIds } : {}),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        sent?: number;
        failed?: number;
        simulated?: number;
        staleCards?: number;
        pendingApprovals?: number;
        audienceErrors?: { ruleId: string; error: string }[];
        state?: AutomationState;
      };
      if (!res.ok || !json.ok || !json.state) {
        flash(json.error || "Evaluation failed", 5000);
        return;
      }
      const next = normalizeAutomationState(json.state);
      // Written raw: the server has already persisted this, and a normal
      // save would schedule a push of what we just read back.
      writeAutomationLocalRaw(next);
      setState(next);
      const parts = [
        `${json.pendingApprovals ?? 0} awaiting approval`,
        json.sent ? `${json.sent} sent` : "",
        json.failed ? `${json.failed} failed` : "",
        json.simulated && !json.sent
          ? `${json.simulated} stubbed — no WhatsApp provider configured`
          : "",
        json.staleCards ? `${json.staleCards} card(s) too old to send` : "",
        json.audienceErrors?.length
          ? `${json.audienceErrors.length} rule(s) had no audience`
          : "",
      ].filter(Boolean);
      flash(`Evaluation ran — ${parts.join(" · ")}`, 5000);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Evaluation failed", 5000);
    }
  }

  return {
    session,
    readOnly,
    state,
    notice,
    by,
    commit,
    flash,
    refresh,
    dispatchApproval,
    evaluateTick,
    setEnabled: (ruleId: string, enabled: boolean) => {
      if (!state) return;
      commit(
        setRuleEnabled(state, ruleId, enabled),
        enabled ? "Rule enabled" : "Rule disabled",
      );
    },
    markTested: (ruleId: string) => {
      if (!state) return;
      commit(markRuleTested(state, ruleId), "Marked tested");
    },
    setMode: (ruleId: string, mode: "approval_first" | "auto") => {
      if (!state) return;
      const r = setRuleExecutionMode(state, ruleId, mode);
      if (!r.ok) {
        flash(r.reason);
        return;
      }
      commit(r.state, `Mode → ${mode}`);
    },
    updateSchedule: (
      ruleId: string,
      patch: Parameters<typeof updateRuleSchedule>[2],
    ) => {
      if (!state) return;
      commit(updateRuleSchedule(state, ruleId, patch), "Schedule updated");
    },
    updateRule: (
      ruleId: string,
      patch: Parameters<typeof updateAutomationRule>[2],
    ) => {
      if (!state) return;
      commit(updateAutomationRule(state, ruleId, patch), "Rule updated");
    },
    decideApproval: (
      approvalId: string,
      status: "rejected" | "snoozed",
      snoozeHours?: number,
    ) => {
      void decideApprovalServer(approvalId, status, snoozeHours);
    },
  };
}
