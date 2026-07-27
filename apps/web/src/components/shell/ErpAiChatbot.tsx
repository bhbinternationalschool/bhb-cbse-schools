"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  erpAiStorageKey,
  erpAiWelcome,
  makeUserMessage,
  quickPromptsForUser,
  replyErpAiChat,
  type ErpAiChatContext,
  type ErpAiMessage,
  type ErpAiQuickPrompt,
} from "@/lib/erpAiChat";
import { useDemoSession } from "@/components/shell/SessionContext";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  inferRoleCodes,
  loadRbac,
  resolveSessionRoles,
} from "@/lib/rbac";
import { TENANT } from "@/lib/types";

function loadHistory(
  key: string,
  ctx: ErpAiChatContext,
): ErpAiMessage[] {
  if (typeof window === "undefined") return [erpAiWelcome(ctx)];
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [erpAiWelcome(ctx)];
    const parsed = JSON.parse(raw) as ErpAiMessage[];
    if (!Array.isArray(parsed) || !parsed.length) return [erpAiWelcome(ctx)];
    return parsed;
  } catch {
    return [erpAiWelcome(ctx)];
  }
}

function persist(key: string, messages: ErpAiMessage[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify(messages.slice(-40)));
  } catch {
    /* ignore quota */
  }
}

function renderText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(part);
    if (m) {
      return (
        <strong key={i} className="font-semibold text-[var(--brand-deep)]">
          {m[1]}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/**
 * Floating ERP AI assistant for staff (AppShell).
 * Chips & deep-links are filtered by role + RBAC permissions.
 */
export function ErpAiChatbot() {
  const session = useDemoSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [messages, setMessages] = useState<ErpAiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const ctx: ErpAiChatContext = useMemo(
    () => ({ session, masters }),
    [session, masters],
  );

  const storageKey = erpAiStorageKey(session);

  const chips: ErpAiQuickPrompt[] = useMemo(
    () => (masters ? quickPromptsForUser(ctx) : []),
    [ctx, masters],
  );

  const roleBadge = useMemo(() => {
    if (!masters) return session.roleCode || "Staff";
    const rbac = loadRbac();
    const roles = resolveSessionRoles(rbac, session, masters);
    if (roles[0]?.name) return roles[0].name;
    const codes = inferRoleCodes(session, masters);
    const named = rbac.roles.find((r) => r.code === codes[0]);
    return named?.name || codes[0] || session.roleCode || "Staff";
  }, [session, masters]);

  useEffect(() => {
    setMasters(loadMasters());
  }, []);

  useEffect(() => {
    if (!masters) return;
    setMessages(loadHistory(storageKey, { session, masters }));
  }, [session, masters, storageKey]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }, [open, messages.length, typing]);

  function push(next: ErpAiMessage[]) {
    setMessages(next);
    persist(storageKey, next);
  }

  function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || typing || !masters) return;
    const user = makeUserMessage(trimmed);
    const withUser = [...messages, user];
    push(withUser);
    setDraft("");
    setTyping(true);

    window.setTimeout(() => {
      const reply = replyErpAiChat(trimmed, { session, masters });
      const withReply = [...withUser, reply];
      push(withReply);
      setTyping(false);

      const openIntent = /^(open|go to|take me to|show)\b/i.test(trimmed);
      if (openIntent && reply.links?.length === 1) {
        router.push(reply.links[0]!.href);
      }
    }, 280 + Math.min(600, trimmed.length * 8));
  }

  function clearChat() {
    if (!masters) return;
    const welcome = erpAiWelcome({ session, masters });
    push([welcome]);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="erp-ai-fab group fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-[var(--brand-deep)] pl-3 pr-4 py-3 text-white shadow-[0_10px_30px_rgba(32,48,80,0.35)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(32,48,80,0.4)]"
        aria-label="Open AI assistant"
      >
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold"
          style={{ background: TENANT.goldColor, color: TENANT.primaryColor }}
          aria-hidden
        >
          AI
        </span>
        <span className="text-left leading-tight">
          <span className="block text-[12px] font-semibold tracking-wide">
            Ask ERP
          </span>
          <span className="block text-[9px] font-medium text-white/70">
            {roleBadge}
          </span>
        </span>
        <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-[var(--ok)] ring-2 ring-[var(--surface)]" />
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-40 flex w-[min(100vw-1.25rem,23rem)] flex-col overflow-hidden rounded-2xl border border-[rgba(32,48,80,0.16)] bg-white shadow-[0_18px_50px_rgba(32,48,80,0.28)]"
      role="dialog"
      aria-label="ERP AI assistant"
    >
      <header
        className="flex items-start justify-between gap-2 px-3.5 py-3 text-white"
        style={{
          background: `linear-gradient(135deg, ${TENANT.primaryColor} 0%, ${TENANT.primaryMid} 70%, #2a3d5c 100%)`,
        }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
              style={{
                background: TENANT.goldColor,
                color: TENANT.primaryColor,
              }}
            >
              AI
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-bold tracking-wide">
                {TENANT.shortName} assistant
              </p>
              <p className="truncate text-[10px] text-white/75">
                {roleBadge} · permission-based chips
              </p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[10px] font-semibold text-white/85 hover:bg-white/10"
            onClick={clearChat}
          >
            Clear
          </button>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[11px] font-semibold hover:bg-white/10"
            onClick={() => setOpen(false)}
            aria-label="Close assistant"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="flex max-h-[min(62vh,26rem)] flex-col bg-[linear-gradient(180deg,#f7f6f1_0%,#fff_40%)]">
        <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[92%] rounded-2xl px-3 py-2 text-[12px] leading-relaxed ${
                  m.role === "user"
                    ? "rounded-br-md bg-[var(--brand-deep)] text-white"
                    : "rounded-bl-md border border-[rgba(32,48,80,0.1)] bg-white text-[var(--brand-deep)] shadow-sm"
                }`}
              >
                <p className="whitespace-pre-wrap">{renderText(m.text)}</p>
                {m.links?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.links.map((link) => (
                      <button
                        key={link.href + link.label}
                        type="button"
                        className="rounded-full border border-[rgba(197,160,40,0.45)] bg-[rgba(197,160,40,0.12)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--brand-deep)] hover:bg-[rgba(197,160,40,0.22)]"
                        onClick={() => {
                          router.push(link.href);
                          setOpen(false);
                        }}
                      >
                        {link.label} →
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {typing ? (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md border border-[rgba(32,48,80,0.1)] bg-white px-3 py-2 text-[11px] text-[var(--muted)] shadow-sm">
                Thinking
                <span className="ml-0.5 inline-flex gap-0.5">
                  <span className="erp-ai-dot" />
                  <span
                    className="erp-ai-dot"
                    style={{ animationDelay: "0.15s" }}
                  />
                  <span
                    className="erp-ai-dot"
                    style={{ animationDelay: "0.3s" }}
                  />
                </span>
              </div>
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-[rgba(32,48,80,0.08)] bg-white px-2.5 py-2">
          {chips.length ? (
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5">
              {chips.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  className="shrink-0 rounded-full border border-[rgba(32,48,80,0.14)] bg-[rgba(32,48,80,0.03)] px-2.5 py-1 text-[10px] font-semibold text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.08)]"
                  onClick={() => ask(q.prompt)}
                >
                  {q.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="mb-2 text-[10px] text-[var(--muted)]">
              No module chips for this role yet — type a question or “open
              home”.
            </p>
          )}
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
          >
            <input
              ref={inputRef}
              className="field !py-2 text-sm"
              placeholder="Ask or type “open fees”…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={typing || !masters}
            />
            <button
              type="submit"
              disabled={typing || !draft.trim() || !masters}
              className="shrink-0 rounded-xl bg-[var(--brand-deep)] px-3 py-2 text-[12px] font-bold text-white disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
