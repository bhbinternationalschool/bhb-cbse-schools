"use client";

/**
 * A single-select <select> replacement you can type into.
 *
 * Director, 14 Oct 2026: "build in search heads, staff in advance by alphabet
 * or make easier to pick name". Type any part of a name, code or designation
 * (every word must match), the list reads A→Z, and the last few picks made in
 * this browser sit on top under "Recent". ↑/↓ move, Enter picks, Escape puts
 * the field back as it was. Rows can be indented (a sub-head under its head)
 * and grouped under headings; a row marked `disabled` is shown — a head whose
 * sub-heads are the real choices — but cannot be picked.
 *
 * The value is the same id the old <select> carried (staff id, account code),
 * so callers swap the element and keep their state and handlers.
 * Filtering lives in lib/pickerSearch.ts (selftested).
 */

import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import {
  filterPickItems,
  pushRecentPick,
  readRecentPicks,
  type PickItem,
} from "@/lib/pickerSearch";

export type SearchPickProps = {
  items: PickItem[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /** Remember picks in this browser under this key and offer them first. */
  recentKey?: string;
  disabled?: boolean;
  /**
   * Builds the rows for a query instead of the flat A→Z filter — e.g.
   * groupAccountsForPicker for a head / sub-head tree. `items` is then used
   * only to show the chosen value.
   */
  rowsFor?: (query: string, recentIds: string[]) => PickItem[];
  /** Offer a "clear" (×) that sets the value to "" — e.g. "All staff". */
  clearable?: boolean;
  /** What the closed field shows for the chosen row (default: its label). */
  display?: (item: PickItem) => string;
  className?: string;
  inputClassName?: string;
  "aria-label"?: string;
  id?: string;
};

const INPUT_DEFAULT =
  "w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--card)] py-2 pl-3 pr-14 text-sm text-[var(--foreground)] outline-none focus:border-[var(--brand-gold)] focus:ring-2 focus:ring-[rgba(197,160,40,0.35)] disabled:cursor-not-allowed disabled:opacity-60";

export function SearchPick({
  items,
  value,
  onChange,
  placeholder = "Type to search…",
  recentKey,
  disabled,
  rowsFor,
  clearable,
  display,
  className = "",
  inputClassName = INPUT_DEFAULT,
  "aria-label": ariaLabel,
  id,
}: SearchPickProps) {
  const autoId = useId();
  const baseId = id ?? `sp-${autoId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  // Read lazily: the list is only rendered once open, so a server render and
  // the first client render agree whatever this browser stored.
  const [recent, setRecent] = useState<string[]>(() => (recentKey ? readRecentPicks(recentKey) : []));

  const rows = useMemo(
    () => (open ? (rowsFor ? rowsFor(query, recent) : filterPickItems(items, query, recent)) : []),
    [open, rowsFor, items, query, recent],
  );
  // A heading goes above the first row of each group; aria-activedescendant
  // points only at real options, never at a heading.
  const headings = useMemo(
    () => rows.map((r, i) => (r.group !== undefined && r.group !== rows[i - 1]?.group ? r.group : null)),
    [rows],
  );
  const chosen = useMemo(() => items.find((it) => it.id === value), [items, value]);
  const closedText = chosen ? (display ? display(chosen) : chosen.label) : value;

  const firstPickable = (list: PickItem[], from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < list.length; i += step) if (!list[i]!.disabled) return i;
    return -1;
  };

  function openList(q = "") {
    if (disabled) return;
    setOpen(true);
    setQuery(q);
    setActive(-1);
  }

  function close() {
    setOpen(false);
    setQuery("");
    setActive(-1);
  }

  function pick(item: PickItem) {
    if (item.disabled) return;
    if (recentKey) setRecent(pushRecentPick(recentKey, item.id));
    onChange(item.id);
    close();
  }

  function scrollIntoView(i: number) {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${i}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }

  function move(step: 1 | -1) {
    if (rows.length === 0) return;
    let next = firstPickable(rows, active + step, step);
    if (next === -1) next = active === -1 ? firstPickable(rows, step === 1 ? 0 : rows.length - 1, step) : active;
    setActive(next);
    if (next >= 0) scrollIntoView(next);
  }

  return (
    <div className={`relative min-w-0 ${className}`}>
      <input
        ref={inputRef}
        id={baseId}
        type="text"
        className={inputClassName}
        value={open ? query : closedText}
        placeholder={open && closedText ? closedText : placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${baseId}-opt-${active}` : undefined}
        onFocus={() => openList()}
        onClick={() => {
          if (!open) openList();
        }}
        onBlur={close}
        onChange={(e) => {
          if (!open) setOpen(true);
          setQuery(e.target.value);
          // Typing narrows the list; the best match is ready for Enter.
          const q = e.target.value;
          const next = rowsFor ? rowsFor(q, recent) : filterPickItems(items, q, recent);
          setActive(q.trim() ? firstPickable(next, 0, 1) : -1);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) openList();
            else move(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (open) move(-1);
          } else if (e.key === "Enter") {
            if (open && active >= 0 && rows[active]) {
              e.preventDefault();
              pick(rows[active]!);
            }
          } else if (e.key === "Escape") {
            if (open) {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          } else if (e.key === "Tab") {
            close();
          }
        }}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[var(--muted)]">
        {clearable && value && !disabled ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Clear"
            className="pointer-events-auto rounded p-0.5 hover:bg-[var(--surface-2)] hover:text-[var(--brand-deep)]"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange("");
              close();
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
        <ChevronDown className="h-4 w-4" aria-hidden />
      </span>
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-y-auto overflow-x-hidden rounded-xl border border-[var(--border)] bg-[var(--popover)] py-1 text-[var(--popover-foreground)] shadow-lg"
          // Keep focus in the input so a click picks before blur closes.
          onMouseDown={(e) => e.preventDefault()}
          // Inside a <label> a click would otherwise be forwarded to the
          // input and reopen the list that was just closed by the pick.
          onClick={(e) => e.preventDefault()}
        >
          {rows.length === 0 ? (
            <li role="presentation" className="px-3 py-2 text-xs text-[var(--muted)]">
              {query.trim() ? `No match for “${query.trim()}”` : "Nothing to choose"}
            </li>
          ) : null}
          {rows.map((row, i) => {
            const heading = headings[i];
            const isActive = i === active;
            const isChosen = row.id === value && !row.disabled;
            return (
              <li key={`${row.group ?? ""}:${row.id}:${i}`} role="presentation">
                {heading ? (
                  <div
                    role="presentation"
                    className="px-3 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]"
                  >
                    {heading}
                  </div>
                ) : null}
                <div
                  id={`${baseId}-opt-${i}`}
                  data-row={i}
                  role="option"
                  aria-selected={isChosen}
                  aria-disabled={row.disabled || undefined}
                  className={`min-w-0 py-1.5 pr-3 text-sm ${
                    row.disabled
                      ? "cursor-default font-semibold text-[var(--muted)]"
                      : `cursor-pointer text-[var(--brand-deep)] ${
                          isActive ? "bg-[rgba(197,160,40,0.16)]" : "hover:bg-[var(--surface-2)]"
                        }`
                  } ${isChosen ? "font-semibold" : ""}`}
                  style={{ paddingLeft: `${0.75 + Math.min(row.depth ?? 0, 3) * 1}rem` }}
                  onMouseEnter={() => {
                    if (!row.disabled) setActive(i);
                  }}
                  onClick={() => pick(row)}
                >
                  <span className="block break-words">{row.label}</span>
                  {row.sub ? (
                    <span className="block break-words text-[11px] font-normal text-[var(--muted)]">{row.sub}</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
