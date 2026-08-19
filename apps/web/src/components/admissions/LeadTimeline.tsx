"use client";

/**
 * Unified activity timeline on a lead: follow-ups + campaign sends + chat
 * widget + WhatsApp bot (fetched once per lead), newest first. Read-only
 * merge from lib/leadTimeline.ts; the follow-up log stays the place staff
 * record calls.
 */

import { useEffect, useMemo, useState } from "react";
import type { AdmissionLead } from "@/lib/admissions";
import { loadWaCampaigns } from "@/lib/waCampaigns";
import { loadCrmParentChat } from "@/lib/crmParentChat";
import { buildLeadTimeline, timelineCounts, type ChatThreadLike, type LeadTimelineEvent } from "@/lib/leadTimeline";

const KIND_TONE: Record<LeadTimelineEvent["kind"], string> = {
  follow_up: "border-[var(--brand-deep)]",
  campaign: "border-[var(--warning)]",
  chat: "border-[var(--success)]",
  wa_bot: "border-[var(--success)]",
  milestone: "border-[var(--border)]",
};

export function LeadTimeline({ lead, onEvents }: { lead: AdmissionLead; onEvents?: (events: LeadTimelineEvent[]) => void }) {
  const [waBot, setWaBot] = useState<ChatThreadLike[]>([]);
  const [showAll, setShowAll] = useState(false);
  const mobile = (lead.mobile || "").replace(/\D/g, "").slice(-10);

  useEffect(() => {
    let alive = true;
    if (!mobile) {
      setWaBot([]);
      return;
    }
    fetch("/api/wa/bot/threads")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { threads?: ChatThreadLike[] } | null) => {
        if (!alive || !j?.threads) return;
        setWaBot(j.threads.filter((t) => (t.mobile || "").replace(/\D/g, "").slice(-10) === mobile));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mobile]);

  const events = useMemo(() => {
    const wa = loadWaCampaigns();
    return buildLeadTimeline({
      lead,
      campaigns: wa.campaigns,
      campaignMessages: wa.messages,
      chatThreads: loadCrmParentChat().threads,
      waBotThreads: waBot,
    });
  }, [lead, waBot]);
  useEffect(() => {
    onEvents?.(events);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);
  const counts = timelineCounts(events);
  const visible = showAll ? events : events.slice(0, 12);

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <p className="text-[10px] font-semibold uppercase text-[var(--muted)]">Activity timeline</p>
        <span className="text-[10px] text-[var(--muted)]">
          {counts.outbound} sent · {counts.inbound} from the family
          {counts.lastInboundAt ? ` · last heard ${counts.lastInboundAt.slice(0, 10)}` : " · never heard back"}
        </span>
      </div>
      {events.length === 0 ? (
        <p className="text-[12px] text-[var(--muted)]">Nothing yet — log the first call, or send a draft from above.</p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((e) => (
            <li key={e.id} className={`rounded-lg border-l-4 ${KIND_TONE[e.kind]} bg-[var(--card)] px-3 py-1.5 text-[12px]`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-[var(--brand-deep)]">
                  {e.direction === "in" ? "← " : e.direction === "out" ? "→ " : ""}
                  {e.title}
                </span>
                <span className="text-[10px] text-[var(--muted)]">
                  {e.at.slice(0, 16).replace("T", " ")}
                  {e.by ? ` · ${e.by}` : ""} · {e.channel}
                </span>
              </div>
              {e.detail ? <p className="mt-0.5 whitespace-pre-wrap text-[var(--ink)]">{e.detail}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {events.length > 12 ? (
        <button type="button" className="mt-1 text-[11px] text-[var(--brand-deep)] underline" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show less" : `Show all ${events.length}`}
        </button>
      ) : null}
    </div>
  );
}
