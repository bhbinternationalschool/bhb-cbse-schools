"use client";

import { useCallback, useState } from "react";
import {
  WA_CHATBOT_NODE_PALETTE,
  newPaletteNode,
  reorderFlowNodes,
  type WaChatbotNode,
  type WaChatbotNodeType,
} from "@/lib/waChatbotFlows";
import { botChip, botInp } from "./waChatbotUi";

const DRAG_TYPE = "application/wa-chatbot-node";

export function WaChatbotBuilder({
  nodes,
  entryNodeId,
  readOnly,
  onChange,
}: {
  nodes: WaChatbotNode[];
  entryNodeId: string;
  readOnly: boolean;
  onChange: (nodes: WaChatbotNode[], entryNodeId?: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    nodes[0]?.id || null,
  );
  const [dragStepIndex, setDragStepIndex] = useState<number | null>(null);

  const selected = nodes.find((n) => n.id === selectedId) || null;

  const updateNode = useCallback(
    (id: string, patch: Partial<WaChatbotNode>) => {
      onChange(
        nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
      );
    },
    [nodes, onChange],
  );

  function addNode(type: WaChatbotNodeType, atIndex?: number) {
    const y = 40 + nodes.length * 100;
    const fresh = newPaletteNode(type, y);
    const next = [...nodes];
    const idx = atIndex ?? next.length;
    next.splice(idx, 0, fresh);
    onChange(next, entryNodeId || fresh.id);
    setSelectedId(fresh.id);
  }

  function removeNode(id: string) {
    const next = nodes.filter((n) => n.id !== id);
    nodes.forEach((n) => {
      n.buttons?.forEach((b) => {
        if (b.nextNodeId === id) b.nextNodeId = "";
      });
      n.listRows?.forEach((r) => {
        if (r.nextNodeId === id) r.nextNodeId = "";
      });
    });
    const newEntry =
      entryNodeId === id ? next[0]?.id || "" : entryNodeId;
    onChange(next, newEntry);
    if (selectedId === id) setSelectedId(next[0]?.id || null);
  }

  function onStepDrop(targetIndex: number) {
    if (dragStepIndex == null || dragStepIndex === targetIndex) return;
    onChange(reorderFlowNodes(nodes, dragStepIndex, targetIndex));
    setDragStepIndex(null);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[200px_1fr_280px]">
      {/* Palette */}
      <div className="space-y-2 rounded-xl border bg-[var(--surface-sunken)] p-3">
        <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
          Blocks
        </p>
        <p className="text-[10px] text-[var(--muted)]">
          Drag onto the flow or click to add.
        </p>
        <div className="space-y-2">
          {WA_CHATBOT_NODE_PALETTE.map((p) => (
            <div
              key={p.type}
              draggable={!readOnly}
              className={botChip}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, p.type);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => !readOnly && addNode(p.type)}
            >
              <span className="block">{p.label}</span>
              <span className="text-[9px] font-normal text-[var(--muted)]">
                {p.hint}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Canvas + step list */}
      <div className="space-y-3">
        <div
          className="relative min-h-[320px] overflow-auto rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-sunken)] p-4"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            e.preventDefault();
            const type = e.dataTransfer.getData(DRAG_TYPE) as WaChatbotNodeType;
            if (type && !readOnly) addNode(type);
          }}
        >
          <p className="mb-2 text-[10px] font-semibold text-[var(--muted)]">
            Flow canvas — drag blocks here
          </p>
          {nodes.length === 0 ? (
            <p className="text-[12px] text-[var(--muted)]">
              Drop a Welcome block to start.
            </p>
          ) : (
            nodes.map((n) => (
              <div
                key={n.id}
                draggable={!readOnly}
                className={`absolute w-[220px] cursor-move rounded-lg border bg-[var(--card)] p-2 shadow-sm ${
                  selectedId === n.id
                    ? "border-[#0f766e] ring-2 ring-[rgba(15,118,110,0.2)]"
                    : "border-[var(--border)]"
                }`}
                style={{ left: n.x, top: n.y }}
                onClick={() => setSelectedId(n.id)}
                onDragEnd={(e) => {
                  if (readOnly) return;
                  const rect = (
                    e.currentTarget.parentElement as HTMLElement
                  ).getBoundingClientRect();
                  updateNode(n.id, {
                    x: Math.max(0, e.clientX - rect.left - 80),
                    y: Math.max(0, e.clientY - rect.top - 20),
                  });
                }}
              >
                <p className="text-[10px] font-bold uppercase text-[#0f766e]">
                  {n.type}
                  {entryNodeId === n.id ? " · start" : ""}
                </p>
                <p className="truncate text-[12px] font-semibold">{n.title}</p>
                <p className="line-clamp-2 text-[10px] text-[var(--muted)]">
                  {n.body}
                </p>
              </div>
            ))
          )}
        </div>

        <div className="rounded-xl border bg-[var(--card)] p-3">
          <p className="mb-2 text-[11px] font-semibold text-[var(--brand-deep)]">
            Flow order (drag to reorder)
          </p>
          <ul className="space-y-1">
            {nodes.map((n, i) => (
              <li
                key={n.id}
                draggable={!readOnly}
                className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-[11px] ${
                  selectedId === n.id
                    ? "border-[#0f766e] bg-[rgba(15,118,110,0.06)]"
                    : "border-[var(--border)]"
                }`}
                onDragStart={() => setDragStepIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  onStepDrop(i);
                }}
                onClick={() => setSelectedId(n.id)}
              >
                <span className="cursor-grab text-[var(--muted)]">⋮⋮</span>
                <span className="font-semibold text-[var(--brand-deep)]">
                  {i + 1}. {n.title}
                </span>
                <span className="text-[10px] text-[var(--muted)]">
                  ({n.type})
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Properties */}
      <div className="rounded-xl border bg-[var(--card)] p-3">
        <p className="mb-2 text-[11px] font-semibold text-[var(--brand-deep)]">
          Step properties
        </p>
        {!selected ? (
          <p className="text-[11px] text-[var(--muted)]">
            Select a step on the canvas or list.
          </p>
        ) : (
          <div className="space-y-2 text-[11px]">
            <label className="block font-semibold text-[var(--muted)]">
              Title
              <input
                className={`${botInp} mt-1`}
                value={selected.title}
                disabled={readOnly}
                onChange={(e) =>
                  updateNode(selected.id, { title: e.target.value })
                }
              />
            </label>
            <label className="block font-semibold text-[var(--muted)]">
              Message body
              <textarea
                className={`${botInp} mt-1 min-h-[80px] font-mono text-[10px]`}
                value={selected.body}
                disabled={readOnly}
                onChange={(e) =>
                  updateNode(selected.id, { body: e.target.value })
                }
              />
            </label>
            {selected.type === "action" ? (
              <label className="block font-semibold text-[var(--muted)]">
                ERP action key
                <input
                  className={`${botInp} mt-1 font-mono text-[10px]`}
                  value={selected.actionKey || ""}
                  disabled={readOnly}
                  placeholder="fees.dues"
                  onChange={(e) =>
                    updateNode(selected.id, { actionKey: e.target.value })
                  }
                />
              </label>
            ) : null}
            {selected.type === "buttons" ? (
              <ButtonEditor
                node={selected}
                nodes={nodes}
                readOnly={readOnly}
                onChange={(buttons) =>
                  updateNode(selected.id, { buttons })
                }
              />
            ) : null}
            {selected.type === "list" ? (
              <ListEditor
                node={selected}
                nodes={nodes}
                readOnly={readOnly}
                onChange={(listRows) =>
                  updateNode(selected.id, { listRows })
                }
              />
            ) : null}
            <div className="flex flex-wrap gap-2 pt-2">
              {entryNodeId !== selected.id ? (
                <button
                  type="button"
                  disabled={readOnly}
                  className="text-[10px] font-semibold text-[#0f766e] underline"
                  onClick={() => onChange(nodes, selected.id)}
                >
                  Set as start step
                </button>
              ) : null}
              {!readOnly ? (
                <button
                  type="button"
                  className="text-[10px] font-semibold text-rose-700 underline"
                  onClick={() => removeNode(selected.id)}
                >
                  Delete step
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ButtonEditor({
  node,
  nodes,
  readOnly,
  onChange,
}: {
  node: WaChatbotNode;
  nodes: WaChatbotNode[];
  readOnly: boolean;
  onChange: (buttons: NonNullable<WaChatbotNode["buttons"]>) => void;
}) {
  const buttons = node.buttons || [];
  return (
    <div className="space-y-2">
      <p className="font-semibold text-[var(--muted)]">Buttons (max 3)</p>
      {buttons.map((b, i) => (
        <div key={b.id} className="rounded border p-2 space-y-1">
          <input
            className={botInp}
            value={b.title}
            disabled={readOnly}
            placeholder="Button label"
            onChange={(e) => {
              const next = [...buttons];
              next[i] = { ...b, title: e.target.value };
              onChange(next);
            }}
          />
          <input
            className={botInp}
            value={b.keyword || ""}
            disabled={readOnly}
            placeholder="Keyword e.g. PAY"
            onChange={(e) => {
              const next = [...buttons];
              next[i] = { ...b, keyword: e.target.value };
              onChange(next);
            }}
          />
          <select
            className={botInp}
            value={b.nextNodeId || ""}
            disabled={readOnly}
            onChange={(e) => {
              const next = [...buttons];
              next[i] = { ...b, nextNodeId: e.target.value };
              onChange(next);
            }}
          >
            <option value="">— next step —</option>
            {nodes
              .filter((n) => n.id !== node.id)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
          </select>
        </div>
      ))}
      {!readOnly && buttons.length < 3 ? (
        <button
          type="button"
          className="text-[10px] font-semibold text-[#0f766e]"
          onClick={() =>
            onChange([
              ...buttons,
              {
                id: `btn_${Date.now()}`,
                title: `Button ${buttons.length + 1}`,
              },
            ])
          }
        >
          + Add button
        </button>
      ) : null}
    </div>
  );
}

function ListEditor({
  node,
  nodes,
  readOnly,
  onChange,
}: {
  node: WaChatbotNode;
  nodes: WaChatbotNode[];
  readOnly: boolean;
  onChange: (rows: NonNullable<WaChatbotNode["listRows"]>) => void;
}) {
  const rows = node.listRows || [];
  return (
    <div className="space-y-2">
      <p className="font-semibold text-[var(--muted)]">List rows</p>
      {rows.map((r, i) => (
        <div key={r.id} className="rounded border p-2 space-y-1">
          <input
            className={botInp}
            value={r.title}
            disabled={readOnly}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...r, title: e.target.value };
              onChange(next);
            }}
          />
          <input
            className={botInp}
            value={r.description || ""}
            disabled={readOnly}
            placeholder="Description"
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...r, description: e.target.value };
              onChange(next);
            }}
          />
          <select
            className={botInp}
            value={r.nextNodeId || ""}
            disabled={readOnly}
            onChange={(e) => {
              const next = [...rows];
              next[i] = { ...r, nextNodeId: e.target.value };
              onChange(next);
            }}
          >
            <option value="">— next step —</option>
            {nodes
              .filter((n) => n.id !== node.id)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
          </select>
        </div>
      ))}
      {!readOnly ? (
        <button
          type="button"
          className="text-[10px] font-semibold text-[#0f766e]"
          onClick={() =>
            onChange([
              ...rows,
              { id: `row_${Date.now()}`, title: `Row ${rows.length + 1}` },
            ])
          }
        >
          + Add row
        </button>
      ) : null}
    </div>
  );
}
