"use client";

import { useState } from "react";
import {
  WA_CHATBOT_AUDIENCE_OPTIONS,
  createWaChatbotFlow,
  type WaChatbotAudience,
  type WaChatbotFlowsState,
} from "@/lib/waChatbotFlows";
import { botBtnOutline, botBtnTeal, botInp } from "./waChatbotUi";

export function WaChatbotCreateView({
  state,
  readOnly,
  notice,
  onBack,
  onCreated,
}: {
  state: WaChatbotFlowsState;
  readOnly: boolean;
  notice: string | null;
  onBack: () => void;
  onCreated: (nextState: WaChatbotFlowsState, flowId: string) => void;
}) {
  const [step, setStep] = useState<"template" | "details">("template");
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<WaChatbotAudience>("general");

  const builtins = state.flows.filter((f) => f.status === "built_in");

  function handleCreate() {
    if (readOnly || !name.trim()) return;
    const { state: next, flow } = createWaChatbotFlow(state, {
      name,
      description,
      audience,
      fromTemplateId: templateId || undefined,
    });
    onCreated(next, flow.id);
  }

  if (step === "template") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-[var(--brand-deep)]">
              New WhatsApp chatbot
            </h2>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              Start from a built-in bot or blank canvas.
            </p>
          </div>
          <button type="button" className={botBtnOutline} onClick={onBack}>
            ← Back
          </button>
        </div>
        {notice ? (
          <span className="inline-block rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-1.5 text-xs">
            {notice}
          </span>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            className={`rounded-xl border p-4 text-left ${
              !templateId
                ? "border-[#0f766e] bg-[rgba(15,118,110,0.06)]"
                : "border-[var(--border)] bg-[var(--card)]"
            }`}
            onClick={() => setTemplateId("")}
          >
            <p className="font-semibold text-[var(--brand-deep)]">Blank bot</p>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Welcome + menu — add steps in the builder.
            </p>
          </button>
          {builtins.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`rounded-xl border p-4 text-left ${
                templateId === b.id
                  ? "border-[#0f766e] bg-[rgba(15,118,110,0.06)]"
                  : "border-[var(--border)] bg-[var(--card)]"
              }`}
              onClick={() => {
                setTemplateId(b.id);
                setAudience(b.audience);
                setName(`My ${b.name}`);
              }}
            >
              <p className="font-semibold text-[var(--brand-deep)]">{b.name}</p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                {b.description}
              </p>
              <p className="mt-1 text-[10px] text-[#0f766e]">
                {b.nodes.length} steps
              </p>
            </button>
          ))}
        </div>
        <button
          type="button"
          className={botBtnTeal}
          onClick={() => setStep("details")}
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-[var(--brand-deep)]">
          Chatbot details
        </h2>
        <button
          type="button"
          className={botBtnOutline}
          onClick={() => setStep("template")}
        >
          Change template
        </button>
      </div>
      <div className="max-w-lg space-y-3 rounded-xl border bg-[var(--card)] p-4">
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Name
          <input
            className={`${botInp} mt-1`}
            value={name}
            disabled={readOnly}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Description
          <textarea
            className={`${botInp} mt-1 min-h-[60px]`}
            value={description}
            disabled={readOnly}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="block text-[11px] font-semibold text-[var(--muted)]">
          Audience
          <select
            className={`${botInp} mt-1`}
            value={audience}
            disabled={readOnly}
            onChange={(e) =>
              setAudience(e.target.value as WaChatbotAudience)
            }
          >
            {WA_CHATBOT_AUDIENCE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={readOnly || !name.trim()}
          className={botBtnTeal}
          onClick={handleCreate}
        >
          Create & open builder
        </button>
      </div>
    </div>
  );
}
