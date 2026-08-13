"use client";

import { useState } from "react";
import {
  WA_TEMPLATE_CONTENT_SNIPPETS,
  type WaTemplateLanguage,
  type WaTemplateLayoutKind,
  type WaTemplateModule,
} from "@/lib/waTemplates";
import { waBtnTeal, waInp } from "./waTemplateUi";

export function WaTemplateContentHelper({
  readOnly,
  module,
  language,
  layoutKind,
  onApply,
}: {
  readOnly: boolean;
  module: WaTemplateModule;
  language: WaTemplateLanguage;
  layoutKind: WaTemplateLayoutKind;
  onApply: (body: string, footer: string) => void;
}) {
  const [purpose, setPurpose] = useState("");
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const matchingSnippets = WA_TEMPLATE_CONTENT_SNIPPETS.filter(
    (s) => s.module === module || s.id === "general",
  );

  async function generateAi() {
    const p = purpose.trim();
    if (!p || readOnly) return;
    setGenerating(true);
    setAiError(null);
    try {
      const res = await fetch("/api/ai/wa-template-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: p,
          module,
          language,
          layoutKind,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        body?: string;
        footer?: string;
      };
      if (!json.ok || !json.body) {
        setAiError(json.error || "Generation failed");
        return;
      }
      onApply(json.body, json.footer || "");
      setPurpose("");
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3 space-y-3">
      <div>
        <p className="text-[12px] font-semibold text-[var(--brand-deep)]">
          Write with helper
        </p>
        <p className="mt-0.5 text-[10px] text-[var(--muted)]">
          Pick a starter snippet or describe your message — use{" "}
          <code className="font-mono">{"{{guardianName}}"}</code> style variables.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {matchingSnippets.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={readOnly}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[10px] font-semibold text-[var(--brand-deep)] hover:border-[#0f766e] disabled:opacity-50"
            onClick={() => onApply(s.body, s.footer)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Describe purpose (AI draft)
          <input
            className={`${waInp} mt-1`}
            value={purpose}
            disabled={readOnly || generating}
            placeholder="Fee overdue reminder for stage 2…"
            onChange={(e) => setPurpose(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={readOnly || generating || !purpose.trim()}
          className={waBtnTeal}
          onClick={() => void generateAi()}
        >
          {generating ? "Generating…" : "Suggest content"}
        </button>
        {aiError ? (
          <p className="text-[10px] text-rose-700">{aiError}</p>
        ) : null}
      </div>
    </div>
  );
}
