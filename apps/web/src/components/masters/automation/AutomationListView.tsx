"use client";

import { useMemo, useState } from "react";
import {
  moduleLabelAuto,
  pendingApprovals,
  type AutomationModule,
  type AutomationRule,
  type AutomationState,
} from "@/lib/automation";
import { describeCronExpr, describeIntervalMinutes } from "@/lib/automationSchedule";
import { audienceSummaryLabel } from "./AutomationAudiencePicker";
import {
  MastersEmptyRow,
  MastersTableCard,
} from "@/components/masters/MastersLayout";
import {
  autoBtnOutline,
  autoBtnPrimary,
  autoBtnSuccess,
  autoBtnDanger,
  autoInp,
} from "./automationUi";

type ListTab = "active" | "paused" | "approvals" | "runs";

function scheduleLabel(r: AutomationRule): string {
  if (r.triggerType === "schedule" && r.cronExpr) {
    return describeCronExpr(r.cronExpr);
  }
  if (r.triggerType === "interval" && r.intervalMinutes) {
    return describeIntervalMinutes(r.intervalMinutes);
  }
  if (r.triggerType === "event" && r.eventKey) {
    return `On: ${r.eventKey}`;
  }
  return r.triggerType;
}

export function AutomationListView({
  state,
  readOnly,
  notice,
  onCreate,
  onEdit,
  onEvaluate,
  onDispatchApproval,
  onRejectApproval,
  onSnoozeApproval,
}: {
  state: AutomationState;
  readOnly: boolean;
  notice: string | null;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onEvaluate: () => void;
  onDispatchApproval: (id: string) => void;
  onRejectApproval: (id: string) => void;
  onSnoozeApproval: (id: string) => void;
}) {
  const [tab, setTab] = useState<ListTab>("active");
  const [moduleFilter, setModuleFilter] = useState<AutomationModule | "all">(
    "all",
  );
  const [q, setQ] = useState("");

  const pending = pendingApprovals(state);
  const activeCount = state.rules.filter((r) => r.enabled).length;
  const pausedCount = state.rules.filter((r) => !r.enabled).length;

  const modules = useMemo(() => {
    return [...new Set(state.rules.map((r) => r.module))].sort();
  }, [state]);

  const filteredRules = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return state.rules.filter((r) => {
      const matchesTab =
        tab === "active" ? r.enabled : tab === "paused" ? !r.enabled : true;
      if (!matchesTab) return false;
      if (moduleFilter !== "all" && r.module !== moduleFilter) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        r.description.toLowerCase().includes(needle)
      );
    });
  }, [state, tab, moduleFilter, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--brand-deep)]">
            Automation
          </h2>
          <p className="mt-1 max-w-2xl text-[12px] text-[var(--muted)]">
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
          <button
            type="button"
            disabled={readOnly}
            className={autoBtnPrimary}
            onClick={onCreate}
          >
            + New rule
          </button>
          {!readOnly ? (
            <button
              type="button"
              className={autoBtnOutline}
              onClick={onEvaluate}
            >
              Run evaluation now
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-2">
        {(
          [
            { id: "active" as ListTab, label: `Active (${activeCount})` },
            { id: "paused" as ListTab, label: `Paused (${pausedCount})` },
            {
              id: "approvals" as ListTab,
              label: `Approvals (${pending.length})`,
            },
            { id: "runs" as ListTab, label: `Runs (${state.runs.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            className={`rounded-lg px-4 py-2 text-[12px] font-semibold ${
              tab === t.id
                ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "bg-[var(--surface-sunken)] text-[var(--brand-deep)]"
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "active" || tab === "paused" ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Search
              <input
                className={`${autoInp} mt-1`}
                placeholder="Rule name…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <label className="block text-[11px] font-semibold text-[var(--muted)]">
              Module
              <select
                className={`${autoInp} mt-1`}
                value={moduleFilter}
                onChange={(e) =>
                  setModuleFilter(e.target.value as AutomationModule | "all")
                }
              >
                <option value="all">All modules</option>
                {modules.map((m) => (
                  <option key={m} value={m}>
                    {moduleLabelAuto(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <MastersTableCard
            title={
              tab === "active"
                ? `Active rules (${filteredRules.length})`
                : `Paused rules (${filteredRules.length})`
            }
          >
            {filteredRules.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">
                {tab === "active"
                  ? "No active rules. Enable a rule or create a new one."
                  : "No paused rules."}
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {filteredRules.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-[var(--surface-sunken)]"
                      onClick={() => onEdit(r.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-semibold text-[var(--brand-deep)]">
                            {r.name}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              r.enabled
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {r.enabled ? "ON" : "OFF"}
                          </span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                            {r.executionMode}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
                          {moduleLabelAuto(r.module)} · {scheduleLabel(r)} ·{" "}
                          {audienceSummaryLabel(r.audienceSummary)}
                        </p>
                      </div>
                      <span className={autoBtnOutline}>Open</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </MastersTableCard>
        </>
      ) : null}

      {tab === "approvals" ? (
        <MastersTableCard title="Approval queue">
          {pending.length === 0 ? (
            <MastersEmptyRow
              label="No pending approvals. Run evaluation on enabled rules."
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
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
                  <pre className="whitespace-pre-wrap rounded-lg bg-[var(--surface-sunken)] p-2 text-[11px]">
                    {a.previewBody}
                  </pre>
                  <p className="text-[10px] text-[var(--muted)]">
                    Samples: {a.sampleRecipients.join(", ")}
                  </p>
                  {!readOnly ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={autoBtnSuccess}
                        onClick={() => onDispatchApproval(a.id)}
                      >
                        Approve & send
                      </button>
                      <button
                        type="button"
                        className={autoBtnDanger}
                        onClick={() => onRejectApproval(a.id)}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className={autoBtnOutline}
                        onClick={() => onSnoozeApproval(a.id)}
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
      ) : null}

      {tab === "runs" ? (
        <MastersTableCard title="Recent runs">
          {state.runs.length === 0 ? (
            <MastersEmptyRow label="No runs yet." />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
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
      ) : null}
    </div>
  );
}
