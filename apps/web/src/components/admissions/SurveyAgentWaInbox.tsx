"use client";

import { useCallback, useEffect, useState } from "react";
import { SURVEY_BOT_QUICK_PROMPTS } from "@/lib/surveyFieldBotEngine";
import {
  MastersEmptyRow,
  MastersTableCard,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";

const inp =
  "w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm";

type WaThread = {
  id: string;
  mobile: string;
  agentName: string;
  memberId: string;
  status: string;
  messages: {
    id: string;
    role: "parent" | "bot" | "staff";
    text: string;
    at: string;
    by: string;
  }[];
  updatedAt: string;
  unreadStaff: number;
};

export function SurveyAgentWaInbox({
  by,
  canEdit = true,
}: {
  by: string;
  canEdit?: boolean;
}) {
  const [threads, setThreads] = useState<WaThread[]>([]);
  const [configured, setConfigured] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/wa/survey-bot/threads");
      if (!res.ok) return;
      const json = (await res.json()) as {
        outboundConfigured?: boolean;
        threads?: WaThread[];
      };
      setConfigured(!!json.outboundConfigured);
      setThreads(Array.isArray(json.threads) ? json.threads : []);
    } catch {
      /* */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 12_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const selected = threads.find((t) => t.id === selectedId) || null;
  const keywords = SURVEY_BOT_QUICK_PROMPTS.map((q) => q.waKeyword).join(" · ");

  async function onReply() {
    if (!selected || !canEdit || busy) return;
    const text = reply.trim();
    if (!text) {
      setNotice("Enter a reply");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/wa/survey-bot/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: selected.id, text, by }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNotice(json.error || "Send failed");
        await refresh();
        return;
      }
      setNotice("Sent on WhatsApp");
      setReply("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-[var(--muted)]">
        WhatsApp-only field day for <strong>assigned survey agents</strong> — no
        Field app required. Flow: <strong>START CODE</strong> → share location pin
        → <strong>CAPTURE</strong> households → <strong>BREAK</strong>/
        <strong>END</strong> with location. Keywords:{" "}
        <strong className="text-[var(--brand-deep)]">{keywords}</strong>. Open
        Admissions once so the team syncs to the server mirror.
        {configured ? " · Connected" : " · Configure WhatsApp in Masters → Integrations"}
      </p>

      {notice ? (
        <p className="rounded-lg border border-[rgba(22,101,52,0.25)] bg-[rgba(22,101,52,0.08)] px-3 py-2 text-[12px] text-[#166534]">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <MastersTableCard title="Survey agent WhatsApp threads">
          {threads.length === 0 ? (
            <MastersEmptyRow label="No agent chats yet — assigned survey mobiles text your Business number." />
          ) : (
            <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-[rgba(32,48,80,0.03)] ${
                      selectedId === t.id ? "bg-[rgba(21,128,61,0.1)]" : ""
                    }`}
                    onClick={() => setSelectedId(t.id)}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-[var(--brand-deep)]">
                        {t.agentName || "Agent"} · {t.mobile}
                      </span>
                      {t.unreadStaff > 0 ? (
                        <span className="rounded-full bg-[#0f766e] px-1.5 text-[10px] font-bold text-white">
                          {t.unreadStaff}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[11px] text-[var(--muted)]">
                      {t.status} · {t.updatedAt.slice(0, 16).replace("T", " ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </MastersTableCard>

        <MastersWorkCard
          title={
            selected
              ? `WhatsApp · ${selected.agentName || selected.mobile}`
              : "Select a thread"
          }
          hint="Staff replies go out on WhatsApp Business API"
        >
          {!selected ? (
            <p className="text-[12px] text-[var(--muted)]">
              Choose a conversation. Escalations show as needs_staff.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-[rgba(32,48,80,0.1)] bg-[rgba(248,248,240,0.6)] p-2">
                {selected.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg px-2 py-1.5 text-[12px] whitespace-pre-wrap ${
                      m.role === "parent"
                        ? "bg-white"
                        : m.role === "staff"
                          ? "bg-[rgba(15,118,110,0.15)]"
                          : "bg-[rgba(32,48,80,0.06)]"
                    }`}
                  >
                    <p className="text-[9px] font-semibold uppercase text-[var(--muted)]">
                      {m.role === "parent" ? "agent" : m.role} · {m.by || "—"}
                    </p>
                    {m.text}
                  </div>
                ))}
              </div>
              {canEdit ? (
                <>
                  <textarea
                    className={`${inp} min-h-[72px]`}
                    placeholder="Reply as survey office…"
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-60"
                    onClick={() => void onReply()}
                  >
                    {busy ? "Sending…" : "Send on WhatsApp"}
                  </button>
                </>
              ) : null}
            </div>
          )}
        </MastersWorkCard>
      </div>
    </div>
  );
}
