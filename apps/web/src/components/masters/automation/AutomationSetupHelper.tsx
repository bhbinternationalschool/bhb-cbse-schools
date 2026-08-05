"use client";

import { useState } from "react";
import type { AutomationModule, AutomationTriggerType } from "@/lib/automation";
import { autoBtnTeal, autoInp } from "./automationUi";

export function AutomationSetupHelper({
  readOnly,
  ruleName,
  description,
  module,
  onApply,
}: {
  readOnly: boolean;
  ruleName: string;
  description: string;
  module: AutomationModule;
  onApply: (patch: {
    triggerType?: AutomationTriggerType;
    cronExpr?: string;
    intervalMinutes?: number;
    eventKey?: string;
    audienceSummary?: string;
    scheduleExplanation?: string;
  }) => void;
}) {
  const [hint, setHint] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastExplanation, setLastExplanation] = useState<string | null>(null);

  async function suggest() {
    const text = hint.trim();
    if (!text || readOnly) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/automation-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleName: ruleName.trim() || "Automation rule",
          description,
          module,
          hint: text,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        audienceSummary?: string;
        triggerType?: AutomationTriggerType;
        cronExpr?: string;
        intervalMinutes?: number;
        eventKey?: string;
        scheduleExplanation?: string;
        audienceExplanation?: string;
      };
      if (!json.ok) {
        setError(json.error || "Suggestion failed");
        return;
      }
      onApply({
        triggerType: json.triggerType,
        cronExpr: json.cronExpr,
        intervalMinutes: json.intervalMinutes,
        eventKey: json.eventKey,
        audienceSummary: json.audienceSummary,
        scheduleExplanation: json.scheduleExplanation,
      });
      const parts = [
        json.scheduleExplanation,
        json.audienceExplanation,
      ].filter(Boolean);
      setLastExplanation(parts.join(" · "));
      setHint("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suggestion failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-[rgba(15,118,110,0.35)] bg-[rgba(15,118,110,0.04)] p-3 space-y-2">
      <p className="text-[12px] font-semibold text-[var(--brand-deep)]">
        AI setup helper (optional)
      </p>
      <p className="text-[10px] text-[var(--muted)]">
        Describe in plain English when this should run and who should receive it
        — e.g. &quot;Every weekday at 10 AM, parents with overdue fees&quot;. AI
        fills schedule and audience for you. Works with{" "}
        <code className="font-mono text-[9px]">OPENAI_API_KEY</code> or{" "}
        <code className="font-mono text-[9px]">GEMINI_API_KEY</code>; presets
        below work without AI.
      </p>
      <textarea
        className={`${autoInp} min-h-[56px] text-[11px]`}
        value={hint}
        disabled={readOnly || generating}
        placeholder="Weekday mornings, remind parents whose child was absent today…"
        onChange={(e) => setHint(e.target.value)}
      />
      <button
        type="button"
        disabled={readOnly || generating || !hint.trim()}
        className={autoBtnTeal}
        onClick={() => void suggest()}
      >
        {generating ? "Thinking…" : "Suggest schedule & audience"}
      </button>
      {error ? <p className="text-[10px] text-rose-700">{error}</p> : null}
      {lastExplanation ? (
        <p className="text-[10px] text-[#0f766e]">{lastExplanation}</p>
      ) : null}
    </div>
  );
}
