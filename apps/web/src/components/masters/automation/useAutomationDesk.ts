"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AudiencePreview,
  AutomationRulePatch,
  AutomationState,
  CreateAutomationRuleOpts,
} from "@/lib/automation";
import {
  useDemoSession,
  useSessionReadOnly,
} from "@/components/shell/SessionContext";

/**
 * Masters → Automation, backed by the server's copy of the rules.
 *
 * Every change goes through /api/wa/automation/desk and the returned state
 * replaces what the screen shows, so the screen and the scheduler always
 * agree. "Run now" and "Approve & send" happen on the server, with the real
 * fee-desk audience — nothing is evaluated or sent from the browser.
 */

type DeskResponse = {
  ok?: boolean;
  error?: string;
  state?: AutomationState;
  ruleId?: string;
  preview?: AudiencePreview;
  notes?: string[];
  autoSent?: number;
  autoFailed?: number;
  outcome?: { sent: number; failed: number; note?: string };
};

export type PreviewResult =
  | { ruleId: string; loading: true }
  | { ruleId: string; loading: false; preview: AudiencePreview | null; error: string };

export function useAutomationDesk() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const [state, setState] = useState<AutomationState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const by = session.fullName || session.roleCode || "masters";

  const flash = useCallback((msg: string, ms = 4000) => {
    setNotice(msg);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), ms);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/wa/automation/desk", { cache: "no-store" });
      const json = (await res.json()) as DeskResponse;
      if (!res.ok || !json.state) {
        setLoadError(json.error || `Could not load automation (${res.status})`);
        return;
      }
      setLoadError(null);
      setState(json.state);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load automation");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const call = useCallback(
    async (
      op: string,
      payload: Record<string, unknown>,
      okMsg?: string | ((json: DeskResponse) => string),
    ): Promise<DeskResponse | null> => {
      if (readOnly) {
        flash("Session is closed — automation is read-only");
        return null;
      }
      setBusy(op);
      try {
        const res = await fetch("/api/wa/automation/desk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op, ...payload }),
        });
        const json = (await res.json().catch(() => ({}))) as DeskResponse;
        if (json.state) setState(json.state);
        if (!res.ok || json.ok === false) {
          flash(json.error || `Request failed (${res.status})`, 7000);
          return json;
        }
        if (okMsg) flash(typeof okMsg === "function" ? okMsg(json) : okMsg);
        return json;
      } catch (e) {
        flash(e instanceof Error ? e.message : "Request failed", 7000);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [readOnly, flash],
  );

  return {
    session,
    readOnly,
    state,
    loadError,
    busy,
    notice,
    preview,
    by,
    flash,
    refresh,
    clearPreview: () => setPreview(null),

    createRule: async (rule: CreateAutomationRuleOpts): Promise<string | null> => {
      const json = await call("create", { rule }, "Rule created — it starts paused");
      return json?.ruleId || null;
    },
    updateRule: (ruleId: string, patch: AutomationRulePatch) =>
      call("update", { ruleId, patch }, "Saved"),
    setEnabled: (ruleId: string, enabled: boolean) =>
      call("enable", { ruleId, enabled }, enabled ? "Rule enabled" : "Rule paused"),
    markTested: (ruleId: string) => call("tested", { ruleId }, "Marked tested"),
    setMode: (ruleId: string, mode: "approval_first" | "auto") =>
      call(
        "mode",
        { ruleId, mode },
        mode === "auto"
          ? "Auto mode: messages will be sent at the scheduled time without approval"
          : "Approval-first: messages wait in the Approvals tab",
      ),
    deleteRule: (ruleId: string) => call("delete", { ruleId }, "Rule deleted"),

    previewAudience: async (ruleId: string, ignoreCap = false) => {
      setPreview({ ruleId, loading: true });
      const json = await call("preview", { ruleId, ignoreCap });
      setPreview({
        ruleId,
        loading: false,
        preview: json?.preview ?? null,
        error: json?.preview ? "" : json?.error || "Preview failed",
      });
    },

    runNow: (ruleIds: string[]) =>
      call("run", { ruleIds }, (json) => {
        const notes = json.notes?.length ? json.notes.join(" | ") : "Nothing was due";
        const sent = json.autoSent ? ` · ${json.autoSent} sent` : "";
        return `${notes}${sent}`;
      }),

    approve: (approvalId: string) =>
      call("approve", { approvalId }, (json) =>
        json.outcome
          ? `Sent to ${json.outcome.sent} famil${json.outcome.sent === 1 ? "y" : "ies"}${
              json.outcome.failed ? ` · ${json.outcome.failed} failed` : ""
            }`
          : "Sent",
      ),
    reject: (approvalId: string) => call("reject", { approvalId }, "Rejected"),
    snooze: (approvalId: string, hours = 24) =>
      call("snooze", { approvalId, hours }, `Snoozed ${hours}h`),
  };
}
