"use client";

/**
 * Leads as a board: one column per stage, a card per child, the same leads
 * (and the same filters) as the list view. A card opens the lead's page.
 *
 * Columns show the first 25 and grow on request — the Open column holds
 * ~850 survey records, and painting every one is the slow page this replaces.
 */

import { useState } from "react";
import {
  ADMISSION_STAGES,
  leadFollowUpBucket,
  stageTagClass,
  type AdmissionLead,
  type AdmissionStage,
} from "@/lib/admissions";

const STEP = 25;

export function LeadKanbanBoard(props: {
  leads: AdmissionLead[];
  classLabel: (lead: AdmissionLead) => string;
  onOpen: (id: string) => void;
}) {
  const [shown, setShown] = useState<Partial<Record<AdmissionStage, number>>>({});

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {ADMISSION_STAGES.map((s) => {
        const col = props.leads.filter((l) => l.stage === s.value);
        const limit = shown[s.value] ?? STEP;
        return (
          <section
            key={s.value}
            className="flex w-64 shrink-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface-sunken)]"
            aria-label={`${s.label} leads`}
          >
            <header className="flex items-center justify-between px-3 py-2">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${stageTagClass(s.value)}`}>{s.label}</span>
              <span className="text-xs font-semibold tabular-nums text-[var(--muted)]">{col.length}</span>
            </header>
            <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
              {col.length === 0 ? <p className="px-1 py-4 text-center text-[11px] text-[var(--muted)]">None</p> : null}
              {col.slice(0, limit).map((l) => {
                const bucket = leadFollowUpBucket(l);
                const next = (l.nextFollowUpAt || "").slice(0, 10);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => props.onOpen(l.id)}
                    className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-left shadow-[var(--shadow-1)] hover:border-[var(--brand-deep)]"
                  >
                    <div className="truncate text-[13px] font-semibold text-[var(--brand-deep)]">{l.childName || "—"}</div>
                    <div className="truncate text-[11px] text-[var(--muted)]">
                      {l.guardianName || "—"}
                      {l.mobile ? ` · ${l.mobile}` : ""}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-[var(--muted)]">
                      {props.classLabel(l) ? <span>Class {props.classLabel(l)}</span> : null}
                      <span className="font-mono">{l.enquiryNo}</span>
                      {bucket === "overdue" ? (
                        <span className="rounded bg-[var(--danger-soft)] px-1 font-semibold text-[var(--danger)]">Overdue {next}</span>
                      ) : bucket === "due_today" ? (
                        <span className="rounded bg-[var(--warning-soft)] px-1 font-semibold text-[var(--warning)]">Due today</span>
                      ) : next ? (
                        <span>Next {next}</span>
                      ) : null}
                    </div>
                    {l.assignedTo ? <div className="mt-0.5 truncate text-[10px] text-[var(--muted)]">Owner {l.assignedTo}</div> : null}
                  </button>
                );
              })}
              {col.length > limit ? (
                <button
                  type="button"
                  onClick={() => setShown((m) => ({ ...m, [s.value]: limit + STEP * 2 }))}
                  className="rounded-lg py-1.5 text-[11px] font-semibold text-[var(--brand-deep)] hover:bg-[var(--card)]"
                >
                  Show more ({col.length - limit} left)
                </button>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
