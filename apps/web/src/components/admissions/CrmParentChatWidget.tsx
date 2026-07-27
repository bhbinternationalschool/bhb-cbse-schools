"use client";

import { useEffect, useRef, useState } from "react";
import {
  CRM_CHAT_AUDIENCE,
  crmBotQuickPrompts,
  crmBotWelcome,
  loadCrmParentChat,
  openOrCreateCrmThread,
  postCrmParentMessage,
  saveCrmParentChat,
  type CrmBotQuickId,
  type CrmChatThread,
} from "@/lib/crmParentChat";
import { TENANT } from "@/lib/types";

/**
 * Floating admissions chatbot for CRM / enquiry parents.
 * Not shown on SIS /parent portal — that is for enrolled student families.
 */
export function CrmParentChatWidget({
  defaultOpen = false,
}: {
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [mobile, setMobile] = useState("");
  const [parentName, setParentName] = useState("");
  const [thread, setThread] = useState<CrmChatThread | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages.length, open]);

  function startChat() {
    setError(null);
    const digits = mobile.replace(/\D/g, "");
    if (digits.length !== 10) {
      setError("Enter 10-digit WhatsApp mobile");
      return;
    }
    const state = loadCrmParentChat();
    const r = openOrCreateCrmThread(state, {
      mobile: digits,
      parentName,
    });
    saveCrmParentChat(r.state);
    setThread(r.thread);
  }

  function send(text: string, quickId?: CrmBotQuickId) {
    if (!thread) return;
    setError(null);
    const state = loadCrmParentChat();
    const r = postCrmParentMessage(state, thread.id, text, { quickId });
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    saveCrmParentChat(r.state);
    setThread(r.thread);
    setDraft("");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 rounded-full bg-[var(--brand-deep)] px-4 py-3 text-[12px] font-semibold text-white shadow-lg"
        aria-label="Open admissions chat"
      >
        Admissions chat
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[min(100vw-1.5rem,22rem)] flex-col overflow-hidden rounded-2xl border border-[rgba(32,48,80,0.18)] bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-2 bg-[var(--brand-deep)] px-3 py-2.5 text-white">
        <div>
          <p className="text-[13px] font-semibold">
            {TENANT.shortName} · Admissions
          </p>
          <p className="text-[10px] opacity-80">
            CRM parents only · not student Parent login
          </p>
        </div>
        <button
          type="button"
          className="rounded-md px-2 py-0.5 text-[11px] font-semibold hover:bg-white/10"
          onClick={() => setOpen(false)}
        >
          Close
        </button>
      </header>

      <div className="flex max-h-[min(70vh,28rem)] flex-col bg-[rgba(248,248,240,0.9)]">
        {!thread ? (
          <div className="space-y-3 p-3">
            <p className="whitespace-pre-wrap text-[12px] text-[var(--brand-deep)]">
              {crmBotWelcome()}
            </p>
            <input
              className="w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm"
              placeholder="Your name"
              value={parentName}
              onChange={(e) => setParentName(e.target.value)}
            />
            <input
              className="w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm"
              placeholder="WhatsApp mobile *"
              inputMode="numeric"
              maxLength={10}
              value={mobile}
              onChange={(e) =>
                setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))
              }
            />
            {error ? (
              <p className="text-[11px] font-medium text-[#b42318]">{error}</p>
            ) : null}
            <button
              type="button"
              className="w-full rounded-lg bg-[var(--brand-deep)] py-2.5 text-[12px] font-semibold text-white"
              onClick={startChat}
            >
              Start chat
            </button>
            <p className="text-[10px] text-[var(--muted)]">
              Audience: {CRM_CHAT_AUDIENCE} · SIS /parent portal is separate.
            </p>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
              {thread.messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[90%] rounded-xl px-2.5 py-1.5 text-[12px] whitespace-pre-wrap ${
                    m.role === "parent"
                      ? "ml-auto bg-[var(--brand-deep)] text-white"
                      : m.role === "staff"
                        ? "bg-[#0f766e] text-white"
                        : "bg-white text-[var(--brand-deep)] shadow-sm"
                  }`}
                >
                  {m.role !== "parent" ? (
                    <p className="mb-0.5 text-[9px] font-semibold uppercase opacity-70">
                      {m.role === "bot" ? "Bot" : m.by || "Admissions"}
                    </p>
                  ) : null}
                  {m.text}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <div className="flex flex-wrap gap-1 border-t border-[rgba(32,48,80,0.08)] bg-white px-2 py-1.5">
              {crmBotQuickPrompts().map((q) => (
                <button
                  key={q.id}
                  type="button"
                  className="rounded-full border border-[rgba(32,48,80,0.15)] px-2 py-0.5 text-[10px] font-semibold text-[var(--brand-deep)]"
                  onClick={() => send(q.label, q.id)}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <form
              className="flex gap-1 border-t border-[rgba(32,48,80,0.08)] bg-white p-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (draft.trim()) send(draft.trim());
              }}
            >
              <input
                className="min-w-0 flex-1 rounded-lg border border-[rgba(32,48,80,0.15)] px-2 py-2 text-sm"
                placeholder="Type a message…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button
                type="submit"
                className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-white"
              >
                Send
              </button>
            </form>
            {error ? (
              <p className="px-2 pb-2 text-[11px] text-[#b42318]">{error}</p>
            ) : null}
            {thread.status === "needs_staff" ? (
              <p className="bg-[rgba(154,52,18,0.1)] px-2 py-1 text-[10px] font-semibold text-[#9a3412]">
                Queued for admissions counsellor
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
