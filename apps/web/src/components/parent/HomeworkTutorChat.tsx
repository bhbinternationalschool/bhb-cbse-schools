"use client";

import { useEffect, useState } from "react";
import { speakText } from "@/lib/voiceClient";
import { consumeAiStream } from "@/lib/aiStream";
import type { HomeworkTutorContext } from "@/lib/homeworkTutor.types";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

type Turn = { role: "user" | "assistant"; content: string };

export function HomeworkTutorChat({
  context,
  studentId,
  onError,
}: {
  context: HomeworkTutorContext;
  /** The child this panel is for — the tutor is pinned to their class and pass. */
  studentId?: string;
  onError?: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [engine, setEngine] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Turn[]>([]);

  useEffect(() => {
    void fetch("/api/ai/tutor")
      .then((r) => r.json())
      .then((d: { configured?: boolean; engine?: string }) => {
        setConfigured(!!d.configured);
        setEngine(d.engine || "");
      })
      .catch(() => setConfigured(false));
  }, []);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    const nextHistory: Turn[] = [...history, { role: "user", content: message }];
    setHistory(nextHistory);
    setBusy(true);
    try {
      const res = await fetch("/api/ai/tutor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          message,
          history: nextHistory.slice(0, -1),
          context,
          studentId,
        }),
      });
      // The reply grows in place as the tutor writes it; the final event
      // carries the whole text, which replaces whatever was assembled.
      let partial = "";
      let finished = false;
      let failed: string | null = null;
      await consumeAiStream<{ engine?: string; reply?: string }>(res, (ev) => {
        if (ev.type === "delta") {
          partial += ev.text;
          setHistory([...nextHistory, { role: "assistant", content: partial }]);
        } else if (ev.type === "done") {
          finished = true;
          if (ev.engine) setEngine(ev.engine);
          setHistory([
            ...nextHistory,
            { role: "assistant", content: ev.reply || partial },
          ]);
        } else {
          failed = ev.error;
        }
      });
      if (!finished) {
        onError?.(failed || "Tutor unavailable");
        setHistory(history);
      }
    } catch {
      onError?.("Could not reach tutor");
      setHistory(history);
    } finally {
      setBusy(false);
    }
  }

  if (configured === false) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        className="text-xs font-semibold text-[#6d28d9] underline"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide tutor hints" : "Get tutor hints"}
        {engine ? ` (${engine})` : ""}
      </button>
      {open ? (
        <div className="mt-2 space-y-2 rounded-lg border border-[rgba(109,40,217,0.2)] bg-[rgba(124,58,237,0.06)] p-2">
          <p className="text-[10px] text-[var(--muted)]">
            Hints only — helps your child think; does not submit homework for
            them.
          </p>
          {history.length ? (
            <ul className="max-h-40 space-y-1.5 overflow-y-auto text-xs">
              {history.map((t, i) => (
                <li
                  key={i}
                  className={
                    t.role === "user"
                      ? "text-[var(--brand-deep)]"
                      : "text-[#4c1d95]"
                  }
                >
                  <span className="font-bold">
                    {t.role === "user" ? "You: " : "Tutor: "}
                  </span>
                  <span className="whitespace-pre-wrap">{t.content}</span>
                  {t.role === "assistant" ? (
                    <button
                      type="button"
                      className="ml-2 text-[10px] font-semibold text-[#1565c0] underline"
                      onClick={() =>
                        void speakText(t.content, { lang: "auto", preferGoogle: true })
                      }
                    >
                      Listen
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <input
              className={`${field} min-w-0 flex-1 text-xs`}
              placeholder="e.g. How do I explain fractions?"
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              disabled={busy || !input.trim()}
              className="shrink-0 rounded-lg bg-[#6d28d9] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              onClick={() => void send()}
            >
              {busy ? "…" : "Ask"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
