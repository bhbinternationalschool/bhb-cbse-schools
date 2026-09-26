"use client";

import { useEffect, useMemo, useState } from "react";
import {
  isSeedRuleId,
  moduleLabelAuto,
  ruleConfigProblem,
  type AutomationRule,
  type AutomationRulePatch,
  type AutomationState,
} from "@/lib/automation";
import { audienceIsAutomated, findAudiencePresetBySummary } from "@/lib/automationAudience";
import { loadWaTemplates } from "@/lib/waTemplates";
import { WaTemplateVariablesPicker } from "@/components/masters/WaTemplateVariablesPicker";
import { describeCronExpr, describeIntervalMinutes } from "@/lib/automationSchedule";
import { audienceSummaryLabel } from "./AutomationAudiencePicker";
import { AutomationSchedulePicker } from "./AutomationSchedulePicker";
import { AutomationAudiencePicker } from "./AutomationAudiencePicker";
import { AutomationSetupHelper } from "./AutomationSetupHelper";
import { AutomationPreviewCard } from "./AutomationPreviewCard";
import type { PreviewResult } from "./useAutomationDesk";
import {
  autoBtnDanger,
  autoBtnOutline,
  autoBtnPrimary,
  autoBtnTeal,
  autoInp,
  formatIst,
} from "./automationUi";

export function AutomationEditView({
  rule,
  state,
  readOnly,
  notice,
  busy,
  preview,
  onBack,
  onToggle,
  onMarkTested,
  onMode,
  onUpdate,
  onPreview,
  onRunNow,
  onDelete,
}: {
  rule: AutomationRule;
  state: AutomationState;
  readOnly: boolean;
  notice: string | null;
  busy: string | null;
  preview: PreviewResult | null;
  onBack: () => void;
  onToggle: (enabled: boolean) => void;
  onMarkTested: () => void;
  onMode: (mode: "approval_first" | "auto") => void;
  onUpdate: (patch: AutomationRulePatch) => void;
  onPreview: (ignoreCap: boolean) => void;
  onRunNow: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(rule.name);
  const [description, setDescription] = useState(rule.description);
  const [minDays, setMinDays] = useState(String(rule.minDaysBetween));
  const [maxPerRun, setMaxPerRun] = useState(String(rule.maxPerRun));

  useEffect(() => {
    setName(rule.name);
    setDescription(rule.description);
    setMinDays(String(rule.minDaysBetween));
    setMaxPerRun(String(rule.maxPerRun));
  }, [rule.id, rule.name, rule.description, rule.minDaysBetween, rule.maxPerRun]);

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

  const problem = ruleConfigProblem(rule);
  const automated = audienceIsAutomated(rule.audienceKey);
  const isSeed = isSeedRuleId(rule.id);
  const recentRuns = state.runs.filter((r) => r.ruleId === rule.id).slice(0, 6);
  const scheduleText =
    rule.triggerType === "schedule" && rule.cronExpr
      ? describeCronExpr(rule.cronExpr)
      : rule.triggerType === "interval" && rule.intervalMinutes
        ? describeIntervalMinutes(rule.intervalMinutes)
        : rule.triggerType === "event" && rule.eventKey
          ? `On event: ${rule.eventKey}`
          : "—";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--brand-deep)]">
            {rule.name}
          </h2>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            {moduleLabelAuto(rule.module)} · {rule.triggerType} ·{" "}
            {rule.executionMode === "auto" ? "auto-send" : "approval-first"} ·{" "}
            {rule.enabled ? "ON" : "paused"}
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

      {/* Status strip — the one place that says whether this rule will actually send. */}
      <div
        className={`rounded-xl border p-3 text-[12px] ${
          !rule.enabled
            ? "border-slate-200 bg-slate-50 text-slate-700"
            : problem || !automated
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
        }`}
      >
        {!rule.enabled ? (
          <p>
            <strong>Paused.</strong> Enable the rule to schedule it. Next run:
            {" "}{rule.nextRunAt ? formatIst(rule.nextRunAt) : "—"}
          </p>
        ) : problem ? (
          <p>
            <strong>Will not run:</strong> {problem}
          </p>
        ) : !automated ? (
          <p>
            <strong>Audience is a label only.</strong> The scheduler cannot
            build “{audienceSummaryLabel(rule.audienceSummary)}” on its own —
            pick an automated audience (Overdue fee households / Fees due in
            next 3 days) or send this one manually.
          </p>
        ) : (
          <p>
            <strong>Scheduled.</strong> Next run{" "}
            {rule.nextRunAt ? formatIst(rule.nextRunAt) : "at the next scheduler check"} IST
            {rule.lastRunAt ? ` · last run ${formatIst(rule.lastRunAt)}` : ""}.
            {rule.executionMode === "auto"
              ? " Messages go out at that time without anyone approving."
              : " A card will appear in the Approvals tab; nothing is sent until someone taps Approve & send."}
          </p>
        )}
        <p className="mt-1 text-[10px] opacity-80">
          The scheduler checks every 30 minutes, 08:00–19:59 IST, so a rule
          fires at the first check on or after its time. Quiet hours{" "}
          {rule.quietHours.enabled
            ? `${rule.quietHours.startHour}:00–${rule.quietHours.endHour}:00`
            : "off"}
          .
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-[12px]">
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Name
            <input
              className={`${autoInp} mt-1`}
              value={name}
              disabled={readOnly}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name.trim() && name.trim() !== rule.name) onUpdate({ name: name.trim() });
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
                if (description !== rule.description) onUpdate({ description });
              }}
            />
          </label>

          <AutomationSetupHelper
            readOnly={readOnly}
            ruleName={name}
            description={description}
            module={rule.module}
            onApply={(patch) => {
              const p: AutomationRulePatch = {};
              if (patch.triggerType) p.triggerType = patch.triggerType;
              if (patch.cronExpr) p.cronExpr = patch.cronExpr;
              if (patch.intervalMinutes != null) p.intervalMinutes = patch.intervalMinutes;
              if (patch.eventKey) p.eventKey = patch.eventKey;
              if (patch.audienceSummary) {
                p.audienceSummary = patch.audienceSummary;
                p.audienceKey = findAudiencePresetBySummary(patch.audienceSummary)?.id || "";
              }
              if (Object.keys(p).length) onUpdate(p);
            }}
          />

          <AutomationSchedulePicker
            triggerType={rule.triggerType}
            cronExpr={rule.cronExpr}
            intervalMinutes={rule.intervalMinutes}
            eventKey={rule.eventKey}
            readOnly={readOnly}
            onTriggerTypeChange={(t) => onUpdate({ triggerType: t })}
            onCronChange={(expr) => onUpdate({ cronExpr: expr })}
            onIntervalChange={(m) => onUpdate({ intervalMinutes: m })}
            onEventChange={(key) => onUpdate({ eventKey: key })}
          />

          <AutomationAudiencePicker
            module={rule.module}
            ruleName={name}
            description={description}
            value={rule.audienceSummary}
            readOnly={readOnly}
            onChange={(summary) =>
              onUpdate({
                audienceSummary: summary,
                audienceKey: findAudiencePresetBySummary(summary)?.id || "",
              })
            }
          />

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Don&apos;t message the same family again within (days)
              <input
                className={`${autoInp} mt-1`}
                type="number"
                min={0}
                value={minDays}
                disabled={readOnly}
                onChange={(e) => setMinDays(e.target.value)}
                onBlur={() => {
                  const n = Math.max(0, Math.round(Number(minDays) || 0));
                  if (n !== rule.minDaysBetween) onUpdate({ minDaysBetween: n });
                }}
              />
              <span className="mt-0.5 block text-[10px] font-normal">
                0 = every run. Shared with the WhatsApp “fee reminder” command.
              </span>
            </label>
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Max families per run
              <input
                className={`${autoInp} mt-1`}
                type="number"
                min={1}
                value={maxPerRun}
                disabled={readOnly}
                onChange={(e) => setMaxPerRun(e.target.value)}
                onBlur={() => {
                  const n = Math.max(1, Math.round(Number(maxPerRun) || 1));
                  if (n !== rule.maxPerRun) onUpdate({ maxPerRun: n });
                }}
              />
            </label>
          </div>

          <p className="text-[11px] text-[var(--muted)]">
            Action: {rule.actionType}
            {rule.templateFamilyKey
              ? ` · ${rule.templateFamilyKey} (each family in its own language)`
              : ""}
            <br />
            Schedule: {scheduleText}
            <br />
            Audience: {audienceSummaryLabel(rule.audienceSummary)}
            <br />
            Tested: {rule.testedAt ? formatIst(rule.testedAt) : "not yet"}
          </p>

          {!readOnly ? (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={autoBtnPrimary}
                  disabled={busy !== null}
                  onClick={() => onToggle(!rule.enabled)}
                >
                  {rule.enabled ? "Pause" : "Enable"}
                </button>
                <button
                  type="button"
                  className={autoBtnOutline}
                  disabled={busy !== null}
                  onClick={() => onPreview(false)}
                >
                  {busy === "preview" ? "Building list…" : "Preview who gets it"}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-amber-300 px-3 py-1.5 text-[11px] font-semibold text-amber-900 disabled:opacity-50"
                  disabled={busy !== null}
                  onClick={() => {
                    const msg =
                      rule.executionMode === "auto"
                        ? "Run now? This rule is in AUTO mode — the messages will be SENT to the families immediately."
                        : "Run now? This builds today's list and puts a card in the Approvals tab (nothing is sent until approved).";
                    if (window.confirm(msg)) onRunNow();
                  }}
                >
                  {busy === "run" ? "Running…" : "Run now"}
                </button>
              </div>

              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3 space-y-2">
                <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
                  Sending mode: {rule.executionMode === "auto" ? "Auto-send" : "Approval-first"}
                </p>
                <p className="text-[10px] text-[var(--muted)]">
                  Approval-first: each run puts a card in Approvals and waits.
                  Auto-send: the scheduler sends on its own at the set time. To
                  switch to auto, preview the list, mark the rule tested, then
                  switch.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={autoBtnOutline}
                    disabled={busy !== null}
                    onClick={onMarkTested}
                  >
                    {rule.testedAt ? "Mark tested again" : "Mark tested"}
                  </button>
                  <button
                    type="button"
                    className={rule.executionMode === "auto" ? autoBtnOutline : autoBtnTeal}
                    disabled={busy !== null || (rule.executionMode !== "auto" && !rule.testedAt)}
                    title={
                      rule.executionMode !== "auto" && !rule.testedAt
                        ? "Mark tested first"
                        : undefined
                    }
                    onClick={() =>
                      onMode(rule.executionMode === "auto" ? "approval_first" : "auto")
                    }
                  >
                    {rule.executionMode === "auto"
                      ? "Switch to approval-first"
                      : "Switch to auto-send"}
                  </button>
                </div>
              </div>

              <label className="block text-[11px] font-semibold text-[var(--muted)]">
                Preview language (families get their own)
                <select
                  className={`${autoInp} mt-1`}
                  value={rule.templateLanguage}
                  onChange={(e) =>
                    onUpdate({ templateLanguage: e.target.value === "hi" ? "hi" : "en" })
                  }
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                </select>
              </label>

              {!isSeed ? (
                <button
                  type="button"
                  className={autoBtnDanger}
                  disabled={busy !== null}
                  onClick={() => {
                    if (window.confirm(`Delete rule "${rule.name}"?`)) onDelete();
                  }}
                >
                  Delete rule
                </button>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start space-y-3">
          {preview ? <AutomationPreviewCard preview={preview} onIgnoreCap={() => onPreview(true)} /> : null}

          {recentRuns.length > 0 ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
              <p className="text-[11px] font-semibold text-[var(--brand-deep)]">Recent runs</p>
              <ul className="mt-1 space-y-1 text-[11px]">
                {recentRuns.map((r) => (
                  <li key={r.id} className="text-[var(--muted)]">
                    {formatIst(r.startedAt)} · <span className="font-semibold">{r.status}</span>
                    {r.stats.proposed ? ` · ${r.stats.proposed} proposed` : ""}
                    {r.stats.dispatched ? ` · ${r.stats.dispatched} sent` : ""}
                    {r.stats.failed ? ` · ${r.stats.failed} failed` : ""}
                    {r.notes ? ` · ${r.notes}` : ""}
                    {r.error ? <span className="text-rose-700"> — {r.error}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {linkedTemplate ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
              <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
                Linked template: {linkedTemplate.name} ({linkedTemplate.metaName})
              </p>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                Must be approved in BOTH English and Hindi at Meta. Variables
                filled per family at send time:
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
