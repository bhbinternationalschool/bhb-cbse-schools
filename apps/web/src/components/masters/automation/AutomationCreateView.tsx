"use client";

import { useMemo, useState } from "react";
import {
  createAutomationRule,
  moduleLabelAuto,
  type AutomationActionType,
  type AutomationModule,
  type AutomationState,
  type AutomationTriggerType,
} from "@/lib/automation";
import { loadWaTemplates } from "@/lib/waTemplates";
import { WaTemplateVariablesPicker } from "@/components/masters/WaTemplateVariablesPicker";
import { AutomationSchedulePicker } from "./AutomationSchedulePicker";
import { AutomationAudiencePicker } from "./AutomationAudiencePicker";
import { AutomationSetupHelper } from "./AutomationSetupHelper";
import {
  autoBtnOutline,
  autoBtnTeal,
  autoInp,
} from "./automationUi";

const MODULES: AutomationModule[] = [
  "admissions",
  "fees",
  "attendance",
  "homework",
  "exams",
  "ptm",
  "leave",
  "vault",
  "comms",
  "store",
  "transport",
  "certificates",
  "campaigns",
  "general",
];

export function AutomationCreateView({
  state,
  readOnly,
  notice,
  onBack,
  onCreated,
}: {
  state: AutomationState;
  readOnly: boolean;
  notice: string | null;
  onBack: () => void;
  onCreated: (nextState: AutomationState, ruleId: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [module, setModule] = useState<AutomationModule>("general");
  const [triggerType, setTriggerType] =
    useState<AutomationTriggerType>("schedule");
  const [cronExpr, setCronExpr] = useState("0 10 * * 1-6");
  const [intervalMinutes, setIntervalMinutes] = useState("240");
  const [eventKey, setEventKey] = useState("");
  const [actionType, setActionType] =
    useState<AutomationActionType>("whatsapp_template");
  const [templateFamilyKey, setTemplateFamilyKey] = useState("");
  const [templateLanguage, setTemplateLanguage] = useState<"en" | "hi">("en");
  const [audienceSummary, setAudienceSummary] = useState("");

  const templates = loadWaTemplates().templates;
  const familyKeys = useMemo(() => {
    return [...new Set(templates.map((t) => t.familyKey))].filter(Boolean);
  }, [templates]);

  const linkedTemplate = useMemo(() => {
    if (!templateFamilyKey) return null;
    return (
      templates.find(
        (t) =>
          t.familyKey === templateFamilyKey &&
          t.language === templateLanguage,
      ) ||
      templates.find((t) => t.familyKey === templateFamilyKey) ||
      null
    );
  }, [templates, templateFamilyKey, templateLanguage]);

  function handleCreate() {
    if (readOnly || !name.trim()) return;
    const { state: nextState, rule } = createAutomationRule(state, {
      name,
      description,
      module,
      triggerType,
      cronExpr: triggerType === "schedule" ? cronExpr : "",
      intervalMinutes:
        triggerType === "interval" ? Math.max(0, Number(intervalMinutes) || 0) : 0,
      eventKey: triggerType === "event" ? eventKey : "",
      actionType,
      templateFamilyKey:
        actionType === "whatsapp_template" ? templateFamilyKey : "",
      templateLanguage,
      audienceSummary,
      enabled: false,
    });
    onCreated(nextState, rule.id);
  }

  const canCreate = !readOnly && name.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--brand-deep)]">
            New automation rule
          </h2>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            Configure trigger, action, and linked template. Rules start paused —
            enable after testing.
          </p>
        </div>
        <button type="button" className={autoBtnOutline} onClick={onBack}>
          ← Back to list
        </button>
      </div>

      {notice ? (
        <span className="inline-block rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-1.5 text-xs font-medium text-[var(--brand-deep)]">
          {notice}
        </span>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Rule name
            <input
              className={`${autoInp} mt-1`}
              value={name}
              disabled={readOnly}
              onChange={(e) => setName(e.target.value)}
              placeholder="Fee stage reminders"
            />
          </label>

          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Description
            <textarea
              className={`${autoInp} mt-1 min-h-[60px]`}
              value={description}
              disabled={readOnly}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Module
              <select
                className={`${autoInp} mt-1`}
                value={module}
                disabled={readOnly}
                onChange={(e) =>
                  setModule(e.target.value as AutomationModule)
                }
              >
                {MODULES.map((m) => (
                  <option key={m} value={m}>
                    {moduleLabelAuto(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <AutomationSetupHelper
            readOnly={readOnly}
            ruleName={name}
            description={description}
            module={module}
            onApply={(patch) => {
              if (patch.triggerType) setTriggerType(patch.triggerType);
              if (patch.cronExpr) setCronExpr(patch.cronExpr);
              if (patch.intervalMinutes != null)
                setIntervalMinutes(String(patch.intervalMinutes));
              if (patch.eventKey) setEventKey(patch.eventKey);
              if (patch.audienceSummary) setAudienceSummary(patch.audienceSummary);
            }}
          />

          <AutomationSchedulePicker
            triggerType={triggerType}
            cronExpr={cronExpr}
            intervalMinutes={Math.max(0, Number(intervalMinutes) || 0)}
            eventKey={eventKey}
            readOnly={readOnly}
            onTriggerTypeChange={setTriggerType}
            onCronChange={setCronExpr}
            onIntervalChange={(m) => setIntervalMinutes(String(m))}
            onEventChange={setEventKey}
          />

          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Action type
            <select
              className={`${autoInp} mt-1`}
              value={actionType}
              disabled={readOnly}
              onChange={(e) =>
                setActionType(e.target.value as AutomationActionType)
              }
            >
              <option value="whatsapp_template">WhatsApp template</option>
              <option value="in_app_notification">In-app notification</option>
              <option value="enqueue_campaign">Enqueue campaign</option>
            </select>
          </label>

          {actionType === "whatsapp_template" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-[11px] font-semibold text-[var(--muted)]">
                Template family
                <select
                  className={`${autoInp} mt-1`}
                  value={templateFamilyKey}
                  disabled={readOnly}
                  onChange={(e) => setTemplateFamilyKey(e.target.value)}
                >
                  <option value="">— select —</option>
                  {familyKeys.map((fk) => (
                    <option key={fk} value={fk}>
                      {fk}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[11px] font-semibold text-[var(--muted)]">
                Template language
                <select
                  className={`${autoInp} mt-1`}
                  value={templateLanguage}
                  disabled={readOnly}
                  onChange={(e) =>
                    setTemplateLanguage(e.target.value === "hi" ? "hi" : "en")
                  }
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                </select>
              </label>
            </div>
          ) : null}

          <AutomationAudiencePicker
            module={module}
            ruleName={name}
            description={description}
            value={audienceSummary}
            readOnly={readOnly}
            onChange={setAudienceSummary}
          />

          <button
            type="button"
            disabled={!canCreate}
            className={autoBtnTeal}
            onClick={handleCreate}
          >
            Create rule
          </button>
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start space-y-3">
          {linkedTemplate ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
              <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
                Linked template: {linkedTemplate.name}
              </p>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                Variables filled by automation when dispatching:
              </p>
              <WaTemplateVariablesPicker
                compact
                highlightKeys={linkedTemplate.variables}
              />
            </div>
          ) : actionType === "whatsapp_template" ? (
            <WaTemplateVariablesPicker compact />
          ) : null}
        </div>
      </div>
    </div>
  );
}
