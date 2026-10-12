"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Lock, Plus, Ban, Search } from "lucide-react";
import {
  actionLabel,
  filterTree,
  leafKey,
  moduleLeaves,
  rowLeaves,
  treeCounters,
  triState,
  type TreeCategory,
  type TreeFunction,
  type TreeLeaf,
  type TriState,
} from "@/lib/rbacEditorModel";

/** How one action checkbox looks, decided by the screen using the tree. */
export type LeafView = {
  on: boolean;
  /** role = from a role (locked look), personal = given to this person,
   * deny = taken away from this person, module = held via the module tick. */
  source?: "role" | "personal" | "deny" | "module";
  /** Hover text, e.g. "From Office role". */
  title?: string;
  disabled?: boolean;
};

/**
 * Category → Module → function → action checkboxes (Masters → Roles).
 *
 * Generic: the caller says what each leaf looks like and what a tick does;
 * this draws the tree, the search, Expand / Collapse all, Check all, the
 * tri-state parents and the counters. Built from the catalogue, so new
 * functions appear without touching this file.
 */
export function RbacPermissionTree({
  tree,
  view,
  onSet,
  readOnly,
  toolbarExtra,
}: {
  tree: TreeCategory[];
  view: (leaf: TreeLeaf) => LeafView;
  /** Tick (true) or clear (false) these leaves. */
  onSet: (leaves: TreeLeaf[], on: boolean) => void;
  readOnly: boolean;
  toolbarExtra?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set(tree.map((c) => `c:${c.id}`)));
  const shown = useMemo(() => filterTree(tree, query), [tree, query]);
  const searching = query.trim().length > 0;
  const isOpen = (key: string) => searching || open.has(key);
  const isOn = (l: TreeLeaf) => view(l).on;
  const counters = treeCounters(tree, isOn);
  const editable = (l: TreeLeaf) => !readOnly && !view(l).disabled;

  function toggleOpen(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function expandAll() {
    setOpen(new Set(tree.flatMap((c) => [`c:${c.id}`, ...c.modules.map((m) => `m:${m.module}`)])));
  }
  function collapseAll() {
    setOpen(new Set());
  }
  /** Bulk: only the leaves the person may change, in what is shown. */
  function setMany(leaves: TreeLeaf[], on: boolean) {
    const target = leaves.filter(editable);
    if (target.length) onSet(target, on);
  }
  const shownLeaves = shown.flatMap((c) => c.modules.flatMap(moduleLeaves));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-[var(--muted)]" aria-hidden />
          <input
            type="search"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] py-2 pl-8 pr-3 text-sm"
            placeholder="Search modules and functions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search permissions"
          />
        </label>
        <TreeButton onClick={expandAll}>Expand all</TreeButton>
        <TreeButton onClick={collapseAll}>Collapse all</TreeButton>
        <TreeButton onClick={() => setMany(shownLeaves, true)} disabled={readOnly}>
          {searching ? "Check all shown" : "Check all"}
        </TreeButton>
        <TreeButton onClick={() => setMany(shownLeaves, false)} disabled={readOnly}>
          {searching ? "Clear all shown" : "Clear all"}
        </TreeButton>
        {toolbarExtra}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
        <span>
          Modules enabled <strong className="text-[var(--foreground)]">{counters.modulesOn}</strong>/{counters.modules}
        </span>
        <span>
          Functions enabled <strong className="text-[var(--foreground)]">{counters.functionsOn}</strong>/{counters.functions}
        </span>
        <span className="flex items-center gap-1"><Lock className="size-3" aria-hidden /> from a role</span>
        <span className="flex items-center gap-1 text-[var(--success)]"><Plus className="size-3" aria-hidden /> given to this person</span>
        <span className="flex items-center gap-1 text-[var(--danger)]"><Ban className="size-3" aria-hidden /> taken away from this person</span>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted)]">
          Nothing matches “{query}”.
        </p>
      ) : null}

      <div className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--card)]">
        {shown.map((cat) => {
          const catKey = `c:${cat.id}`;
          const leaves = cat.modules.flatMap(moduleLeaves);
          const ts = triState(leaves, isOn);
          const catCounts = treeCounters([cat], isOn);
          return (
            <section key={cat.id}>
              <div className="flex items-center gap-2 bg-[var(--surface-sunken)] px-3 py-2">
                <ExpandButton open={isOpen(catKey)} onClick={() => toggleOpen(catKey)} label={cat.label} />
                <TriCheckbox
                  state={ts}
                  disabled={readOnly}
                  onChange={(on) => setMany(leaves, on)}
                  label={`All of ${cat.label}`}
                />
                <button
                  type="button"
                  className="flex-1 text-left text-[11px] font-bold uppercase tracking-wide text-[var(--brand-deep)]"
                  onClick={() => toggleOpen(catKey)}
                >
                  {cat.label}
                </button>
                <span className="text-[11px] text-[var(--muted)]">
                  {catCounts.modulesOn}/{catCounts.modules} modules
                </span>
              </div>
              {isOpen(catKey)
                ? cat.modules.map((m) => {
                    const mKey = `m:${m.module}`;
                    const mLeaves = moduleLeaves(m);
                    const mts = triState(mLeaves, isOn);
                    const fnRows = m.rows.filter((r) => r.kind === "feature");
                    const fnOn = fnRows.filter((r) => rowLeaves(r).some(isOn)).length;
                    return (
                      <div key={m.module} className="border-t border-[var(--border)]">
                        <div className="flex items-center gap-2 px-3 py-2 pl-6">
                          <ExpandButton open={isOpen(mKey)} onClick={() => toggleOpen(mKey)} label={m.label} />
                          <TriCheckbox
                            state={mts}
                            disabled={readOnly}
                            onChange={(on) => setMany(mLeaves, on)}
                            label={`All of ${m.label}`}
                          />
                          <button
                            type="button"
                            className="flex-1 text-left text-sm font-semibold text-[var(--foreground)]"
                            onClick={() => toggleOpen(mKey)}
                          >
                            {m.label}
                          </button>
                          <span className="text-[11px] text-[var(--muted)]">
                            {fnRows.length ? `${fnOn}/${fnRows.length} functions` : "module only"}
                          </span>
                        </div>
                        {isOpen(mKey) ? (
                          <div className="pb-2">
                            {m.rows.map((r, i) => (
                              <TreeRow
                                key={r.key}
                                row={r}
                                groupHeading={
                                  r.kind === "feature" && r.group && r.group !== m.rows[i - 1]?.group
                                    ? r.group
                                    : null
                                }
                                view={view}
                                readOnly={readOnly}
                                onSet={(leaves, on) => setMany(leaves, on)}
                                onSetOne={(leaf, on) => onSet([leaf], on)}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TreeRow({
  row,
  groupHeading,
  view,
  readOnly,
  onSet,
  onSetOne,
}: {
  row: TreeFunction;
  groupHeading: string | null;
  view: (leaf: TreeLeaf) => LeafView;
  readOnly: boolean;
  onSet: (leaves: TreeLeaf[], on: boolean) => void;
  onSetOne: (leaf: TreeLeaf, on: boolean) => void;
}) {
  const leaves = rowLeaves(row);
  const ts = triState(leaves, (l) => view(l).on);
  return (
    <>
      {groupHeading ? (
        <p className="pl-14 pr-3 pt-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
          {groupHeading}
        </p>
      ) : null}
      <div
        className={`flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-1.5 ${row.group ? "pl-16" : "pl-12"} ${
          row.kind === "module" ? "bg-[var(--surface-sunken)]/50" : ""
        }`}
      >
        <TriCheckbox
          state={ts}
          disabled={readOnly}
          onChange={(on) => onSet(leaves, on)}
          label={`All actions of ${row.label}`}
        />
        <div className="min-w-[10rem] flex-1">
          <p className={`text-[13px] ${row.kind === "module" ? "font-semibold italic" : "font-medium"}`}>
            {row.label}
            {row.classScoped ? (
              <span className="ml-1 text-[10px] font-normal text-[var(--muted)]">(own classes)</span>
            ) : null}
          </p>
          {row.kind === "feature" ? (
            <p className="text-[11px] leading-snug text-[var(--muted)]">{row.blurb}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {leaves.map((leaf) => {
            const v = view(leaf);
            return (
              <label
                key={leafKey(leaf)}
                title={v.title}
                className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] ${
                  v.source === "deny"
                    ? "border-[var(--danger)] text-[var(--danger)] line-through"
                    : v.source === "personal"
                      ? "border-[var(--success)] text-[var(--success)]"
                      : v.on
                        ? "border-[var(--border)] text-[var(--foreground)]"
                        : "border-[var(--border)] text-[var(--muted)]"
                } ${readOnly || v.disabled ? "opacity-80" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  className="size-3.5"
                  checked={v.on}
                  disabled={readOnly || v.disabled}
                  onChange={(e) => onSetOne(leaf, e.target.checked)}
                  aria-label={`${row.label} ${actionLabel(leaf.action)}`}
                />
                {actionLabel(leaf.action)}
                {v.source === "role" || v.source === "module" ? <Lock className="size-3 text-[var(--muted)]" aria-hidden /> : null}
                {v.source === "personal" ? <Plus className="size-3" aria-hidden /> : null}
                {v.source === "deny" ? <Ban className="size-3" aria-hidden /> : null}
              </label>
            );
          })}
        </div>
      </div>
    </>
  );
}

function TriCheckbox({
  state,
  disabled,
  onChange,
  label,
}: {
  state: TriState;
  disabled: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "mixed";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="size-4 shrink-0"
      checked={state === "on"}
      disabled={disabled}
      // Mixed → tick everything; on → clear; off → tick.
      onChange={() => onChange(state !== "on")}
      aria-label={label}
      aria-checked={state === "mixed" ? "mixed" : state === "on"}
    />
  );
}

function ExpandButton({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded p-0.5 text-[var(--muted)] hover:bg-[var(--surface-sunken)]"
      aria-expanded={open}
      aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
    >
      {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
    </button>
  );
}

export function TreeButton({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        primary
          ? "rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          : "rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm disabled:opacity-50"
      }
    >
      {children}
    </button>
  );
}
