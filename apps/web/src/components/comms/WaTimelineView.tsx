"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { istDay, istTime, type TimelineMsg } from "@/lib/waTimeline";

/**
 * One number's whole WhatsApp conversation, drawn like WhatsApp: the family
 * on the left, the school on the right — bot, staff, office and every
 * automation (homework, fees, receipts, briefs) — with ticks, "replying to"
 * quotes and India time. Data: GET /api/wa/timeline (lib/waTimeline.server).
 */

type Timeline = { mobile10: string; displayName: string; messages: TimelineMsg[]; gaps: string[] };

// Theme tokens only, so dark mode follows (see the raw_hex ratchet).
const OUT_BG = "color-mix(in srgb, var(--tone-teal) 16%, var(--card))";
const READ_BLUE = "rgb(83 189 235)";

function dayLabel(day: string): string {
  const today = istDay(new Date().toISOString());
  const yesterday = istDay(new Date(Date.now() - 86_400_000).toISOString());
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  const d = new Date(`${day}T12:00:00+05:30`);
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", weekday: "short" });
}

function Ticks({ status }: { status: TimelineMsg["status"] }) {
  if (status === "failed") return <span className="text-[var(--danger)]" title="Not delivered">⚠</span>;
  if (status === "read") return <span style={{ color: READ_BLUE }} title="Read">✓✓</span>;
  if (status === "delivered") return <span title="Delivered">✓✓</span>;
  if (status === "sent") return <span title="Sent">✓</span>;
  return null;
}

export function WaTimelineView({ mobile, refreshKey = 0 }: { mobile: string; refreshKey?: number }) {
  const [data, setData] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [days, setDays] = useState(30);
  const scroller = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const m = mobile.replace(/\D/g, "").slice(-10);
    if (m.length !== 10) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/wa/timeline?mobile=${m}&days=${days}`);
      const json = (await res.json().catch(() => ({}))) as Timeline & { error?: string };
      if (!res.ok) throw new Error(json.error || `Could not load (${res.status})`);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the conversation");
    } finally {
      setLoading(false);
    }
  }, [mobile, days]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Open at the latest message, like the app.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data]);

  const msgs = data?.messages ?? [];
  let lastDay = "";

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--muted)]">
        <span>
          {loading ? "Loading…" : `${msgs.length} messages · India time`}
          {data?.gaps.length ? <span className="text-[var(--danger)]"> · could not read: {data.gaps.join(", ")}</span> : null}
        </span>
        <span className="flex items-center gap-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-full border px-2 py-0.5 ${days === d ? "border-[var(--tone-teal)] text-[var(--brand-deep)] font-semibold" : "border-[var(--border)]"}`}
            >
              {d} days
            </button>
          ))}
          <button type="button" onClick={() => void load()} className="rounded-full border border-[var(--border)] px-2 py-0.5">
            ↻
          </button>
        </span>
      </div>
      {error ? <p className="text-[11px] text-[var(--danger)]">{error}</p> : null}
      <div
        ref={scroller}
        className="max-h-[32rem] min-h-48 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-2 py-2"
      >
        {!loading && !msgs.length ? (
          <p className="py-8 text-center text-[12px] text-[var(--muted)]">No WhatsApp messages with this number in the last {days} days.</p>
        ) : null}
        {msgs.map((m) => {
          const day = istDay(m.at);
          const sep = day !== lastDay;
          lastDay = day;
          const out = m.direction === "out";
          return (
            <div key={m.id}>
              {sep ? (
                <div className="my-2 flex justify-center">
                  <span className="rounded-md bg-[var(--card)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)] shadow-sm">
                    {dayLabel(day)}
                  </span>
                </div>
              ) : null}
              <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[82%] rounded-lg px-2.5 py-1.5 text-[12.5px] leading-snug text-[var(--ink)] shadow-sm"
                  style={{ background: out ? OUT_BG : "var(--card)" }}
                >
                  {out && m.label ? (
                    <p className="mb-0.5 text-[10px] font-semibold text-[var(--tone-teal)]">{m.label}</p>
                  ) : null}
                  {!out && m.label ? (
                    <p className="mb-0.5 text-[10px] font-semibold text-[var(--muted)]">{m.label}</p>
                  ) : null}
                  {m.replyToText ? (
                    <div className="mb-1 rounded border-l-2 border-[var(--tone-teal)] bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[11px] text-[var(--muted)] line-clamp-3">
                      {m.replyToText}
                    </div>
                  ) : null}
                  <p className="whitespace-pre-wrap break-words">{m.text || <span className="italic text-[var(--muted)]">({m.kind})</span>}</p>
                  {m.error && m.status === "failed" ? <p className="mt-0.5 text-[10px] text-[var(--danger)]">{m.error.slice(0, 160)}</p> : null}
                  <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-[var(--muted)]">
                    {istTime(m.at)}
                    {out ? <Ticks status={m.status} /> : null}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
