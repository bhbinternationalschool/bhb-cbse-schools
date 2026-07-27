"use client";

import { useEffect, useMemo, useState } from "react";
import { ensureAutomationHydrated } from "@/lib/automationPersistence";
import {
  decideApproval,
  evaluateAutomationTick,
  loadAutomation,
  markApprovalDispatched,
  markRuleTested,
  moduleLabelAuto,
  pendingApprovals,
  saveAutomation,
  setRuleEnabled,
  setRuleExecutionMode,
  updateRuleSchedule,
  type AutomationApprovalItem,
  type AutomationRule,
  type AutomationState,
} from "@/lib/automation";
import { loadWaTemplates } from "@/lib/waTemplates";
import {
  useDemoSession,
  useSessionReadOnly,
} from "@/components/shell/SessionContext";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import {
  MastersEmptyRow,
  MastersTableCard,
  MastersTabStack,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";

const inp =
  "w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm";

type AutoTab = "rules" | "approvals" | "runs";

export function AutomationPanel() {
  const session = useDemoSession();
  const readOnly = useSessionReadOnly();
  const [state, setState] = useState<AutomationState | null>(null);
  const [tab, setTab] = useState<AutoTab>("rules");
  const [notice, setNotice] = useState<string | null>(null);
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const by = session.fullName || session.roleCode || "masters";

  useEffect(() => {
    setState(loadAutomation());
    void (async () => {
      await ensureAutomationHydrated();
      setState(loadAutomation());
    })();
  }, []);

  function commit(next: AutomationState, msg?: string) {
    if (readOnly) {
      setNotice("Session is closed — automation is read-only");
      window.setTimeout(() => setNotice(null), 2800);
      return;
    }
    setState(next);
    saveAutomation(next);
    if (msg) {
      setNotice(msg);
      window.setTimeout(() => setNotice(null), 2400);
    }
  }

  const rules = useMemo(() => {
    if (!state) return [];
    return state.rules.filter(
      (r) => moduleFilter === "all" || r.module === moduleFilter,
    );
  }, [state, moduleFilter]);

  const selected = useMemo(
    () => state?.rules.find((r) => r.id === selectedRuleId) || null,
    [state, selectedRuleId],
  );

  const pending = useMemo(
    () => (state ? pendingApprovals(state) : []),
    [state],
  );

  async function dispatchApproval(item: AutomationApprovalItem) {
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
      if (!state) return;
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
      if (!state) return;
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

  if (!state) {
    return <p className="text-sm text-[var(--muted)]">Loading automation…</p>;
  }

  return (
    <MastersTabStack
      intro={
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-[var(--brand-deep)]">
                Automation
              </h2>
              <p className="text-[12px] text-[var(--muted)]">
                Whole-ERP rules. Default execution is{" "}
                <strong>approval-first</strong>; enable auto-run only after Mark
                tested. Last tick: {state.lastTickAt || "never"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {notice ? (
                <span className="rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-1.5 text-xs font-medium text-[var(--brand-deep)]">
                  {notice}
                </span>
              ) : null}
              {!readOnly ? (
                <button
                  type="button"
                  className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-white"
                  onClick={() =>
                    commit(
                      evaluateAutomationTick(state, {
                        forceRuleIds: state.rules
                          .filter((r) => r.enabled)
                          .map((r) => r.id),
                      }),
                      "Evaluation ran — check Approvals",
                    )
                  }
                >
                  Run evaluation now
                </button>
              ) : null}
            </div>
          </div>
          <ModuleTabs
            aria-label="Automation sections"
            value={tab}
            onChange={(id) => setTab(id as AutoTab)}
            items={[
              {
                id: "rules",
                label: `Rules (${state.rules.length})`,
                tone: "navy",
              },
              {
                id: "approvals",
                label: `Approvals (${pending.length})`,
                tone: "amber",
              },
              {
                id: "runs",
                label: `Runs (${state.runs.length})`,
                tone: "slate",
              },
            ]}
          />
        </div>
      }
      tables={
        tab === "rules" ? (
          <div className="space-y-3">
            <label className="block max-w-xs text-[11px] font-semibold text-[var(--muted)]">
              Module filter
              <select
                className={`${inp} mt-1`}
                value={moduleFilter}
                onChange={(e) => setModuleFilter(e.target.value)}
              >
                <option value="all">All modules</option>
                {[...new Set(state.rules.map((r) => r.module))].map((m) => (
                  <option key={m} value={m}>
                    {moduleLabelAuto(m)}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 lg:grid-cols-2">
              <MastersTableCard title="Rule catalog">
                {rules.length === 0 ? (
                  <MastersEmptyRow label="No rules." />
                ) : (
                  <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
                    {rules.map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          className={`flex w-full items-start justify-between gap-2 px-3 py-2 text-left hover:bg-[rgba(32,48,80,0.04)] ${
                            selectedRuleId === r.id
                              ? "bg-[rgba(32,48,80,0.06)]"
                              : ""
                          }`}
                          onClick={() => setSelectedRuleId(r.id)}
                        >
                          <div>
                            <p className="text-[13px] font-semibold text-[var(--brand-deep)]">
                              {r.name}
                            </p>
                            <p className="text-[11px] text-[var(--muted)]">
                              {moduleLabelAuto(r.module)} · {r.triggerType} ·{" "}
                              {r.executionMode}
                            </p>
                          </div>
                          <span
                            className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              r.enabled
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {r.enabled ? "ON" : "OFF"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </MastersTableCard>
              <MastersTableCard title="Selection">
                {!selected ? (
                  <MastersEmptyRow label="Select a rule to configure." />
                ) : (
                  <div className="p-3 text-[12px]">
                    <p className="font-semibold text-[var(--brand-deep)]">
                      {selected.name}
                    </p>
                    <p className="text-[11px] text-[var(--muted)]">
                      {selected.audienceSummary}
                    </p>
                  </div>
                )}
              </MastersTableCard>
            </div>
          </div>
        ) : tab === "approvals" ? (
          <MastersTableCard title="Approval queue">
            {pending.length === 0 ? (
              <MastersEmptyRow label="No pending approvals. Run evaluation on enabled rules." />
            ) : (
              <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
                {pending.map((a) => (
                  <li key={a.id} className="space-y-2 px-3 py-3">
                    <div>
                      <p className="text-[13px] font-semibold text-[var(--brand-deep)]">
                        {a.ruleName}
                      </p>
                      <p className="text-[11px] text-[var(--muted)]">
                        {a.templateFamilyKey || "—"} · {a.templateLanguage} ·{" "}
                        {a.audienceCount} recipients ·{" "}
                        {new Date(a.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <pre className="whitespace-pre-wrap rounded-lg bg-[rgba(32,48,80,0.04)] p-2 text-[11px]">
                      {a.previewBody}
                    </pre>
                    <p className="text-[10px] text-[var(--muted)]">
                      Samples: {a.sampleRecipients.join(", ")}
                    </p>
                    {!readOnly ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-[11px] font-semibold text-white"
                          onClick={() => void dispatchApproval(a)}
                        >
                          Approve & send
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-rose-300 px-3 py-1.5 text-[11px] font-semibold text-rose-800"
                          onClick={() =>
                            commit(
                              decideApproval(state, a.id, "rejected", by),
                              "Rejected",
                            )
                          }
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-[11px] font-semibold"
                          onClick={() =>
                            commit(
                              decideApproval(state, a.id, "snoozed", by, 24),
                              "Snoozed 24h",
                            )
                          }
                        >
                          Snooze 24h
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </MastersTableCard>
        ) : (
          <MastersTableCard title="Recent runs">
            {state.runs.length === 0 ? (
              <MastersEmptyRow label="No runs yet." />
            ) : (
              <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
                {state.runs.slice(0, 40).map((r) => {
                  const rule = state.rules.find((x) => x.id === r.ruleId);
                  return (
                    <li key={r.id} className="px-3 py-2 text-[12px]">
                      <span className="font-semibold text-[var(--brand-deep)]">
                        {rule?.name || r.ruleId}
                      </span>{" "}
                      · {r.status} · proposed {r.stats.proposed} · dispatched{" "}
                      {r.stats.dispatched}
                      {r.error ? (
                        <span className="text-rose-700"> — {r.error}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </MastersTableCard>
        )
      }
      work={
        tab === "rules" ? (
          <MastersWorkCard
            title={selected ? selected.name : "Rule detail"}
            hint="Enable, schedule, mark tested, optional auto"
          >
            {!selected ? (
              <p className="text-[12px] text-[var(--muted)]">
                Select a rule. New approvals appear after evaluation for enabled
                rules.
              </p>
            ) : (
              <RuleEditor
                rule={selected}
                readOnly={readOnly}
                onToggle={(enabled) =>
                  commit(
                    setRuleEnabled(state, selected.id, enabled),
                    enabled ? "Rule enabled" : "Rule disabled",
                  )
                }
                onMarkTested={() =>
                  commit(markRuleTested(state, selected.id), "Marked tested")
                }
                onMode={(mode) => {
                  const r = setRuleExecutionMode(state, selected.id, mode);
                  if (!r.ok) {
                    setNotice(r.reason);
                    window.setTimeout(() => setNotice(null), 2800);
                    return;
                  }
                  commit(r.state, `Mode → ${mode}`);
                }}
                onSchedule={(patch) =>
                  commit(
                    updateRuleSchedule(state, selected.id, patch),
                    "Schedule updated",
                  )
                }
                onForceEvaluate={() =>
                  commit(
                    evaluateAutomationTick(state, {
                      forceRuleIds: [selected.id],
                    }),
                    "Rule evaluated → Approvals",
                  )
                }
              />
            )}
          </MastersWorkCard>
        ) : tab === "approvals" ? (
          <MastersWorkCard
            title="Approval help"
            hint="Approve → /api/wa/dispatch (stub until Meta configured)"
          >
            <p className="text-[12px] text-[var(--muted)]">
              Recent decisions:{" "}
              {state.approvals.filter((a) => a.status !== "pending").length === 0
                ? "none yet"
                : state.approvals
                    .filter((a) => a.status !== "pending")
                    .slice(0, 5)
                    .map((a) => `${a.status}:${a.ruleName}`)
                    .join(" · ")}
            </p>
          </MastersWorkCard>
        ) : (
          <MastersWorkCard
            title="Cron tick"
            hint="POST /api/wa/automation/tick with CRON_SECRET or WA_DISPATCH_SECRET"
          >
            <p className="text-[12px] text-[var(--muted)]">
              Wire an external cron every 5–15 minutes. Browser “Run evaluation
              now” is enough for desk ops.
            </p>
          </MastersWorkCard>
        )
      }
    />
  );
}

function RuleEditor({
  rule,
  readOnly,
  onToggle,
  onMarkTested,
  onMode,
  onSchedule,
  onForceEvaluate,
}: {
  rule: AutomationRule;
  readOnly: boolean;
  onToggle: (enabled: boolean) => void;
  onMarkTested: () => void;
  onMode: (mode: "approval_first" | "auto") => void;
  onSchedule: (
    patch: Partial<
      Pick<
        AutomationRule,
        "cronExpr" | "intervalMinutes" | "templateLanguage" | "nextRunAt"
      >
    >,
  ) => void;
  onForceEvaluate: () => void;
}) {
  const [cron, setCron] = useState(rule.cronExpr);
  const [interval, setIntervalMins] = useState(String(rule.intervalMinutes));

  useEffect(() => {
    setCron(rule.cronExpr);
    setIntervalMins(String(rule.intervalMinutes));
  }, [rule.id, rule.cronExpr, rule.intervalMinutes]);

  return (
    <div className="space-y-3 text-[12px]">
      <p className="text-[var(--muted)]">{rule.description}</p>
      <p className="text-[11px] text-[var(--muted)]">
        Action: {rule.actionType}
        {rule.templateFamilyKey
          ? ` · ${rule.templateFamilyKey} (${rule.templateLanguage})`
          : ""}
        <br />
        Audience: {rule.audienceSummary}
        <br />
        Trigger: {rule.triggerType}
        {rule.eventKey ? ` · ${rule.eventKey}` : ""}
        {rule.cronExpr ? ` · cron ${rule.cronExpr}` : ""}
        {rule.intervalMinutes ? ` · every ${rule.intervalMinutes}m` : ""}
        <br />
        Tested:{" "}
        {rule.testedAt ? new Date(rule.testedAt).toLocaleString() : "not yet"}
        <br />
        Next run: {rule.nextRunAt || "on next tick"}
      </p>
      {!readOnly ? (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-[11px] font-semibold text-white"
              onClick={() => onToggle(!rule.enabled)}
            >
              {rule.enabled ? "Disable" : "Enable"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-[11px] font-semibold"
              onClick={onMarkTested}
            >
              Mark tested
            </button>
            <button
              type="button"
              className="rounded-lg border border-[rgba(32,48,80,0.2)] px-3 py-1.5 text-[11px] font-semibold"
              onClick={() =>
                onMode(
                  rule.executionMode === "auto" ? "approval_first" : "auto",
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
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Cron (schedule)
              <input
                className={`${inp} mt-1 font-mono text-[11px]`}
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                onBlur={() => onSchedule({ cronExpr: cron })}
              />
            </label>
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Interval minutes
              <input
                className={`${inp} mt-1`}
                value={interval}
                onChange={(e) => setIntervalMins(e.target.value)}
                onBlur={() =>
                  onSchedule({
                    intervalMinutes: Math.max(0, Number(interval) || 0),
                  })
                }
              />
            </label>
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Template language
              <select
                className={`${inp} mt-1`}
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
          </div>
        </>
      ) : null}
    </div>
  );
}
