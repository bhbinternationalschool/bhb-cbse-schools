"use client";

/**
 * Meeting minutes mode of the Document maker: paste or dictate notes →
 * structured draft (agenda · discussion · decisions · action items with
 * owner / due as stated · next meeting) → edit → hand to the letterhead
 * preview / PDF as a document. Copy action items for WhatsApp / duty lists.
 */

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { VoiceDictateButton } from "@/components/teaching/VoiceDictateButton";
import { minutesToBody, type MeetingMinutesDraft, type MinutesLanguage } from "@/lib/meetingMinutesAi";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";

export function MeetingMinutesPanel(props: {
  canCreate: boolean;
  language: MinutesLanguage;
  onDocument: (doc: { titleEn: string; titleHi: string; bodyEn: string; bodyHi: string; subject: string }) => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [attendees, setAttendees] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<(MeetingMinutesDraft & { model: string; generationId: string }) | null>(null);

  function pushDocument(m: MeetingMinutesDraft) {
    props.onDocument({
      titleEn: m.title || title || "Minutes of meeting",
      titleHi: props.language !== "en" ? "बैठक का कार्यवृत्त" : "",
      bodyEn: minutesToBody(m),
      bodyHi: m.summaryHi,
      subject: `Minutes — ${m.title || title || "meeting"}${m.date ? ` · ${m.date}` : ""}`,
    });
  }

  async function generate() {
    if (!props.canCreate || busy) return;
    setBusy(true);
    props.onError(null);
    try {
      const res = await fetch("/api/ai/meeting-minutes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, date, attendees, notes, language: props.language }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        draft?: MeetingMinutesDraft;
        model?: string;
        generationId?: string;
      };
      if (!res.ok || !json.ok || !json.draft) {
        props.onError(json.error || "Minutes failed");
        return;
      }
      const d = { ...json.draft, model: json.model || "", generationId: json.generationId || "" };
      setDraft(d);
      pushDocument(d);
      props.onNotice(`Minutes drafted${json.model ? ` · ${json.model}` : ""} — edit below, then print`);
    } catch (e) {
      props.onError(e instanceof Error ? e.message : "Minutes failed");
    } finally {
      setBusy(false);
    }
  }

  function patch(p: Partial<MeetingMinutesDraft>) {
    if (!draft) return;
    const next = { ...draft, ...p };
    setDraft(next);
    pushDocument(next);
  }

  async function copyActions() {
    if (!draft) return;
    const text = draft.actionItems
      .map((a, i) => `${i + 1}. ${a.task}${a.owner ? ` — ${a.owner}` : ""}${a.due ? ` (${a.due})` : ""}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      props.onNotice("Action items copied");
      if (draft.generationId) {
        reportAiOutcome({ ids: [draft.generationId], outcome: "accepted", targetType: "meeting_minutes" });
        setDraft({ ...draft, generationId: "" });
      }
    } catch {
      props.onError("Could not copy — select the text and copy manually");
    }
  }

  const listEditor = (label: string, key: "agenda" | "discussion" | "decisions") => (
    <label className="block text-sm">
      <span className="mb-1 block text-[11px] text-[var(--muted)]">{label} · one per line</span>
      <textarea
        className="field min-h-[72px] !py-1.5 text-sm"
        value={(draft?.[key] ?? []).join("\n")}
        onChange={(e) => patch({ [key]: e.target.value.split("\n") } as Partial<MeetingMinutesDraft>)}
        onBlur={(e) => patch({ [key]: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) } as Partial<MeetingMinutesDraft>)}
      />
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Meeting</span>
          <input className="field !py-1.5" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Staff meeting · exam planning" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Date</span>
          <input className="field !py-1.5" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-[11px] text-[var(--muted)]">Attendees (optional)</span>
        <input className="field !py-1.5" value={attendees} onChange={(e) => setAttendees(e.target.value)} placeholder="Principal, Vice-principal, class teachers VI–VIII…" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 flex items-center gap-2 text-[11px] text-[var(--muted)]">
          Notes / transcript
          <VoiceDictateButton title="Dictate notes" onText={(t) => setNotes((v) => (v.trim() ? `${v.trim()} ${t}` : t))} />
        </span>
        <textarea
          className="field min-h-[160px] !py-2 text-sm"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Paste rough notes or a transcript. Owners and dates are copied only when the notes say them — nothing is invented."
        />
      </label>
      <button
        type="button"
        disabled={busy || !props.canCreate || notes.trim().length < 20}
        onClick={() => void generate()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
      >
        <Sparkles className="h-4 w-4" />
        {busy ? "Drafting…" : draft ? "Re-draft minutes" : "Draft minutes"}
      </button>

      {draft ? (
        <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
            Draft · edit here, preview updates{draft.model ? ` · ${draft.model}` : ""}
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Title</span>
            <input className="field !py-1.5" value={draft.title} onChange={(e) => patch({ title: e.target.value })} />
          </label>
          {listEditor("Agenda", "agenda")}
          {listEditor("Discussion", "discussion")}
          {listEditor("Decisions", "decisions")}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] text-[var(--muted)]">Action items · owner and due only if the notes said so</span>
              <button type="button" className="text-[11px] font-semibold text-[var(--brand-deep)] underline" onClick={() => void copyActions()}>
                Copy list
              </button>
            </div>
            <div className="space-y-1">
              {draft.actionItems.map((a, i) => (
                <div key={i} className="grid gap-1 sm:grid-cols-[1fr_160px_140px_auto]">
                  <input className="field !py-1 text-xs" value={a.task} onChange={(e) => patch({ actionItems: draft.actionItems.map((x, j) => (j === i ? { ...x, task: e.target.value } : x)) })} />
                  <input className="field !py-1 text-xs" placeholder="Owner" value={a.owner} onChange={(e) => patch({ actionItems: draft.actionItems.map((x, j) => (j === i ? { ...x, owner: e.target.value } : x)) })} />
                  <input className="field !py-1 text-xs" placeholder="Due" value={a.due} onChange={(e) => patch({ actionItems: draft.actionItems.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)) })} />
                  <button type="button" className="text-xs text-[var(--danger)]" onClick={() => patch({ actionItems: draft.actionItems.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-[11px] font-semibold text-[var(--brand-deep)] underline"
                onClick={() => patch({ actionItems: [...draft.actionItems, { task: "", owner: "", due: "" }] })}
              >
                + action item
              </button>
            </div>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Next meeting</span>
            <input className="field !py-1.5" value={draft.nextMeeting} onChange={(e) => patch({ nextMeeting: e.target.value })} />
          </label>
        </div>
      ) : null}
    </div>
  );
}
