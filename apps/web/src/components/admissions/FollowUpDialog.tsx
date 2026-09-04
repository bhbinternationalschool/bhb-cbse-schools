"use client";

/**
 * The card a counsellor fills in WHILE the call is happening.
 *
 * It opens from the lead list rather than from inside the lead, because the
 * work is a run down a call list, not a study of one family: you ring, you
 * write what they said, you set the next date, you ring the next one. Making
 * someone open a lead, find the counsellor section and scroll to a form is
 * how call notes stop being written at all.
 *
 * Opening it with channel "call" also dials. The two belong together — a
 * dialogue box that appears after the phone is already ringing is a box
 * nobody fills in.
 */

import { useEffect, useRef, useState } from "react";
import { Phone, X } from "lucide-react";
import {
  FOLLOW_UP_CHANNELS,
  FOLLOW_UP_OUTCOMES,
  type FollowUpChannel,
  type FollowUpOutcome,
} from "@/lib/admissions";

const FIELD =
  "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--brand-deep)]";

export type FollowUpDraft = {
  channel: FollowUpChannel;
  outcome: FollowUpOutcome;
  note: string;
  nextFollowUpAt: string;
  assignToSelf: boolean;
};

export function FollowUpDialog({
  lead,
  channel,
  onSave,
  onClose,
}: {
  lead: {
    id: string;
    enquiryNo: string;
    childName: string;
    guardianName: string;
    mobile: string;
  };
  /** "call" also starts the call when the box opens. */
  channel: FollowUpChannel;
  onSave: (draft: FollowUpDraft) => void;
  onClose: () => void;
}) {
  const [outcome, setOutcome] = useState<FollowUpOutcome>(
    channel === "call" ? "connected" : "message_sent",
  );
  const [note, setNote] = useState("");
  const [nextAt, setNextAt] = useState("");
  const [assign, setAssign] = useState(true);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Cursor in the notes box on open: the counsellor is already speaking, and
  // the first thing they need is somewhere to type.
  useEffect(() => {
    noteRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dialled = useRef(false);
  useEffect(() => {
    // Dial once, and only for a call with a number to dial. Guarded with a
    // ref because React runs effects twice in development and nobody wants
    // the phone dialled twice.
    if (channel !== "call" || dialled.current || !lead.mobile) return;
    dialled.current = true;
    window.location.href = `tel:${lead.mobile}`;
  }, [channel, lead.mobile]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Log a follow-up"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mt-16 w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-[var(--brand-deep)]">
              {channel === "call" ? "On the call" : "Log a follow-up"}
            </p>
            <p className="text-[11px] text-[var(--muted)]">
              {lead.childName || "(unnamed child)"} · {lead.guardianName || "—"}{" "}
              · {lead.enquiryNo}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--surface-sunken)]"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {lead.mobile ? (
          <a
            href={`tel:${lead.mobile}`}
            className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-[var(--success)] px-3 py-2 text-sm font-bold text-white"
          >
            <Phone className="size-4" aria-hidden />
            {channel === "call" ? "Dial again" : "Call"} {lead.mobile}
          </a>
        ) : (
          <p className="mt-3 rounded-lg bg-[var(--warning-soft)] px-3 py-1.5 text-[11px] text-[var(--warning)]">
            This lead has no mobile number recorded — add one on the lead
            before calling.
          </p>
        )}

        <label className="mt-3 block text-[11px] font-bold text-[var(--muted)]">
          What happened
          <select
            className={FIELD}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as FollowUpOutcome)}
          >
            {FOLLOW_UP_OUTCOMES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-2 block text-[11px] font-bold text-[var(--muted)]">
          What they said
          <textarea
            ref={noteRef}
            rows={3}
            className={FIELD}
            value={note}
            placeholder="Parent asked about transport · will visit Saturday…"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <label className="mt-2 block text-[11px] font-bold text-[var(--muted)]">
          Call them again on
          <input
            type="date"
            className={FIELD}
            value={nextAt}
            onChange={(e) => setNextAt(e.target.value)}
          />
        </label>
        {/* Said plainly: a blank date is a lead that drops off the list. */}
        {!nextAt ? (
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Leave blank only if this lead needs no further call — it will stop
            appearing in the follow-up counts.
          </p>
        ) : null}

        <label className="mt-3 flex items-center gap-2 text-[11px] text-[var(--muted)]">
          <input
            type="checkbox"
            checked={assign}
            onChange={(e) => setAssign(e.target.checked)}
          />
          Make this lead mine
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-[11px] font-bold text-white"
            onClick={() =>
              onSave({
                channel,
                outcome,
                note: note.trim(),
                nextFollowUpAt: nextAt,
                assignToSelf: assign,
              })
            }
          >
            Save
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-[11px] font-semibold text-[var(--muted)]"
            onClick={onClose}
          >
            Cancel
          </button>
          <span className="self-center text-[10px] text-[var(--muted)]">
            {FOLLOW_UP_CHANNELS.find((c) => c.value === channel)?.label ??
              channel}
          </span>
        </div>
      </div>
    </div>
  );
}
