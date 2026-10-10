"use client";

/**
 * The top of one lead's own page, CRM-style: back to the list, "12 of 860"
 * with previous / next through the list as it was filtered and sorted, the
 * stage path the lead travels (Open → Registered → Verified → Admitted, or
 * Lost), and the two things a counsellor does most — call and WhatsApp.
 *
 * It sits above LeadDetail, which keeps every field and action it had. The
 * lead used to open BELOW a 900-row table, off screen, so "Open" looked like
 * it did nothing (director, 5 Oct 2026); now the lead replaces the list.
 */

import { ArrowLeft, ChevronLeft, ChevronRight, MessageCircle, Phone } from "lucide-react";
import type { AdmissionLead, AdmissionStage } from "@/lib/admissions";

const PATH: { stage: AdmissionStage; label: string }[] = [
  { stage: "enquiry", label: "Open" },
  { stage: "applied", label: "Registered" },
  { stage: "verified", label: "Verified" },
  { stage: "enrolled", label: "Admitted" },
];

function initials(name: string): string {
  const parts = name.replace(/[^A-Za-zऀ-ॿ ]/g, " ").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function LeadRecordBar(props: {
  lead: AdmissionLead;
  classLabel: string;
  /** 0-based position in the list the lead was opened from; -1 = not in it. */
  index: number;
  total: number;
  readOnly: boolean;
  canAct: boolean;
  onBack: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onCall: () => void;
  onWhatsApp: () => void;
}) {
  const { lead } = props;
  const reached = PATH.findIndex((p) => p.stage === lead.stage);
  const lost = lead.stage === "lost";
  const next = (lead.nextFollowUpAt || "").slice(0, 10);

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-1)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2">
        <button
          type="button"
          onClick={props.onBack}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-[var(--brand-deep)] hover:bg-[var(--card)]"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> All leads
        </button>
        <div className="flex items-center gap-1 text-xs text-[var(--muted)]">
          {props.index >= 0 ? (
            <span className="tabular-nums">
              {props.index + 1} of {props.total}
            </span>
          ) : (
            <span>Not in the current list view</span>
          )}
          <button
            type="button"
            aria-label="Previous lead"
            disabled={!props.onPrev}
            onClick={() => props.onPrev?.()}
            className="rounded-md border border-[var(--border)] bg-[var(--card)] p-1 disabled:opacity-40"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Next lead"
            disabled={!props.onNext}
            onClick={() => props.onNext?.()}
            className="rounded-md border border-[var(--border)] bg-[var(--card)] p-1 disabled:opacity-40"
          >
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--brand-deep)] text-sm font-bold text-white">
          {initials(lead.childName || lead.guardianName || "")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-bold text-[var(--brand-deep)]">{lead.childName || "—"}</div>
          <div className="truncate text-xs text-[var(--muted)]">
            {lead.guardianName || "—"}
            {lead.mobile ? ` · ${lead.mobile}` : ""}
            {props.classLabel ? ` · Class ${props.classLabel}` : ""}
            {lead.locality ? ` · ${lead.locality}` : ""}
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--muted)]">
            Owner <b className="text-[var(--brand-deep)]">{lead.assignedTo || "Unassigned"}</b>
            {" · "}Next follow-up <b className="text-[var(--brand-deep)]">{next || "not set"}</b>
          </div>
        </div>
        {props.canAct && lead.mobile ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={props.onCall}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
            >
              <Phone className="size-3.5" aria-hidden /> Call
            </button>
            <button
              type="button"
              onClick={props.onWhatsApp}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--success)] hover:bg-[var(--surface-sunken)]"
            >
              <MessageCircle className="size-3.5" aria-hidden /> WhatsApp
            </button>
          </div>
        ) : null}
      </div>

      {/* Stage path — where this family is, and what comes next. */}
      <ol className="flex border-t border-[var(--border)] text-[11px] font-semibold" aria-label="Lead stage">
        {PATH.map((p, i) => {
          const done = !lost && i < reached;
          const current = !lost && i === reached;
          return (
            <li
              key={p.stage}
              aria-current={current ? "step" : undefined}
              className={`flex-1 truncate px-2 py-2 text-center ${
                current
                  ? "bg-[var(--brand-deep)] text-white"
                  : done
                    ? "bg-[var(--success-soft)] text-[var(--success)]"
                    : "text-[var(--muted)]"
              } ${i > 0 ? "border-l border-[var(--border)]" : ""}`}
            >
              {done ? "✓ " : ""}
              {p.label}
            </li>
          );
        })}
        {lost ? (
          <li aria-current="step" className="flex-1 border-l border-[var(--border)] bg-[var(--danger-soft)] px-2 py-2 text-center text-[var(--danger)]">
            Lost
          </li>
        ) : null}
      </ol>
      {props.readOnly ? (
        <p className="border-t border-[var(--border)] bg-[var(--success-soft)] px-4 py-1.5 text-[11px] font-semibold text-[var(--success)]">
          Admitted — this lead is read-only. The child is now worked from Students.
        </p>
      ) : null}
    </div>
  );
}
