"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
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
import {
  clampErpAiPosition,
  defaultErpAiPosition,
  erpAiPageGuideMessage,
  hasSeenPageGuide,
  loadErpAiPosition,
  markPageGuideSeen,
  pageGuideAllowed,
  proactiveHintLabel,
  resolveErpAiPageGuide,
  saveErpAiPosition,
  type ErpAiPageGuide,
} from "@/lib/erpAiPageGuides";
import { useDemoSession } from "@/components/shell/SessionContext";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  inferRoleCodes,
  loadRbac,
  resolveSessionRoles,
} from "@/lib/rbac";
import { TENANT } from "@/lib/types";
import { VoiceMicButton } from "@/components/voice/VoiceMicButton";
import { speakText } from "@/lib/voiceClient";
import type { VoiceLang } from "@/lib/voiceLanguages";

const PANEL_W = 380;
const PANEL_H = 520;
const FAB_W = 220;
const FAB_H = 72;
const DRAG_THRESHOLD = 6;

function engineDisplayLabel(engine: string | null | undefined): string {
  if (engine === "openai") return "OpenAI";
  if (engine === "gemini") return "Gemini";
  return "AI";
}

function loadHistory(
  key: string,
  ctx: ErpAiChatContext,
  llm?: { enabled: boolean; label: string },
): ErpAiMessage[] {
  if (typeof window === "undefined") {
    return [erpAiWelcome(ctx, { llm: llm?.enabled, engineLabel: llm?.label })];
  }
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return [erpAiWelcome(ctx, { llm: llm?.enabled, engineLabel: llm?.label })];
    const parsed = JSON.parse(raw) as ErpAiMessage[];
    if (!Array.isArray(parsed) || !parsed.length) {
      return [erpAiWelcome(ctx, { llm: llm?.enabled, engineLabel: llm?.label })];
    }
    return parsed;
  } catch {
    return [erpAiWelcome(ctx, { llm: llm?.enabled, engineLabel: llm?.label })];
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

function renderStepText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const m = /^\*\*([^*]+)\*\*$/.exec(part);
    if (m) return <strong key={i}>{m[1]}</strong>;
    return <span key={i}>{part}</span>;
  });
}

/**
 * Floating ERP AI assistant — draggable, page-aware step guides.
 */
export function ErpAiChatbot() {
  const session = useDemoSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");

  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [messages, setMessages] = useState<ErpAiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [posReady, setPosReady] = useState(false);
  const [proactiveGuide, setProactiveGuide] = useState<ErpAiPageGuide | null>(
    null,
  );
  const [showHint, setShowHint] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [llmOn, setLlmOn] = useState(false);
  const [engineLabel, setEngineLabel] = useState("AI");
  const [voiceLang, setVoiceLang] = useState<VoiceLang>("auto");
  const [voiceReply, setVoiceReply] = useState(true);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });
  const lastGuideInjected = useRef<string | null>(null);

  const ctx: ErpAiChatContext = useMemo(
    () => ({ session, masters }),
    [session, masters],
  );

  const storageKey = erpAiStorageKey(session);
  const userKey = session.staffId || session.email || session.roleCode || "anon";

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

  const pageGuide = useMemo(
    () => (masters ? resolveErpAiPageGuide(pathname, tab) : null),
    [pathname, tab, masters],
  );

  useEffect(() => {
    setMasters(loadMasters());
    void fetch("/api/erp-ai")
      .then((r) => r.json())
      .then(
        (d: {
          llmConfigured?: boolean;
          geminiConfigured?: boolean;
          primaryEngine?: string;
        }) => {
          const enabled = !!(d.llmConfigured ?? d.geminiConfigured);
          setLlmOn(enabled);
          setEngineLabel(engineDisplayLabel(d.primaryEngine));
        },
      )
      .catch(() => null);
  }, []);

  useEffect(() => {
    if (!masters) return;
    setMessages(
      loadHistory(storageKey, { session, masters }, {
        enabled: llmOn,
        label: engineLabel,
      }),
    );
  }, [session, masters, storageKey, llmOn, engineLabel]);

  useEffect(() => {
    const saved = loadErpAiPosition(userKey);
    const next = clampErpAiPosition(
      saved ?? defaultErpAiPosition(open),
      open,
      window.innerWidth,
      window.innerHeight,
    );
    setPos(next);
    setPosReady(true);

    const onResize = () => {
      setPos((p) =>
        clampErpAiPosition(p, open, window.innerWidth, window.innerHeight),
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [userKey, open]);

  useEffect(() => {
    if (!pageGuide || !masters || !pageGuideAllowed(pageGuide, ctx)) {
      setProactiveGuide(null);
      setShowHint(false);
      return;
    }
    if (hasSeenPageGuide(userKey, pageGuide.id)) {
      setProactiveGuide(null);
      setShowHint(false);
      return;
    }
    setProactiveGuide(pageGuide);
    setShowHint(true);
    lastGuideInjected.current = null;
  }, [pageGuide, masters, ctx, userKey, pathname, tab]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    window.setTimeout(() => inputRef.current?.focus(), 80);
  }, [open, messages.length, typing, minimized]);

  const push = useCallback(
    (next: ErpAiMessage[]) => {
      setMessages(next);
      persist(storageKey, next);
    },
    [storageKey],
  );

  const posRef = useRef(pos);
  posRef.current = pos;

  const injectPageGuide = useCallback(
    (guide: ErpAiPageGuide) => {
      if (!masters) return;
      if (lastGuideInjected.current === guide.id) return;
      setAnalyzing(true);
      window.setTimeout(() => {
        const msg = erpAiPageGuideMessage(guide, { session, masters });
        setMessages((prev) => {
          const next = [...prev, msg];
          persist(storageKey, next);
          return next;
        });
        lastGuideInjected.current = guide.id;
        setAnalyzing(false);
        setTyping(false);
      }, 650);
    },
    [masters, session, storageKey],
  );

  function openPanel(withGuide?: boolean) {
    setOpen(true);
    setMinimized(false);
    if (withGuide && proactiveGuide) {
      setTyping(true);
      injectPageGuide(proactiveGuide);
      markPageGuideSeen(userKey, proactiveGuide.id);
      setShowHint(false);
    }
  }

  function dismissGuide(guideId: string) {
    markPageGuideSeen(userKey, guideId);
    setShowHint(false);
    setProactiveGuide(null);
  }

  function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || typing || !masters) return;
    const user = makeUserMessage(trimmed);
    const withUser = [...messages, user];
    push(withUser);
    setDraft("");
    setTyping(true);

    const history = withUser
      .slice(-12)
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        text: m.text,
      }));

    void (async () => {
      let reply: ErpAiMessage;
      try {
        const res = await fetch("/api/erp-ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            history: history.slice(0, -1),
            pathname,
            tab: tab || undefined,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          message?: ErpAiMessage;
          geminiConfigured?: boolean;
          llmConfigured?: boolean;
          engine?: string;
          error?: string;
        };
        if (res.ok && json.message) {
          reply = json.message;
          if (json.llmConfigured ?? json.geminiConfigured) {
            setLlmOn(true);
            if (json.engine && json.engine !== "local") {
              setEngineLabel(engineDisplayLabel(json.engine));
            }
          }
        } else {
          reply = replyErpAiChat(trimmed, { session, masters });
        }
      } catch {
        reply = replyErpAiChat(trimmed, { session, masters });
      }

      const withReply = [...withUser, reply];
      push(withReply);
      setTyping(false);

      if (voiceReply && reply.role === "assistant") {
        const plain = reply.text.replace(/\*\*([^*]+)\*\*/g, "$1");
        void speakText(plain, { lang: voiceLang, preferGoogle: true });
      }

      const openIntent = /^(open|go to|take me to|show)\b/i.test(trimmed);
      if (openIntent && reply.links?.length === 1) {
        router.push(reply.links[0]!.href);
      }
    })();
  }

  function clearChat() {
    if (!masters) return;
    push([
      erpAiWelcome({ session, masters }, {
        llm: llmOn,
        engineLabel,
      }),
    ]);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (
      !dragRef.current.moved &&
      Math.hypot(dx, dy) < DRAG_THRESHOLD
    ) {
      return;
    }
    dragRef.current.moved = true;
    const next = clampErpAiPosition(
      { x: dragRef.current.origX + dx, y: dragRef.current.origY + dy },
      open && !minimized,
      window.innerWidth,
      window.innerHeight,
    );
    setPos(next);
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!dragRef.current.active) return;
    const wasDrag = dragRef.current.moved;
    dragRef.current.active = false;
    if (wasDrag) {
      saveErpAiPosition(userKey, posRef.current);
    } else if (!open) {
      openPanel(showHint && !!proactiveGuide);
    }
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  if (!posReady) return null;

  const shellStyle = {
    left: pos.x,
    top: pos.y,
    width: open && !minimized ? PANEL_W : FAB_W,
    touchAction: "none" as const,
  };

  if (!open) {
    return (
      <div
        className="erp-ai-shell fixed z-50 select-none"
        style={shellStyle}
      >
        {showHint && proactiveGuide ? (
          <div className="erp-ai-hint-bubble mb-2 ml-auto flex max-w-[220px] flex-col items-end gap-1 text-right">
            <button
              type="button"
              className="rounded-2xl rounded-br-sm border border-[rgba(197,160,40,0.45)] bg-[var(--card)] px-3 py-2 text-[11px] font-semibold leading-snug text-[var(--brand-deep)] shadow-lg"
              onClick={() => openPanel(true)}
            >
              ✨ {proactiveHintLabel(proactiveGuide)}
            </button>
            <button
              type="button"
              className="text-[9px] text-[var(--muted)] hover:underline"
              onClick={() => dismissGuide(proactiveGuide.id)}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className={`erp-ai-fab group flex w-full items-center gap-2.5 rounded-2xl border border-[rgba(197,160,40,0.35)] bg-[linear-gradient(135deg,#1a2848_0%,#2d4268_55%,#1e3050_100%)] px-3 py-2.5 text-white shadow-[0_12px_40px_rgba(32,48,80,0.45)] transition ${
            showHint ? "erp-ai-fab-pulse" : ""
          }`}
          aria-label="Open AI assistant — drag to move"
        >
          <span
            className="erp-ai-avatar flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-black shadow-inner"
            style={{
              background: `linear-gradient(145deg, ${TENANT.goldColor}, #e8c85a)`,
              color: TENANT.primaryColor,
            }}
            aria-hidden
          >
            ✦
          </span>
          <span className="min-w-0 flex-1 text-left leading-tight">
            <span className="block truncate text-[12px] font-bold tracking-wide">
              {TENANT.shortName} AI
            </span>
            <span className="block truncate text-[9px] font-medium text-white/65">
              {pageGuide?.pageLabel ?? roleBadge} · drag me
            </span>
          </span>
          <span className="erp-ai-live-dot shrink-0" title="Online" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="erp-ai-shell fixed z-50 flex flex-col select-none"
      style={{
        ...shellStyle,
        width: minimized ? FAB_W : PANEL_W,
        height: minimized ? FAB_H : PANEL_H,
      }}
      role="dialog"
      aria-label="ERP AI assistant"
    >
      <header
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="erp-ai-drag-handle flex cursor-grab items-start justify-between gap-2 rounded-t-2xl px-3.5 py-3 text-white active:cursor-grabbing"
        style={{
          background: `linear-gradient(135deg, ${TENANT.primaryColor} 0%, ${TENANT.primaryMid} 55%, #3a5278 100%)`,
        }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-white/40" aria-hidden>
            ⠿
          </span>
          <span
            className="erp-ai-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-black"
            style={{
              background: `linear-gradient(145deg, ${TENANT.goldColor}, #e8c85a)`,
              color: TENANT.primaryColor,
            }}
          >
            ✦
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold tracking-wide">
              {TENANT.shortName} assistant
            </p>
            <p className="truncate text-[10px] text-white/75">
              {analyzing
                ? "Reading this page…"
                : `${pageGuide?.pageLabel ?? "ERP"} · ${roleBadge}${llmOn ? ` · ${engineLabel}` : ""}${voiceReply ? " · 🔊" : ""}`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-[10px] font-semibold text-white/85 hover:bg-[var(--card)]/10"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={clearChat}
          >
            Clear
          </button>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-[11px] font-semibold hover:bg-[var(--card)]/10"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setMinimized((v) => !v)}
            aria-label={minimized ? "Expand" : "Minimize"}
          >
            {minimized ? "▢" : "—"}
          </button>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-[11px] font-semibold hover:bg-[var(--card)]/10"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              setOpen(false);
              setMinimized(false);
            }}
            aria-label="Close assistant"
          >
            ✕
          </button>
        </div>
      </header>

      {!minimized ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-2xl border border-t-0 border-[var(--border)] bg-[var(--surface)] shadow-[0_18px_50px_rgba(32,48,80,0.28)]">
          <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[94%] ${
                    m.role === "user"
                      ? "rounded-2xl rounded-br-md bg-[linear-gradient(135deg,#203050,#2a4068)] px-3 py-2 text-[12px] leading-relaxed text-white shadow-md"
                      : ""
                  }`}
                >
                  {m.role === "assistant" ? (
                    <div className="rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--brand-deep)] shadow-sm">
                      {m.guideId ? (
                        <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#1565c0]">
                          ✨ Page guide · {m.pageLabel}
                        </p>
                      ) : null}
                      <p className="whitespace-pre-wrap">{renderText(m.text)}</p>
                      {m.steps?.length ? (
                        <ol className="mt-2.5 space-y-1.5">
                          {m.steps.map((step, idx) => (
                            <li
                              key={idx}
                              className="flex gap-2 rounded-lg bg-[var(--surface-sunken)] px-2 py-1.5 text-[11px] leading-snug"
                            >
                              <span
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                                style={{ background: TENANT.primaryColor }}
                              >
                                {idx + 1}
                              </span>
                              <span>{renderStepText(step)}</span>
                            </li>
                          ))}
                        </ol>
                      ) : null}
                      {m.guideId ? (
                        <button
                          type="button"
                          className="mt-2.5 w-full rounded-lg bg-[rgba(197,160,40,0.18)] py-1.5 text-[10px] font-bold text-[var(--brand-deep)] hover:bg-[rgba(197,160,40,0.3)]"
                          onClick={() => dismissGuide(m.guideId!)}
                        >
                          Got it — thanks
                        </button>
                      ) : null}
                      {m.links?.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {m.links.map((link) => (
                            <button
                              key={link.href + link.label}
                              type="button"
                              className="rounded-full border border-[rgba(197,160,40,0.45)] bg-[rgba(197,160,40,0.12)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--brand-deep)] hover:bg-[rgba(197,160,40,0.22)]"
                              onClick={() => {
                                router.push(link.href);
                              }}
                            >
                              {link.label} →
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.text}</p>
                  )}
                </div>
              </div>
            ))}
            {(typing || analyzing) && !messages.some((m) => m.guideId && analyzing) ? (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-[11px] text-[var(--muted)] shadow-sm">
                  {analyzing ? "Reading this screen" : "Thinking"}
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

          <div className="border-t border-[var(--border)] bg-[var(--card)]/95 px-2.5 py-2 backdrop-blur-sm">
            {proactiveGuide && showHint ? (
              <button
                type="button"
                className="mb-2 w-full rounded-xl border border-[rgba(21,101,192,0.25)] bg-[rgba(21,101,192,0.08)] px-2.5 py-2 text-left text-[10px] font-semibold text-[#1565c0] hover:bg-[rgba(21,101,192,0.14)]"
                onClick={() => {
                  setTyping(true);
                  injectPageGuide(proactiveGuide);
                  markPageGuideSeen(userKey, proactiveGuide.id);
                  setShowHint(false);
                }}
              >
                ✨ {proactiveHintLabel(proactiveGuide)} — tap for step-by-step
              </button>
            ) : null}
            {chips.length ? (
              <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5">
                {chips.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-sunken)] px-2.5 py-1 text-[10px] font-semibold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
                    onClick={() => ask(q.prompt)}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            ) : null}
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                ask(draft);
              }}
            >
              <VoiceMicButton
                lang={voiceLang}
                disabled={typing || !masters}
                onTranscript={(t) => ask(t)}
              />
              <input
                ref={inputRef}
                className="field !py-2 text-sm"
                placeholder={
                  pageGuide
                    ? `Ask or speak — ${pageGuide.pageLabel}…`
                    : "Ask, speak, or type “open fees”…"
                }
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={typing || !masters}
              />
              <button
                type="button"
                title={voiceReply ? "Voice replies on" : "Voice replies off"}
                className={`shrink-0 rounded-xl border px-2 py-2 text-[11px] ${
                  voiceReply
                    ? "border-[rgba(15,118,110,0.35)] bg-[rgba(15,118,110,0.1)]"
                    : "border-[var(--border)] bg-[var(--card)] opacity-60"
                }`}
                onClick={() => setVoiceReply((v) => !v)}
              >
                🔊
              </button>
              <button
                type="submit"
                disabled={typing || !draft.trim() || !masters}
                className="shrink-0 rounded-xl bg-[linear-gradient(135deg,#203050,#2d4568)] px-3 py-2 text-[12px] font-bold text-white disabled:opacity-40"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
