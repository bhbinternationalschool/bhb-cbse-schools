"use client";

import { useMemo, useState } from "react";
import {
  WA_TEMPLATE_VARIABLES,
  waTemplateVariableGroups,
  type WaTemplateVariableDef,
} from "@/lib/waTemplates";

const chip =
  "rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-0.5 font-mono text-[10px] text-[var(--brand-deep)] hover:border-[rgba(15,118,110,0.45)] hover:bg-[rgba(15,118,110,0.06)]";

export function WaTemplateVariablesPicker({
  onInsert,
  compact,
  highlightKeys,
}: {
  onInsert?: (key: string) => void;
  compact?: boolean;
  /** Variables used in the current template — shown first */
  highlightKeys?: string[];
}) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => waTemplateVariableGroups(), []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return WA_TEMPLATE_VARIABLES.filter((v) => {
      if (!needle) return true;
      return (
        v.key.toLowerCase().includes(needle) ||
        v.label.toLowerCase().includes(needle) ||
        v.group.toLowerCase().includes(needle)
      );
    });
  }, [q]);

  const highlighted = useMemo(() => {
    if (!highlightKeys?.length) return [] as WaTemplateVariableDef[];
    const set = new Set(highlightKeys);
    return WA_TEMPLATE_VARIABLES.filter((v) => set.has(v.key));
  }, [highlightKeys]);

  function copyKey(key: string) {
    const token = `{{${key}}}`;
    void navigator.clipboard?.writeText(token);
    onInsert?.(key);
  }

  return (
    <div
      className={`rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] ${
        compact ? "p-2" : "p-3"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-[var(--brand-deep)]">
          Template variables
        </p>
        <input
          className="min-w-[10rem] flex-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[11px]"
          placeholder="Search variables…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <p className="mt-1 text-[10px] text-[var(--muted)]">
        Click to copy <code className="font-mono">{"{{key}}"}</code> into your
        template body. Automation rules fill these at send time.
      </p>
      {highlighted.length > 0 ? (
        <div className="mt-2">
          <p className="text-[10px] font-semibold text-[#0f766e]">
            In this template
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {highlighted.map((v) => (
              <button
                key={`h-${v.key}`}
                type="button"
                className={chip}
                title={`${v.label} — e.g. ${v.sample}`}
                onClick={() => copyKey(v.key)}
              >
                {`{{${v.key}}}`}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className={`mt-2 space-y-2 ${compact ? "max-h-40" : "max-h-56"} overflow-y-auto`}>
        {groups.map((group) => {
          const items = filtered.filter((v) => v.group === group);
          if (!items.length) return null;
          return (
            <div key={group}>
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                {group}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {items.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    className={chip}
                    title={`${v.label} — e.g. ${v.sample}`}
                    onClick={() => copyKey(v.key)}
                  >
                    {`{{${v.key}}}`}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
