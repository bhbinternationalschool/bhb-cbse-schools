"use client";

import { useMemo, useState } from "react";
import {
  moduleLabelAuto,
  pendingApprovals,
  ruleConfigProblem,
  type AutomationModule,
  type AutomationRule,
  type AutomationState,
} from "@/lib/automation";
import { audienceIsAutomated } from "@/lib/automationAudience";
import { describeCronExpr, describeIntervalMinutes } from "@/lib/automationSchedule";
import { audienceSummaryLabel } from "./AutomationAudiencePicker";
import { RecipientList } from "./AutomationPreviewCard";
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
  formatIst,
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

function ruleHealth(r: AutomationRule): { label: string; tone: string } {
  if (!r.enabled) return { label: "paused", tone: "bg-slate-100 text-slate-600" };
  const problem = ruleConfigProblem(r);
  if (problem) return { label: "needs setup", tone: "bg-amber-100 text-amber-800" };
  if (!audienceIsAutomated(r.audienceKey)) {
    return { label: "label only", tone: "bg-amber-100 text-amber-800" };
  }
  return {
    label: r.executionMode === "auto" ? "auto-send" : "approval-first",
    tone: r.executionMode === "auto" ? "bg-emerald-100 text-emerald-800" : "bg-sky-100 text-sky-800",
  };
}

export function AutomationListView({
  state,
  readOnly,
  notice,
  busy,
  onCreate,
  onEdit,
  onRefresh,
  onRunNow,
  onApprove,
  onReject,
  onSnooze,
}: {
  state: AutomationState;
  readOnly: boolean;
  notice: string | null;
  busy: string | null;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onRefresh: () => void;
  onRunNow: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onSnooze: (id: string) => void;
}) {
  const [tab, setTab] = useState<ListTab>("active");
  const [moduleFilter, setModuleFilter] = useState<AutomationModule | "all">(
    "all",
  );
  const [q, setQ] = useState("");

  const pending = pendingApprovals(state);
  const decided = state.approvals.filter((a) => a.status !== "pending").slice(0, 15);
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
            Scheduled WhatsApp rules, run by the server every 30 minutes
            (08:00–19:59 IST). <strong>Approval-first</strong> rules put a
            card in Approvals and wait; <strong>auto-send</strong> rules send
            by themselves. Last check:{" "}
            {state.lastTickAt ? `${formatIst(state.lastTickAt)} IST` : "never"}
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
          <button
            type="button"
            className={autoBtnOutline}
            disabled={busy !== null}
            onClick={onRefresh}
          >
            Refresh
          </button>
          {!readOnly ? (
            <button
              type="button"
              className={autoBtnOutline}
              disabled={busy !== null}
              onClick={() => {
                if (
                  window.confirm(
                    "Run every enabled rule now? Approval-first rules will raise cards; AUTO rules will SEND immediately.",
                  )
                )
                  onRunNow();
              }}
            >
              {busy === "run" ? "Running…" : "Run enabled rules now"}
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
                          {(() => {
                            const h = ruleHealth(r);
                            return (
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${h.tone}`}>
                                {h.label}
                              </span>
                            );
                          })()}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
                          {moduleLabelAuto(r.module)} · {scheduleLabel(r)} ·{" "}
                          {audienceSummaryLabel(r.audienceSummary)}
                          {r.enabled && r.nextRunAt
                            ? ` · next ${formatIst(r.nextRunAt)}`
                            : ""}
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
              label="No pending approvals. Approval-first rules add a card here at their scheduled time."
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
                      {a.templateFamilyKey || "—"} · {a.audienceCount} famil
                      {a.audienceCount === 1 ? "y" : "ies"} · raised{" "}
                      {formatIst(a.createdAt)} IST
                    </p>
                    {a.audienceNote ? (
                      <p className="text-[11px] text-[var(--muted)]">{a.audienceNote}</p>
                    ) : null}
                  </div>
                  <pre className="whitespace-pre-wrap rounded-lg bg-[var(--surface-sunken)] p-2 text-[11px]">
                    {a.previewBody}
                  </pre>
                  <RecipientList recipients={a.dispatchPayload} limit={8} />
                  {!readOnly ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={autoBtnSuccess}
                        disabled={busy !== null}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Send this WhatsApp to ${a.audienceCount} famil${a.audienceCount === 1 ? "y" : "ies"} now?`,
                            )
                          )
                            onApprove(a.id);
                        }}
                      >
                        {busy === "approve" ? "Sending…" : "Approve & send"}
                      </button>
                      <button
                        type="button"
                        className={autoBtnDanger}
                        disabled={busy !== null}
                        onClick={() => onReject(a.id)}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className={autoBtnOutline}
                        disabled={busy !== null}
                        onClick={() => onSnooze(a.id)}
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

      {tab === "approvals" && decided.length > 0 ? (
        <MastersTableCard title="Recently decided">
          <ul className="divide-y divide-[var(--border)]">
            {decided.map((a) => (
              <li key={a.id} className="space-y-1 px-3 py-2 text-[12px]">
                <p>
                  <span className="font-semibold text-[var(--brand-deep)]">{a.ruleName}</span>
                  {" · "}
                  <span
                    className={
                      a.status === "dispatched"
                        ? "text-emerald-800"
                        : a.status === "failed"
                          ? "text-rose-700"
                          : "text-[var(--muted)]"
                    }
                  >
                    {a.status}
                  </span>
                  {a.status === "dispatched" || a.status === "failed"
                    ? ` · ${a.sentCount} sent${a.failedCount ? `, ${a.failedCount} failed` : ""}`
                    : ""}
                  {a.decidedBy ? ` · by ${a.decidedBy}` : ""}
                  {a.dispatchedAt || a.decidedAt
                    ? ` · ${formatIst(a.dispatchedAt || a.decidedAt)}`
                    : ""}
                  {a.error ? <span className="text-rose-700"> — {a.error}</span> : null}
                </p>
                {a.results.length ? (
                  <details>
                    <summary className="cursor-pointer text-[11px] text-[var(--muted)]">
                      Per-family result
                    </summary>
                    <RecipientList recipients={a.dispatchPayload} results={a.results} limit={8} />
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
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
                    <span className="text-[var(--muted)]">{formatIst(r.startedAt)}</span>{" · "}
                    <span className="font-semibold text-[var(--brand-deep)]">
                      {rule?.name || r.ruleId}
                    </span>{" "}
                    · <span className={r.status === "failed" ? "text-rose-700 font-semibold" : ""}>{r.status}</span>
                    {r.stats.proposed ? ` · ${r.stats.proposed} proposed` : ""}
                    {r.stats.dispatched ? ` · ${r.stats.dispatched} sent` : ""}
                    {r.stats.failed ? ` · ${r.stats.failed} failed` : ""}
                    {r.notes ? <span className="text-[var(--muted)]"> · {r.notes}</span> : null}
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
