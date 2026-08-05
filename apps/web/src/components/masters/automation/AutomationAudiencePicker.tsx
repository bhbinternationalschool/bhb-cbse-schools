"use client";

import { useEffect, useMemo, useState } from "react";
import type { AutomationModule } from "@/lib/automation";
import {
  audiencePresetsForModule,
  findAudiencePresetBySummary,
} from "@/lib/automationAudience";
import { autoBtnTeal, autoInp } from "./automationUi";

export function AutomationAudiencePicker({
  module,
  ruleName,
  description,
  value,
  readOnly,
  onChange,
}: {
  module: AutomationModule;
  ruleName: string;
  description: string;
  value: string;
  readOnly: boolean;
  onChange: (summary: string) => void;
}) {
  const presets = useMemo(() => audiencePresetsForModule(module), [module]);
  const matched = findAudiencePresetBySummary(value);
  const [presetId, setPresetId] = useState(
    matched?.id || (value.trim() ? "custom" : ""),
  );
  const [customText, setCustomText] = useState(
    matched ? "" : value,
  );
  const [aiHint, setAiHint] = useState("");
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    const m = findAudiencePresetBySummary(value);
    if (m) {
      setPresetId(m.id);
      setCustomText("");
    } else if (value.trim()) {
      setPresetId("custom");
      setCustomText(value);
    }
  }, [value]);

  function selectPreset(id: string) {
    setPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (p && p.id !== "custom") {
      onChange(p.summary);
      setCustomText("");
    }
  }

  const selectedPreset = presets.find((p) => p.id === presetId);

  async function suggestWithAi() {
    const hint = aiHint.trim();
    if (!hint || readOnly) return;
    setGenerating(true);
    setAiError(null);
    try {
      const res = await fetch("/api/ai/automation-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleName: ruleName.trim() || "Automation rule",
          description: description.trim(),
          module,
          hint,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        audienceSummary?: string;
        audienceExplanation?: string;
      };
      if (!json.ok || !json.audienceSummary) {
        setAiError(json.error || "Could not suggest audience");
        return;
      }
      onChange(json.audienceSummary);
      setPresetId("custom");
      setCustomText(json.audienceSummary);
      setAiHint("");
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Suggestion failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.02)] p-3">
      <div>
        <p className="text-[12px] font-semibold text-[var(--brand-deep)]">
          Who receives this?
        </p>
        <p className="mt-0.5 text-[10px] text-[var(--muted)]">
          Shown on approval cards so staff know who will get the message. This
          does not filter live data yet — it is a clear label for reviewers.
        </p>
      </div>

      <label className="block text-[11px] font-semibold text-[var(--muted)]">
        Audience preset
        <select
          className={`${autoInp} mt-1`}
          value={presetId}
          disabled={readOnly}
          onChange={(e) => selectPreset(e.target.value)}
        >
          <option value="">— choose audience —</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {selectedPreset && selectedPreset.id !== "custom" ? (
        <div className="rounded-md bg-white px-2.5 py-2 text-[11px]">
          <p className="font-semibold text-[var(--brand-deep)]">
            {selectedPreset.summary}
          </p>
          <p className="mt-0.5 text-[10px] text-[var(--muted)]">
            {selectedPreset.hint}
          </p>
        </div>
      ) : null}

      {presetId === "custom" || !presetId ? (
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Custom audience note
          <input
            className={`${autoInp} mt-1`}
            value={customText}
            disabled={readOnly}
            placeholder="e.g. Class 5-A parents with fee balance > ₹5000"
            onChange={(e) => {
              setCustomText(e.target.value);
              onChange(e.target.value);
            }}
          />
        </label>
      ) : null}

      <div className="border-t border-[rgba(32,48,80,0.08)] pt-3 space-y-2">
        <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
          AI helper (optional)
        </p>
        <p className="text-[10px] text-[var(--muted)]">
          Describe who should get the message in plain English — AI will write a
          short audience label. Needs{" "}
          <code className="font-mono text-[9px]">OPENAI_API_KEY</code> or{" "}
          <code className="font-mono text-[9px]">GEMINI_API_KEY</code>.
        </p>
        <input
          className={autoInp}
          value={aiHint}
          disabled={readOnly || generating}
          placeholder="Parents of students absent more than 3 days this month"
          onChange={(e) => setAiHint(e.target.value)}
        />
        <button
          type="button"
          disabled={readOnly || generating || !aiHint.trim()}
          className={autoBtnTeal}
          onClick={() => void suggestWithAi()}
        >
          {generating ? "Suggesting…" : "Suggest audience"}
        </button>
        {aiError ? (
          <p className="text-[10px] text-rose-700">{aiError}</p>
        ) : null}
      </div>
    </div>
  );
}

/** Compact read-only summary for list/detail rows */
export function audienceSummaryLabel(summary: string): string {
  if (!summary.trim()) return "Audience not set";
  const preset = findAudiencePresetBySummary(summary);
  return preset ? preset.label : summary;
}
