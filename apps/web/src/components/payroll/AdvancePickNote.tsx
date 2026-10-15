"use client";

/**
 * The "Advance outstanding" figure on a payroll line, opened as a small
 * sticky note: that person's advances still owed, oldest first, each with a
 * tick box (director, 14 Oct 2026). Ticking fills the line's advance
 * deduction with the ticked balances; the deduction can then be lowered but
 * never raised above them, and on publish the recovery is booked against
 * exactly the ticked advances, oldest first (lib/payrollAdvancePick).
 *
 * Base UI popover: Escape and an outside click close it, focus moves into it
 * and back to the figure, and it is portalled so the table's own scrolling
 * does not clip it. On a phone it fits the screen width.
 */

import { Popover } from "@base-ui/react/popover";
import { useState } from "react";

import { formatInr } from "@/lib/payroll";
import { pickedAdvanceTotal, type AdvancePickRow } from "@/lib/payrollAdvancePick";
import { advancePickRowsForStaff } from "@/lib/staffAdvance";

function givenOn(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "date not recorded";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function AdvancePickNote({
  staffId,
  staffName,
  runId,
  lockedDue,
  editable,
  picks,
  onPick,
}: {
  staffId: string;
  staffName: string;
  runId: string;
  /** The locked total shown on the line. */
  lockedDue: number;
  /** Draft and allowed to edit: tick boxes work. */
  editable: boolean;
  /** Advance ids ticked on the line now. */
  picks: string[];
  onPick: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  // Read from the register each time the note opens. Ticking changes no
  // balance (recoveries are booked on publish), so the rows stay right
  // while it is open.
  const [rows, setRows] = useState<AdvancePickRow[]>([]);
  const ticked = new Set(picks);
  const total = pickedAdvanceTotal(rows, picks);
  const titleId = `adv-note-title-${staffId}`;

  const toggle = (id: string, on: boolean) => {
    const next = new Set(picks);
    if (on) next.add(id);
    else next.delete(id);
    // Oldest first, as the rows read.
    onPick(rows.filter((r) => next.has(r.advanceId)).map((r) => r.advanceId));
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          // A posted run shows the advances as they stood before its own
          // recovery, so its ticks still read against a balance.
          setRows(advancePickRowsForStaff(staffId, editable ? {} : { excludeRunId: runId }));
        }
        setOpen(next);
      }}
    >
      <Popover.Trigger
        aria-label={`Advance outstanding for ${staffName}: ${formatInr(lockedDue)}. Show the advances${editable ? " and choose which to recover" : ""}.`}
        className="mt-0.5 flex w-full items-center justify-between gap-2 rounded border border-[var(--border)] bg-[var(--surface-sunken)] px-2 py-1.5 text-left text-xs font-semibold text-[var(--brand-deep)] hover:border-[var(--brand-deep)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-deep)] data-popup-open:border-[var(--brand-deep)]"
      >
        <span>{formatInr(lockedDue)}</span>
        <span aria-hidden className="text-[10px] font-normal text-[var(--muted)]">
          {picks.length ? `${picks.length} ticked ▾` : "▾"}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={12} className="isolate z-50">
          <Popover.Popup
            aria-labelledby={titleId}
            className="w-[min(24rem,calc(100vw-24px))] rounded-xl border border-[var(--warning)]/40 bg-[var(--warning-soft)] p-3 text-[var(--foreground)] shadow-[var(--shadow-2,0_12px_32px_rgba(0,0,0,0.18))] outline-none"
          >
            <div className="flex items-start justify-between gap-2">
              <Popover.Title id={titleId} className="text-xs font-bold text-[var(--brand-deep)]">
                Advances owed — {staffName}
              </Popover.Title>
              <Popover.Close
                aria-label="Close"
                className="-mr-1 -mt-1 rounded px-1.5 py-0.5 text-sm leading-none text-[var(--muted)] hover:bg-[var(--card)]"
              >
                ×
              </Popover.Close>
            </div>
            <Popover.Description className="mt-0.5 text-[10px] text-[var(--muted)]">
              {editable
                ? "Oldest first. Tick the advances this month's salary recovers — the deduction fills in with their balance; you can lower it, never raise it above them."
                : "Oldest first, as they stood before this run's recovery. Recall the run to draft to change the ticks."}
            </Popover.Description>
            {rows.length === 0 ? (
              <p className="mt-2 rounded-lg bg-[var(--card)] px-2 py-2 text-[11px] text-[var(--muted)]">
                No advance is outstanding for {staffName}.
              </p>
            ) : (
              <ul className="mt-2 max-h-[50vh] space-y-1.5 overflow-y-auto">
                {rows.map((r) => {
                  const on = ticked.has(r.advanceId);
                  const boxId = `adv-pick-${staffId}-${r.advanceId}`;
                  return (
                    <li key={r.advanceId}>
                      <label
                        htmlFor={boxId}
                        className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2 py-1.5 text-[11px] ${on ? "border-[var(--brand-deep)] bg-[var(--card)]" : "border-transparent bg-[var(--card)]/60"} ${editable ? "" : "cursor-default"}`}
                      >
                        <input
                          id={boxId}
                          type="checkbox"
                          className="mt-0.5 size-4 shrink-0"
                          checked={on}
                          disabled={!editable}
                          onChange={(e) => toggle(r.advanceId, e.target.checked)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                            <span className="font-semibold text-[var(--brand-deep)]">
                              #{r.serial} · {givenOn(r.givenDate)}
                            </span>
                            <span className="font-bold text-[var(--brand-deep)]">
                              {formatInr(r.balance)} due
                            </span>
                          </span>
                          <span className="block text-[10px] text-[var(--muted)]">
                            Given {formatInr(r.amount)} · recovered {formatInr(r.recovered)}
                            {r.note ? ` · ${r.note}` : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {rows.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--warning)]/30 pt-2 text-[11px]">
                <span className="font-semibold text-[var(--brand-deep)]" aria-live="polite">
                  Ticked: {formatInr(total)}
                </span>
                {editable ? (
                  <span className="flex gap-1.5">
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 font-semibold"
                      onClick={() => onPick(rows.map((r) => r.advanceId))}
                    >
                      Tick all
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 font-semibold"
                      disabled={picks.length === 0}
                      onClick={() => onPick([])}
                    >
                      Clear
                    </button>
                    <Popover.Close className="rounded-lg bg-[var(--primary)] px-2 py-1 font-semibold text-[var(--primary-foreground)]">
                      Done
                    </Popover.Close>
                  </span>
                ) : null}
              </div>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
