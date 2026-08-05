"use client";

import { useState } from "react";
import {
  audienceLabel,
  updateWaChatbotFlow,
  type WaChatbotFlow,
  type WaChatbotFlowsState,
} from "@/lib/waChatbotFlows";
import { WaChatbotBuilder } from "./WaChatbotBuilder";
import { botBtnOutline, botBtnPrimary, botBtnTeal, botInp } from "./waChatbotUi";

export function WaChatbotEditView({
  flow,
  readOnly,
  notice,
  onBack,
  onSave,
  onDelete,
}: {
  flow: WaChatbotFlow;
  readOnly: boolean;
  notice: string | null;
  onBack: () => void;
  onSave: (patch: Parameters<typeof updateWaChatbotFlow>[2]) => void;
  onDelete?: () => void;
}) {
  const isBuiltIn = flow.status === "built_in";
  const [name, setName] = useState(flow.name);
  const [description, setDescription] = useState(flow.description);
  const [nodes, setNodes] = useState(flow.nodes);
  const [entryNodeId, setEntryNodeId] = useState(flow.entryNodeId);

  function persistNodes(nextNodes: typeof nodes, nextEntry?: string) {
    setNodes(nextNodes);
    if (nextEntry) setEntryNodeId(nextEntry);
    if (!isBuiltIn && !readOnly) {
      onSave({
        nodes: nextNodes,
        entryNodeId: nextEntry || entryNodeId,
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--brand-deep)]">
            {flow.name}
          </h2>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            {audienceLabel(flow.audience)} · {flow.nodes.length} steps
            {isBuiltIn ? " · read-only — duplicate to customize" : ""}
          </p>
        </div>
        <button type="button" className={botBtnOutline} onClick={onBack}>
          ← Back to list
        </button>
      </div>

      {notice ? (
        <span className="inline-block rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-1.5 text-xs">
          {notice}
        </span>
      ) : null}

      {isBuiltIn ? (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[11px] text-violet-900">
          This is a production built-in bot. Use <strong>Duplicate to edit</strong>{" "}
          from the list to create your own copy with the drag-and-drop builder.
        </div>
      ) : null}

      {!isBuiltIn ? (
        <div className="grid gap-2 sm:grid-cols-2 rounded-xl border bg-white p-3">
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Name
            <input
              className={`${botInp} mt-1`}
              value={name}
              disabled={readOnly}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name !== flow.name) onSave({ name: name.trim() });
              }}
            />
          </label>
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Description
            <input
              className={`${botInp} mt-1`}
              value={description}
              disabled={readOnly}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => {
                if (description !== flow.description)
                  onSave({ description });
              }}
            />
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button
              type="button"
              disabled={readOnly}
              className={botBtnPrimary}
              onClick={() =>
                onSave({ enabled: !flow.enabled, status: flow.status })
              }
            >
              {flow.enabled ? "Disable" : "Enable"}
            </button>
            <button
              type="button"
              disabled={readOnly}
              className={botBtnTeal}
              onClick={() =>
                onSave({
                  status: flow.status === "published" ? "draft" : "published",
                })
              }
            >
              {flow.status === "published" ? "Unpublish" : "Publish"}
            </button>
            {onDelete ? (
              <button
                type="button"
                disabled={readOnly}
                className="rounded-lg border border-rose-300 px-3 py-2 text-[11px] font-semibold text-rose-800"
                onClick={onDelete}
              >
                Delete
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <WaChatbotBuilder
        nodes={nodes}
        entryNodeId={entryNodeId}
        readOnly={readOnly || isBuiltIn}
        onChange={persistNodes}
      />
    </div>
  );
}
