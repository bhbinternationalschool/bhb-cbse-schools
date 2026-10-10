"use client";

/**
 * "What do I do next" — the first thing on the CRM, before the table.
 *
 * The table is a reference; this is the instruction. It names the single
 * action each group of leads needs, puts the button that does it on the row,
 * and caps the never-contacted pile at a day's calling so the desk sees work
 * it can finish rather than a backlog it cannot.
 */

import { useMemo } from "react";
import { Phone, ArrowRight, ExternalLink } from "lucide-react";
import {
  bucketTotal,
  buildLeadWorklist,
  type LeadLike,
  type WorkKind,
} from "@/lib/leadWorklist";

const TONE: Record<WorkKind, { bar: string; chip: string }> = {
  admit:      { bar: "var(--success)",     chip: "bg-[var(--success-soft)] text-[var(--success)]" },
  register:   { bar: "var(--brand-deep)",  chip: "bg-[var(--brand-deep)]/10 text-[var(--brand-deep)]" },
  documents:  { bar: "var(--warning)",     chip: "bg-[var(--warning-soft)] text-[var(--warning)]" },
  callback:   { bar: "var(--danger)",      chip: "bg-[var(--danger-soft)] text-[var(--danger)]" },
  first_call: { bar: "var(--muted)",       chip: "bg-[var(--surface-sunken)] text-[var(--muted)]" },
};

export function LeadWorklistPanel({
  leads,
  today,
  onOpenLead,
  onCall,
  dailyCallTarget = 15,
}: {
  leads: LeadLike[];
  today: string;
  onOpenLead: (id: string) => void;
  onCall: (id: string) => void;
  dailyCallTarget?: number;
}) {
  const work = useMemo(
    () => buildLeadWorklist({ leads, today, dailyCallTarget }),
    [leads, today, dailyCallTarget],
  );

  if (work.buckets.length === 0) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
        <p className="text-sm font-bold text-[var(--brand-deep)]">Nothing waiting</p>
        <p className="mt-1 text-[12px] text-[var(--muted)]">
          Every open lead has been dealt with. New enquiries appear here as they
          arrive.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          What needs you
        </h3>
        <p className="text-[11px] text-[var(--muted)]">
          {work.openCount} open ·{" "}
          {work.contactedCount === 0
            ? "none contacted yet"
            : `${work.contactedCount} contacted`}
        </p>
      </div>

      <div className="mt-3 space-y-3">
        {work.buckets.map((b) => {
          const total = bucketTotal(leads, b.kind, today);
          const tone = TONE[b.kind];
          return (
            <div
              key={b.kind}
              className="rounded-xl border border-[var(--border)] pl-3"
              style={{ borderLeft: `3px solid ${tone.bar}` }}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-2 pt-2">
                <span className="text-[12px] font-bold text-[var(--brand-deep)]">
                  {b.label}
                </span>
                <span className={`rounded px-1.5 text-[11px] font-bold ${tone.chip}`}>
                  {total}
                </span>
                {b.leads.length < total ? (
                  <span className="text-[10px] text-[var(--muted)]">
                    showing today&rsquo;s {b.leads.length}
                  </span>
                ) : null}
                <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  {b.action}
                </span>
              </div>
              <p className="px-2 pb-1.5 text-[11px] text-[var(--muted)]">{b.why}</p>

              <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
                {b.leads.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center gap-2 px-2 py-1.5"
                  >
                    <span className="min-w-[9rem] flex-1 text-[12px] font-medium text-[var(--brand-deep)]">
                      {l.childName || "(unnamed child)"}
                      <span className="ml-1.5 font-normal text-[var(--muted)]">
                        {l.guardianName || "—"}
                      </span>
                    </span>
                    <span className="font-mono text-[10px] text-[var(--muted)]">
                      {l.leadDate || ""}
                    </span>
                    {l.mobile ? (
                      <button
                        type="button"
                        onClick={() => onCall(l.id)}
                        className="flex items-center gap-1 rounded-lg bg-[var(--success)] px-2 py-1 text-[11px] font-bold text-white"
                      >
                        <Phone className="size-3" aria-hidden /> Call
                      </button>
                    ) : (
                      <span className="rounded-lg bg-[var(--warning-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--warning)]">
                        no number
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenLead(l.id)}
                      className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--brand-deep)]"
                    >
                      Open <ExternalLink className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {work.contactedCount === 0 && work.openCount > 50 ? (
        <p className="mt-3 rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-[11px] text-[var(--muted)]">
          None of these {work.openCount} leads has ever been called. Most are
          door-to-door survey records imported in bulk, which is why they all
          show as overdue — that date came from the import, not from a promise
          anyone made. Working fifteen a day clears the list in{" "}
          <strong>{Math.ceil(work.openCount / 15)}</strong> days.
        </p>
      ) : null}
    </section>
  );
}
