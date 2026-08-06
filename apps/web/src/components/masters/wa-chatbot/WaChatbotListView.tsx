"use client";

import { useMemo, useState } from "react";
import {
  audienceLabel,
  type WaChatbotFlow,
  type WaChatbotFlowsState,
} from "@/lib/waChatbotFlows";
import {
  MastersEmptyRow,
  MastersTableCard,
} from "@/components/masters/MastersLayout";
import { botBtnOutline, botBtnTeal, botInp } from "./waChatbotUi";

type ListTab = "built_in" | "custom";

export function WaChatbotListView({
  state,
  readOnly,
  notice,
  onCreate,
  onEdit,
  onDuplicate,
}: {
  state: WaChatbotFlowsState;
  readOnly: boolean;
  notice: string | null;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const [tab, setTab] = useState<ListTab>("built_in");
  const [q, setQ] = useState("");

  const builtIn = state.flows.filter((f) => f.status === "built_in");
  const custom = state.flows.filter((f) => f.status !== "built_in");

  const filtered = useMemo(() => {
    const pool = tab === "built_in" ? builtIn : custom;
    const needle = q.trim().toLowerCase();
    if (!needle) return pool;
    return pool.filter(
      (f) =>
        f.name.toLowerCase().includes(needle) ||
        f.description.toLowerCase().includes(needle),
    );
  }, [tab, builtIn, custom, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--brand-deep)]">
            WhatsApp chatbots
          </h2>
          <p className="mt-1 max-w-2xl text-[12px] text-[var(--muted)]">
            Built-in bots mirror what runs in production today. Create custom
            bots with the drag-and-drop builder — duplicate a built-in bot to
            start faster.
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
            className={botBtnTeal}
            onClick={onCreate}
          >
            + New chatbot
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-[rgba(32,48,80,0.1)] pb-2">
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-[12px] font-semibold ${
            tab === "built_in"
              ? "bg-[var(--brand-deep)] text-white"
              : "bg-[rgba(32,48,80,0.06)] text-[var(--brand-deep)]"
          }`}
          onClick={() => setTab("built_in")}
        >
          Built-in ({builtIn.length})
        </button>
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-[12px] font-semibold ${
            tab === "custom"
              ? "bg-[var(--brand-deep)] text-white"
              : "bg-[rgba(32,48,80,0.06)] text-[var(--brand-deep)]"
          }`}
          onClick={() => setTab("custom")}
        >
          My chatbots ({custom.length})
        </button>
      </div>

      <label className="block max-w-md text-[11px] font-semibold text-[var(--muted)]">
        Search
        <input
          className={`${botInp} mt-1`}
          value={q}
          placeholder="Name or description…"
          onChange={(e) => setQ(e.target.value)}
        />
      </label>

      <MastersTableCard
        title={
          tab === "built_in"
            ? `Built-in chatbots (${filtered.length})`
            : `Custom chatbots (${filtered.length})`
        }
      >
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-[var(--muted)]">
            {tab === "built_in"
              ? "No built-in bots found."
              : "No custom bots yet — create one or duplicate a built-in bot."}
          </div>
        ) : (
          <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
            {filtered.map((f) => (
              <FlowRow
                key={f.id}
                flow={f}
                readOnly={readOnly}
                onOpen={() => onEdit(f.id)}
                onDuplicate={() => onDuplicate(f.id)}
              />
            ))}
          </ul>
        )}
      </MastersTableCard>
    </div>
  );
}

function FlowRow({
  flow,
  readOnly,
  onOpen,
  onDuplicate,
}: {
  flow: WaChatbotFlow;
  readOnly: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
}) {
  const isBuiltIn = flow.status === "built_in";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
      <button
        type="button"
        className="min-w-0 flex-1 text-left hover:opacity-90"
        onClick={onOpen}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-[var(--brand-deep)]">
            {flow.name}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
              isBuiltIn
                ? "bg-violet-100 text-violet-800"
                : flow.status === "published"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-900"
            }`}
          >
            {isBuiltIn ? "built-in" : flow.status}
          </span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
            {audienceLabel(flow.audience)}
          </span>
          <span className="text-[10px] text-[var(--muted)]">
            {flow.nodes.length} steps
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
          {flow.description}
        </p>
      </button>
      <div className="flex flex-wrap gap-2">
        {isBuiltIn ? (
          <button
            type="button"
            disabled={readOnly}
            className={botBtnOutline}
            onClick={onDuplicate}
          >
            Duplicate to edit
          </button>
        ) : null}
        <button type="button" className={botBtnOutline} onClick={onOpen}>
          {isBuiltIn ? "View" : "Edit"}
        </button>
      </div>
    </li>
  );
}
