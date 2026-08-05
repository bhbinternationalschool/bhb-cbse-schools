"use client";

import { useEffect, useMemo, useState } from "react";
import {
  moduleLabelAuto,
  type AutomationRule,
  type AutomationState,
} from "@/lib/automation";
import { loadWaTemplates } from "@/lib/waTemplates";
import { WaTemplateVariablesPicker } from "@/components/masters/WaTemplateVariablesPicker";
import { describeCronExpr, describeIntervalMinutes } from "@/lib/automationSchedule";
import { audienceSummaryLabel } from "./AutomationAudiencePicker";
import { AutomationSchedulePicker } from "./AutomationSchedulePicker";
import { AutomationAudiencePicker } from "./AutomationAudiencePicker";
import { AutomationSetupHelper } from "./AutomationSetupHelper";
import {
  autoBtnOutline,
  autoBtnPrimary,
  autoInp,
} from "./automationUi";

export function AutomationEditView({
  rule,
  state,
  readOnly,
  notice,
  onBack,
  onToggle,
  onMarkTested,
  onMode,
  onSchedule,
  onUpdate,
  onForceEvaluate,
}: {
  rule: AutomationRule;
  state: AutomationState;
  readOnly: boolean;
  notice: string | null;
  onBack: () => void;
  onToggle: (enabled: boolean) => void;
  onMarkTested: () => void;
  onMode: (mode: "approval_first" | "auto") => void;
  onSchedule: (
    patch: Partial<
      Pick<
        AutomationRule,
        | "cronExpr"
        | "intervalMinutes"
        | "templateLanguage"
        | "templateFamilyKey"
        | "audienceSummary"
        | "triggerType"
        | "eventKey"
      >
    >,
  ) => void;
  onUpdate: (
    patch: Partial<
      Pick<AutomationRule, "name" | "description" | "audienceSummary">
    >,
  ) => void;
  onForceEvaluate: () => void;
}) {
  const [cron, setCron] = useState(rule.cronExpr);
  const [interval, setIntervalMins] = useState(String(rule.intervalMinutes));
  const [triggerType, setTriggerType] = useState(rule.triggerType);
  const [eventKey, setEventKey] = useState(rule.eventKey);
  const [name, setName] = useState(rule.name);
  const [description, setDescription] = useState(rule.description);
  const [audienceSummary, setAudienceSummary] = useState(rule.audienceSummary);

  useEffect(() => {
    setCron(rule.cronExpr);
    setIntervalMins(String(rule.intervalMinutes));
    setTriggerType(rule.triggerType);
    setEventKey(rule.eventKey);
    setName(rule.name);
    setDescription(rule.description);
    setAudienceSummary(rule.audienceSummary);
  }, [
    rule.id,
    rule.cronExpr,
    rule.intervalMinutes,
    rule.triggerType,
    rule.eventKey,
    rule.name,
    rule.description,
    rule.audienceSummary,
  ]);

  const linkedTemplate = useMemo(() => {
    if (!rule.templateFamilyKey) return null;
    const tpls = loadWaTemplates().templates;
    return (
      tpls.find(
        (t) =>
          t.familyKey === rule.templateFamilyKey &&
          t.language === rule.templateLanguage,
      ) ||
      tpls.find((t) => t.familyKey === rule.templateFamilyKey) ||
      null
    );
  }, [rule.templateFamilyKey, rule.templateLanguage]);

  const recentDecisions = state.approvals
    .filter((a) => a.status !== "pending")
    .slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--brand-deep)]">
            {rule.name}
          </h2>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            {moduleLabelAuto(rule.module)} · {rule.triggerType} ·{" "}
            {rule.executionMode}
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
        <div className="space-y-3 rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-4 text-[12px]">
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Name
            <input
              className={`${autoInp} mt-1`}
              value={name}
              disabled={readOnly}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name.trim() !== rule.name) onUpdate({ name: name.trim() });
              }}
            />
          </label>

          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Description
            <textarea
              className={`${autoInp} mt-1 min-h-[60px]`}
              value={description}
              disabled={readOnly}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => {
                if (description !== rule.description)
                  onUpdate({ description });
              }}
            />
          </label>

          <AutomationSetupHelper
            readOnly={readOnly}
            ruleName={name}
            description={description}
            module={rule.module}
            onApply={(patch) => {
              const schedulePatch: Parameters<typeof onSchedule>[0] = {};
              if (patch.triggerType) {
                setTriggerType(patch.triggerType);
                schedulePatch.triggerType = patch.triggerType;
              }
              if (patch.cronExpr) {
                setCron(patch.cronExpr);
                schedulePatch.cronExpr = patch.cronExpr;
              }
              if (patch.intervalMinutes != null) {
                setIntervalMins(String(patch.intervalMinutes));
                schedulePatch.intervalMinutes = patch.intervalMinutes;
              }
              if (patch.eventKey) {
                setEventKey(patch.eventKey);
                schedulePatch.eventKey = patch.eventKey;
              }
              if (patch.audienceSummary) {
                setAudienceSummary(patch.audienceSummary);
                schedulePatch.audienceSummary = patch.audienceSummary;
              }
              if (Object.keys(schedulePatch).length) onSchedule(schedulePatch);
            }}
          />

          <AutomationSchedulePicker
            triggerType={triggerType}
            cronExpr={cron}
            intervalMinutes={Math.max(0, Number(interval) || 0)}
            eventKey={eventKey}
            readOnly={readOnly}
            onTriggerTypeChange={(t) => {
              setTriggerType(t);
              onSchedule({ triggerType: t });
            }}
            onCronChange={(expr) => {
              setCron(expr);
              onSchedule({ cronExpr: expr });
            }}
            onIntervalChange={(m) => {
              setIntervalMins(String(m));
              onSchedule({ intervalMinutes: m });
            }}
            onEventChange={(key) => {
              setEventKey(key);
              onSchedule({ eventKey: key });
            }}
          />

          <AutomationAudiencePicker
            module={rule.module}
            ruleName={name}
            description={description}
            value={audienceSummary}
            readOnly={readOnly}
            onChange={(summary) => {
              setAudienceSummary(summary);
              onSchedule({ audienceSummary: summary });
            }}
          />

          <p className="text-[11px] text-[var(--muted)]">
            Action: {rule.actionType}
            {rule.templateFamilyKey
              ? ` · ${rule.templateFamilyKey} (${rule.templateLanguage})`
              : ""}
            <br />
            Schedule:{" "}
            {triggerType === "schedule" && cron
              ? describeCronExpr(cron)
              : triggerType === "interval" && rule.intervalMinutes
                ? describeIntervalMinutes(rule.intervalMinutes)
                : triggerType === "event" && eventKey
                  ? `On event: ${eventKey}`
                  : "—"}
            <br />
            Audience: {audienceSummaryLabel(audienceSummary)}
            <br />
            Tested:{" "}
            {rule.testedAt
              ? new Date(rule.testedAt).toLocaleString()
              : "not yet"}
            <br />
            Next run: {rule.nextRunAt || "on next tick"}
          </p>

          {!readOnly ? (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={autoBtnPrimary}
                  onClick={() => onToggle(!rule.enabled)}
                >
                  {rule.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  className={autoBtnOutline}
                  onClick={onMarkTested}
                >
                  Mark tested
                </button>
                <button
                  type="button"
                  className={autoBtnOutline}
                  onClick={() =>
                    onMode(
                      rule.executionMode === "auto"
                        ? "approval_first"
                        : "auto",
                    )
                  }
                >
                  Mode: {rule.executionMode}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-amber-300 px-3 py-1.5 text-[11px] font-semibold text-amber-900"
                  onClick={onForceEvaluate}
                >
                  Evaluate now
                </button>
              </div>
              <label className="block text-[11px] font-semibold text-[var(--muted)]">
                Template language
                <select
                  className={`${autoInp} mt-1`}
                  value={rule.templateLanguage}
                  onChange={(e) =>
                    onSchedule({
                      templateLanguage: e.target.value === "hi" ? "hi" : "en",
                    })
                  }
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                </select>
              </label>
            </>
          ) : null}

          {recentDecisions.length > 0 ? (
            <p className="text-[11px] text-[var(--muted)]">
              Recent decisions:{" "}
              {recentDecisions
                .map((a) => `${a.status}:${a.ruleName}`)
                .join(" · ")}
            </p>
          ) : null}
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start space-y-3">
          {linkedTemplate ? (
            <div className="rounded-lg border border-[rgba(32,48,80,0.1)] bg-white p-3">
              <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
                Linked template: {linkedTemplate.name} ({linkedTemplate.metaName})
              </p>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                Variables filled by automation when dispatching:
              </p>
              <WaTemplateVariablesPicker
                compact
                highlightKeys={linkedTemplate.variables}
              />
            </div>
          ) : rule.templateFamilyKey ? (
            <p className="text-[11px] text-amber-800">
              Template family <code>{rule.templateFamilyKey}</code> — configure
              in Masters → WhatsApp templates.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
