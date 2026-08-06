"use client";

import { useCallback, useEffect, useState } from "react";
import { ensureAutomationHydrated } from "@/lib/automationPersistence";
import {
  decideApproval,
  evaluateAutomationTick,
  loadAutomation,
  markApprovalDispatched,
  markRuleTested,
  saveAutomation,
  setRuleEnabled,
  setRuleExecutionMode,
  updateAutomationRule,
  updateRuleSchedule,
  type AutomationApprovalItem,
  type AutomationState,
} from "@/lib/automation";
import { loadWaTemplates } from "@/lib/waTemplates";
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

  async function dispatchApproval(item: AutomationApprovalItem) {
    if (!state) return;
    const templates = loadWaTemplates();
    const tpl = templates.templates.find(
      (t) =>
        t.familyKey === item.templateFamilyKey &&
        t.language === item.templateLanguage &&
        t.status === "approved",
    );
    const messages = item.dispatchPayload.map((p) => ({
      messageId: `auto_${item.id}_${p.mobile}`,
      mobile: p.mobile,
      body: p.body,
      ...(tpl
        ? {
            template: {
              name: tpl.metaName,
              language: tpl.metaLanguage || tpl.language,
              variables: p.variables || {},
              variableKeys: tpl.variables,
            },
          }
        : {}),
    }));

    try {
      const res = await fetch("/api/wa/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      commit(
        markApprovalDispatched(
          decideApproval(state, item.id, "approved", by),
          item.id,
          !!json.ok,
          json.error || "",
        ),
        json.ok
          ? "Approved & dispatched (or stubbed)"
          : json.error || "Dispatch failed",
      );
    } catch (e) {
      commit(
        markApprovalDispatched(
          decideApproval(state, item.id, "approved", by),
          item.id,
          false,
          e instanceof Error ? e.message : "Dispatch failed",
        ),
        "Dispatch error",
      );
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
    evaluateTick: (forceRuleIds?: string[]) => {
      if (!state) return;
      commit(
        evaluateAutomationTick(state, { forceRuleIds }),
        "Evaluation ran — check Approvals",
      );
    },
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
      if (!state) return;
      commit(
        decideApproval(state, approvalId, status, by, snoozeHours),
        status === "rejected" ? "Rejected" : "Snoozed 24h",
      );
    },
  };
}
