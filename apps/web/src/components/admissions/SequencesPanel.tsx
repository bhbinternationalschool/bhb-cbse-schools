"use client";

/**
 * WA campaigns → Sequences — multi-step nurture / event drips on an
 * audience list. A sequence is steps (day offset · time · body) anchored on
 * the start day or an event date; "Start" turns each step into a scheduled
 * campaign (messages queued for the list as it stands). Step bodies can be
 * drafted by the Marketing generator from the school's own achievements /
 * occasion facts; every body is editable before Start. Families who enrol,
 * are lost or say "not interested" are pruned from the queue before
 * dispatch; STOP is enforced at send time.
 */

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import type { AdmissionsState } from "@/lib/admissions";
import {
  CAMPAIGN_TEMPLATES,
  createSequence,
  defaultTemplateBody,
  deleteSequence,
  SEQUENCE_PRESETS,
  sequenceStepWhen,
  startSequence,
  stopSequence,
  updateSequence,
  type CampaignTemplateKey,
  type WaCampaignsState,
  type WaSequence,
  type WaSequenceStep,
} from "@/lib/waCampaigns";
import { achievementsToFactLines, loadSchoolAchievements } from "@/lib/schoolAchievements";
import { MastersTableCard, MastersWorkCard } from "@/components/masters/MastersLayout";

const inp = "w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-2 py-1.5 text-[12px]";

type StepDraft = Omit<WaSequenceStep, "id"> & { id: string };

function nid() {
  return `seq_step_${Math.random().toString(36).slice(2, 8)}`;
}

export function SequencesPanel(props: {
  wa: WaCampaignsState;
  admissions: AdmissionsState;
  by: string;
  canEdit: boolean;
  commitWa: (next: WaCampaignsState, msg?: string) => void;
  onAdmissionsCommit: (next: AdmissionsState, msg?: string) => void;
  onError: (msg: string) => void;
}) {
  const { wa, admissions, canEdit } = props;
  const [name, setName] = useState("");
  const [listId, setListId] = useState("");
  const [anchor, setAnchor] = useState<"start" | "event">("start");
  const [eventDate, setEventDate] = useState("");
  const [occasion, setOccasion] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [busyStep, setBusyStep] = useState<string | null>(null);

  const lists = wa.lists;
  const anchorYmd = anchor === "event" ? eventDate : new Date().toISOString().slice(0, 10);

  function applyPreset(id: string) {
    const p = SEQUENCE_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setAnchor(p.anchor);
    setName((n) => n || p.label);
    setSteps(p.steps.map((s) => ({ ...s, id: nid(), body: s.templateKey === "custom" ? "" : defaultTemplateBody(s.templateKey) })));
  }
  function patchStep(id: string, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function addStep() {
    const last = steps[steps.length - 1];
    setSteps((prev) => [...prev, { id: nid(), dayOffset: last ? last.dayOffset + 3 : 0, time: "11:00", label: "", templateKey: "custom", body: "" }]);
  }

  /** Draft one step's body from the school's facts via the marketing generator. */
  async function draftStep(s: StepDraft) {
    if (busyStep) return;
    setBusyStep(s.id);
    try {
      const ach = loadSchoolAchievements();
      const pub = ach.achievements.filter((a) => a.publicSafe);
      const kind = /greet/i.test(name) || /greet/i.test(s.label) ? "greeting" : anchor === "event" ? "event_invite" : "wa_broadcast";
      const res = await fetch("/api/ai/marketing-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          audiences: [{ language, register: "warm" }],
          facts: {
            achievementLines: achievementsToFactLines(pub).slice(0, 6),
            usps: ach.positioning.ours.split("\n").map((l) => l.trim()).filter(Boolean),
            brandLines: ach.positioning.brandLines.split("\n").map((l) => l.trim()).filter(Boolean),
            competitorNames: ach.positioning.competitorNames.split(/[,\n]/).map((l) => l.trim()).filter(Boolean),
            occasion: [occasion, anchor === "event" && eventDate ? `Date: ${eventDate}` : "", s.label ? `This message: ${s.label} (${s.dayOffset >= 0 ? "+" : ""}${s.dayOffset} days)` : ""].filter(Boolean).join(" · "),
            ctaUrl: "{{registerLink}}",
            note: `Step ${steps.indexOf(s) + 1} of ${steps.length} in the "${name || "nurture"}" sequence. Address the parent as {{guardianName}} and the child as {{childName}} (placeholders, keep them exactly).`,
          },
        }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; variants?: { text: string; flags: { ungroundedNumbers: string[]; forbiddenNames: string[] } }[] };
      if (!res.ok || !j.ok || !j.variants?.length) return props.onError(j.error || "Draft failed");
      const v = j.variants[0];
      if (v.flags.forbiddenNames.length) return props.onError(`Draft named a competitor (${v.flags.forbiddenNames.join(", ")}) — try again`);
      patchStep(s.id, { body: v.text + (v.flags.ungroundedNumbers.length ? `\n\n[check numbers: ${v.flags.ungroundedNumbers.join(", ")}]` : "") });
    } catch (e) {
      props.onError(e instanceof Error ? e.message : "Draft failed");
    } finally {
      setBusyStep(null);
    }
  }

  function save() {
    const r = createSequence(wa, { name, listId, anchor, eventDate, steps, note: occasion }, props.by);
    if (!r.ok) return props.onError(r.reason);
    props.commitWa(r.state, "Sequence saved (draft) — Start when the bodies are final");
    setName("");
    setSteps([]);
    setOccasion("");
  }
  function start(seq: WaSequence) {
    if (!window.confirm(`Start "${seq.name}"? ${seq.steps.length} campaign(s) will be scheduled for the list as it stands now.`)) return;
    const r = startSequence(wa, seq.id, admissions, props.by);
    if (!r.ok) return props.onError(r.reason);
    props.onAdmissionsCommit(r.admissions, "Pay links prepared");
    props.commitWa(r.wa, `Sequence started · ${r.campaigns} campaigns · ${r.queued} messages queued`);
  }

  const saved = useMemo(() => [...wa.sequences].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [wa.sequences]);
  const stepsFor = (seq: WaSequence) => wa.campaigns.filter((c) => c.sequenceId === seq.id).sort((a, b) => a.sequenceStep - b.sequenceStep);

  return (
    <div className="space-y-4">
      {canEdit ? (
        <MastersWorkCard title="New sequence">
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[11px] text-[var(--muted)]">Presets:</span>
            {SEQUENCE_PRESETS.map((p) => (
              <button key={p.id} type="button" className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px]" onClick={() => applyPreset(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-4">
            <label className="text-[11px] text-[var(--muted)] sm:col-span-2">
              Name
              <input className={`${inp} mt-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Open house · Aug 2026" />
            </label>
            <label className="text-[11px] text-[var(--muted)]">
              Audience list
              <select className={`${inp} mt-1`} value={listId} onChange={(e) => setListId(e.target.value)}>
                <option value="">Select</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {l.count}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-[var(--muted)]">
              Draft language
              <select className={`${inp} mt-1`} value={language} onChange={(e) => setLanguage(e.target.value as "en" | "hi")}>
                <option value="en">English</option>
                <option value="hi">हिंदी</option>
              </select>
            </label>
            <label className="text-[11px] text-[var(--muted)]">
              Anchor
              <select className={`${inp} mt-1`} value={anchor} onChange={(e) => setAnchor(e.target.value as "start" | "event")}>
                <option value="start">Day I press Start</option>
                <option value="event">An event date</option>
              </select>
            </label>
            {anchor === "event" ? (
              <label className="text-[11px] text-[var(--muted)]">
                Event date
                <input type="date" className={`${inp} mt-1`} value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
              </label>
            ) : null}
            <label className="text-[11px] text-[var(--muted)] sm:col-span-2">
              Occasion / event facts for the AI (what · when · where · RSVP)
              <input className={`${inp} mt-1`} maxLength={400} value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="Open House · Sat 24 Aug · 10 am · campus · RSVP on WhatsApp" />
            </label>
          </div>
          <div className="mt-3 space-y-2">
            {steps.map((s, i) => (
              <div key={s.id} className="rounded-lg border border-[var(--border)] p-2">
                <div className="grid gap-2 sm:grid-cols-6">
                  <span className="text-[11px] font-semibold">Step {i + 1}</span>
                  <label className="text-[11px] text-[var(--muted)]">
                    Day {anchor === "event" ? "(− before event)" : "(from start)"}
                    <input type="number" className={`${inp} mt-1`} value={s.dayOffset} onChange={(e) => patchStep(s.id, { dayOffset: Number(e.target.value) || 0 })} />
                  </label>
                  <label className="text-[11px] text-[var(--muted)]">
                    Time
                    <input type="time" className={`${inp} mt-1`} value={s.time} onChange={(e) => patchStep(s.id, { time: e.target.value })} />
                  </label>
                  <label className="text-[11px] text-[var(--muted)] sm:col-span-2">
                    Label / theme
                    <input className={`${inp} mt-1`} value={s.label} onChange={(e) => patchStep(s.id, { label: e.target.value })} placeholder="Welcome · A day at school · Visit" />
                  </label>
                  <label className="text-[11px] text-[var(--muted)]">
                    Template
                    <select className={`${inp} mt-1`} value={s.templateKey} onChange={(e) => patchStep(s.id, { templateKey: e.target.value as CampaignTemplateKey, body: s.body || defaultTemplateBody(e.target.value as CampaignTemplateKey) })}>
                      {CAMPAIGN_TEMPLATES.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <textarea className={`${inp} mt-2 min-h-[5rem]`} value={s.body} onChange={(e) => patchStep(s.id, { body: e.target.value })} placeholder="Message body — {{guardianName}}, {{childName}}, {{registerLink}}, {{schoolName}} are filled per family" />
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="text-[var(--muted)]">Sends {anchorYmd ? sequenceStepWhen(anchorYmd, s).replace("T", " ") : "(set event date)"}</span>
                  <button type="button" disabled={!!busyStep} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-0.5 font-semibold text-[var(--brand-deep)] disabled:opacity-50" onClick={() => void draftStep(s)}>
                    <Sparkles className="h-3 w-3" />
                    {busyStep === s.id ? "Drafting…" : "Draft with AI from school facts"}
                  </button>
                  <button type="button" className="text-[var(--danger)] underline" onClick={() => setSteps((p) => p.filter((x) => x.id !== s.id))}>
                    remove
                  </button>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold" onClick={addStep}>
                + Step
              </button>
              <button type="button" disabled={!steps.length || !listId || !name.trim()} className="rounded-lg bg-[var(--brand-deep)] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50" onClick={save}>
                Save sequence
              </button>
            </div>
          </div>
        </MastersWorkCard>
      ) : null}

      <MastersTableCard title="Sequences">
        {saved.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-[var(--muted)]">No sequences yet. Use a preset above — open house, enquiry nurture, result day, festival greeting.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {saved.map((seq) => {
              const camps = stepsFor(seq);
              const list = lists.find((l) => l.id === seq.listId);
              return (
                <li key={seq.id} className="px-4 py-3 text-[12px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[var(--brand-deep)]">{seq.name}</span>
                    <span className="rounded-full bg-[rgba(32,48,80,0.06)] px-2 py-0.5 text-[10px] font-semibold uppercase">{seq.status}</span>
                    <span className="text-[var(--muted)]">
                      {list ? `${list.name} · ${list.count}` : "list missing"} · {seq.steps.length} steps · {seq.anchor === "event" ? `event ${seq.eventDate}` : "from start"}
                    </span>
                    {canEdit ? (
                      <span className="ml-auto flex gap-2">
                        {seq.status !== "started" ? (
                          <button type="button" className="rounded-lg bg-[var(--brand-deep)] px-2.5 py-1 text-[11px] font-semibold text-white" onClick={() => start(seq)}>
                            Start
                          </button>
                        ) : (
                          <button type="button" className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold" onClick={() => props.commitWa(stopSequence(wa, seq.id), "Sequence stopped — queued steps skipped")}>
                            Stop
                          </button>
                        )}
                        {seq.status !== "started" ? (
                          <button type="button" className="text-[var(--danger)] underline" onClick={() => { if (window.confirm("Delete this sequence?")) props.commitWa(deleteSequence(wa, seq.id), "Sequence deleted"); }}>
                            delete
                          </button>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--muted)]">
                    {seq.steps.map((s, i) => {
                      const c = camps.find((x) => x.sequenceStep === i + 1);
                      const msgs = c ? wa.messages.filter((m) => m.campaignId === c.id) : [];
                      const sent = msgs.filter((m) => m.status === "sent").length;
                      const queued = msgs.filter((m) => m.status === "queued").length;
                      const skipped = msgs.filter((m) => m.status === "skipped").length;
                      return (
                        <li key={s.id}>
                          {i + 1}. {s.label || "step"} · {s.dayOffset >= 0 ? "+" : ""}{s.dayOffset} d {s.time}
                          {c ? ` → ${c.scheduledAt.replace("T", " ")} · ${c.status} · ${sent} sent · ${queued} queued${skipped ? ` · ${skipped} skipped` : ""}` : ""}
                        </li>
                      );
                    })}
                  </ul>
                  {seq.status === "draft" && canEdit && seq.steps.some((s) => !s.body.trim()) ? (
                    <p className="mt-1 text-[11px] text-[var(--warning)]">Some steps have no body yet — edit below before Start.</p>
                  ) : null}
                  {seq.status === "draft" && canEdit ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] text-[var(--brand-deep)]">Edit step bodies</summary>
                      {seq.steps.map((s, i) => (
                        <textarea
                          key={s.id}
                          className={`${inp} mt-1 min-h-[4rem]`}
                          value={s.body}
                          onChange={(e) => props.commitWa(updateSequence(wa, seq.id, { steps: seq.steps.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) }))}
                        />
                      ))}
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </MastersTableCard>
    </div>
  );
}
