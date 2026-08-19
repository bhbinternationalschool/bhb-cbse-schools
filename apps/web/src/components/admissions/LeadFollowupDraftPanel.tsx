"use client";

/**
 * "Draft follow-up" on a lead — the counsellor's next message in the
 * family's language for WhatsApp / SMS / email / a call script. Facts come
 * from the lead; approved KB snippets are added server-side; the model
 * only writes the words. Nothing is sent from here: WhatsApp opens in
 * wa.me and the touch is logged as a follow-up; other channels are copied.
 */

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  followUpChannelLabel,
  followUpOutcomeLabel,
  sourceLabel,
  stageLabel,
  type AdmissionLead,
  type FollowUpChannel,
  type FollowUpOutcome,
} from "@/lib/admissions";
import { HOUSEHOLD_LANGUAGES } from "@/lib/householdPrefs";
import {
  FOLLOWUP_CHANNELS,
  FOLLOWUP_TONES,
  type FollowupChannel,
  type FollowupTone,
  type LeadFollowupDraft,
} from "@/lib/leadFollowupAi";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";
import { openWaMe } from "@/lib/waMe";

type Result = {
  draft: LeadFollowupDraft;
  language: string;
  translated: boolean;
  ungroundedNumbers: string[];
  kbUsed: string[];
  engine: string;
  generationId: string;
};

export function LeadFollowupDraftPanel(props: {
  lead: AdmissionLead;
  classLabel: string;
  counsellorName: string;
  registerUrl: string;
  canEdit: boolean;
  /** Optional rule-chosen hook (stalled-lead re-engagement) */
  hook?: string;
  /** Unified-timeline touchpoints (all channels); falls back to follow-ups when absent */
  touchpoints?: string[];
  onLogFollowUp: (input: { channel: FollowUpChannel; outcome: FollowUpOutcome; note: string; nextFollowUpAt: string }) => void;
  onFlash: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const { lead } = props;
  const [tone, setTone] = useState<FollowupTone>("warm");
  const [language, setLanguage] = useState<string>(lead.preferredLanguage || "en");
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState<FollowupChannel>("whatsapp");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailTo, setEmailTo] = useState(lead.email || "");
  const [emailReady, setEmailReady] = useState<boolean | null>(null);
  useEffect(() => {
    setEmailTo(lead.email || "");
  }, [lead.id, lead.email]);
  useEffect(() => {
    fetch("/api/email/send")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { configured?: boolean } | null) => setEmailReady(!!j?.configured))
      .catch(() => setEmailReady(false));
  }, []);

  async function sendEmailNow() {
    if (!res || emailBusy) return;
    const d = res.draft;
    const subject = d.email.subject || `Regarding ${lead.childName}'s admission enquiry`;
    if (!d.email.body) return props.onError("No email body in the draft");
    setEmailBusy(true);
    try {
      const r = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "admissions", to: emailTo, subject, text: d.email.body, ref: `lead:${lead.id}` }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; from?: string };
      if (!r.ok || !j.ok) return props.onError(j.error || "Email failed");
      accept();
      props.onLogFollowUp({ channel: "email", outcome: "message_sent", note: `Email sent from ${j.from} (AI draft, ${language}): ${subject.slice(0, 100)}`, nextFollowUpAt: "" });
      props.onFlash(`Email sent from ${j.from}`);
    } catch (e) {
      props.onError(e instanceof Error ? e.message : "Email failed");
    } finally {
      setEmailBusy(false);
    }
  }

  useEffect(() => {
    setRes(null);
    setLanguage(lead.preferredLanguage || "en");
  }, [lead.id, lead.preferredLanguage]);

  async function draft() {
    if (busy) return;
    setBusy(true);
    try {
      const days = lead.leadDate
        ? Math.max(0, Math.round((Date.now() - new Date(`${lead.leadDate}T00:00:00`).getTime()) / 86_400_000))
        : 0;
      const recentTouchpoints = props.touchpoints?.length
        ? props.touchpoints
        : (lead.followUps || [])
            .slice(-4)
            .map((f) => `${followUpChannelLabel(f.channel)}: ${followUpOutcomeLabel(f.outcome)}${f.note ? ` (${f.note.slice(0, 120)})` : ""}`);
      const r = await fetch("/api/ai/lead-followup-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tone,
          language,
          facts: {
            counsellorName: props.counsellorName,
            childName: lead.childName,
            guardianName: lead.guardianName,
            classSoughtLabel: props.classLabel,
            stageLabel: stageLabel(lead.stage),
            sourceLabel: sourceLabel(lead.source),
            daysSinceEnquiry: days,
            concerns: lead.concerns,
            recentTouchpoints,
            counsellorNote: note,
            registerUrl: props.registerUrl,
            hook: props.hook || "",
          },
        }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string } & Partial<Result>;
      if (!r.ok || !j.ok || !j.draft) {
        props.onError(j.error || "Draft failed");
        return;
      }
      setRes({
        draft: j.draft,
        language: j.language || language,
        translated: !!j.translated,
        ungroundedNumbers: j.ungroundedNumbers || [],
        kbUsed: j.kbUsed || [],
        engine: j.engine || "",
        generationId: j.generationId || "",
      });
    } catch (e) {
      props.onError(e instanceof Error ? e.message : "Draft failed");
    } finally {
      setBusy(false);
    }
  }

  function accept() {
    if (res?.generationId) {
      reportAiOutcome({ ids: [res.generationId], outcome: "accepted", targetType: "admission_lead", targetId: lead.id });
      setRes({ ...res, generationId: "" });
    }
  }

  function textFor(ch: FollowupChannel): string {
    if (!res) return "";
    const d = res.draft;
    if (ch === "whatsapp") return d.whatsapp;
    if (ch === "sms") return d.sms;
    if (ch === "email") return d.email.subject ? `Subject: ${d.email.subject}\n\n${d.email.body}` : d.email.body;
    return d.callScript.map((l, i) => `${i + 1}. ${l}`).join("\n");
  }

  async function copy(ch: FollowupChannel) {
    const t = textFor(ch);
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      accept();
      props.onFlash("Copied");
    } catch {
      props.onError("Could not copy — select the text and copy manually");
    }
  }

  function sendWhatsApp() {
    const t = textFor("whatsapp");
    if (!t || !lead.mobile) return;
    accept();
    openWaMe(lead.mobile, t);
    props.onLogFollowUp({
      channel: "whatsapp",
      outcome: "message_sent",
      note: `AI follow-up draft (${tone}, ${language}): ${t.slice(0, 140)}${t.length > 140 ? "…" : ""}`,
      nextFollowUpAt: "",
    });
  }

  function logSent(ch: FollowupChannel) {
    const t = textFor(ch);
    if (!t) return;
    accept();
    props.onLogFollowUp({
      channel: ch === "sms" ? "sms" : ch === "email" ? "email" : "call",
      outcome: ch === "call_script" ? "connected" : "message_sent",
      note: `${ch === "call_script" ? "Call (AI script)" : ch === "email" ? "Email sent (AI draft)" : "SMS sent (AI draft)"}: ${t.slice(0, 140)}${t.length > 140 ? "…" : ""}`,
      nextFollowUpAt: "",
    });
  }

  if (!props.canEdit) return null;

  return (
    <div className="mt-3 rounded-lg border border-[var(--border)] p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] font-semibold uppercase text-[var(--muted)]">Draft follow-up</p>
        <select className="field !w-auto !py-0.5 text-[11px]" value={tone} onChange={(e) => setTone(e.target.value as FollowupTone)}>
          {FOLLOWUP_TONES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <select className="field !w-auto !py-0.5 text-[11px]" value={language} onChange={(e) => setLanguage(e.target.value)} title="Family's language — from the lead when asked">
          {HOUSEHOLD_LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() => void draft()}
          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {busy ? "Drafting…" : res ? "Re-draft" : "Draft"}
        </button>
      </div>
      <input
        className="field mt-1.5 !py-1 text-[11px]"
        placeholder="Anything specific for this draft? e.g. invite to open house on 24th, mention sibling discount is in KB"
        maxLength={400}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {!lead.preferredLanguage ? (
        <p className="mt-1 text-[10px] text-[var(--muted)]">Family&apos;s language not asked yet — drafting in {HOUSEHOLD_LANGUAGES.find((l) => l.id === language)?.label}.</p>
      ) : null}
      {lead.concerns.length === 0 ? (
        <p className="mt-1 text-[10px] text-[var(--muted)]">No concerns recorded — the draft will be generic; add &ldquo;what matters&rdquo; on the lead for a sharper message.</p>
      ) : null}

      {res ? (
        <div className="mt-2">
          <div className="flex flex-wrap gap-1">
            {FOLLOWUP_CHANNELS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${channel === c.id ? "border-[var(--brand-deep)] bg-[var(--brand-deep)] text-white" : "border-[var(--border)] text-[var(--muted)]"}`}
                onClick={() => setChannel(c.id)}
              >
                {c.label}
              </button>
            ))}
            <span className="ml-auto text-[10px] text-[var(--muted)]">
              {res.engine}
              {res.translated ? " · Sarvam" : ""}
              {res.kbUsed.length ? ` · KB: ${res.kbUsed.length}` : " · no KB facts"}
            </span>
          </div>
          {res.ungroundedNumbers.length ? (
            <p className="mt-1 rounded bg-[var(--warning-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--warning)]">
              Check numbers not in the facts: {res.ungroundedNumbers.join(", ")} — edit before sending.
            </p>
          ) : null}
          <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-[var(--surface)] p-2.5 text-[12px] text-[var(--ink)]" lang={res.language === "en" ? undefined : res.language}>
            {textFor(channel) || "—"}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button type="button" className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)]" onClick={() => void copy(channel)}>
              Copy
            </button>
            {channel === "whatsapp" && lead.mobile ? (
              <button type="button" className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)]" onClick={sendWhatsApp}>
                Open WhatsApp & log
              </button>
            ) : null}
            {channel === "email" ? (
              <span className="inline-flex items-center gap-1">
                <input className="field !w-52 !py-1 text-[11px]" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="parent@email" />
                <button
                  type="button"
                  disabled={emailBusy || !emailReady || !emailTo}
                  title={emailReady === false ? "Email channel not connected — Comms → Email" : "Send through the school's Google Workspace (admissions mailbox)"}
                  className="rounded-lg bg-[var(--primary)] px-2.5 py-1 text-[11px] font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
                  onClick={() => void sendEmailNow()}
                >
                  {emailBusy ? "Sending…" : "Send email & log"}
                </button>
              </span>
            ) : null}
            {channel !== "whatsapp" ? (
              <button type="button" className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)]" onClick={() => logSent(channel)}>
                {channel === "call_script" ? "Log call made" : "Log as sent"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
