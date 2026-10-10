"use client";

import { useEffect, useState } from "react";

type LogEntry = {
  id: string;
  channel: "wa" | "app_chat";
  direction: "out" | "in";
  purpose: string;
  via: string;
  templateName: string;
  preview: string;
  status: "sent" | "failed";
  error: string | null;
  by: string;
  at: string;
};

type ChannelFilter = "all" | "wa" | "app_chat";

const CHANNEL_LABEL: Record<LogEntry["channel"], string> = {
  wa: "WhatsApp",
  app_chat: "In-app chat",
};

const FILTERS: { id: ChannelFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "wa", label: "WhatsApp" },
  { id: "app_chat", label: "In-app chat" },
];

const PAGE_SIZE = 50;

export function StaffMessageTimelinePanel({
  staffId,
  mobile,
}: {
  staffId: string;
  mobile: string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [filter, setFilter] = useState<ChannelFilter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (staffId) params.set("staffId", staffId);
        if (mobile) params.set("mobile", mobile);
        params.set("limit", String(limit));
        const res = await fetch(`/api/comms/staff-log?${params.toString()}`);
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          entries?: LogEntry[];
        };
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setError(json.error || "Could not load messages");
          setEntries(null);
          return;
        }
        setEntries(json.entries || []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load messages");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (staffId || mobile) void load();
    else {
      setLoading(false);
      setEntries([]);
    }
    return () => {
      cancelled = true;
    };
  }, [staffId, mobile, limit]);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [staffId, mobile]);

  const filtered = (entries || []).filter(
    (e) => filter === "all" || e.channel === filter,
  );
  const canLoadMore = !loading && !!entries && entries.length >= limit;

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-[var(--muted)]">
        This staff member&apos;s cross-channel message history — WhatsApp sent
        to their own mobile (duty/substitution notify, leadership pings,
        broadcasts) and in-app chat threads they take part in (staff DMs,
        groups, class-announcement channels, parent DMs).{" "}
        <span className="text-amber-800">IVRS and email are not tracked
        yet</span> — IVRS has no call history stored anywhere in this system
        today, and email has no provider configured.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                filter === f.id
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "border border-[var(--border)] bg-[var(--card)] text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {entries && entries.length > 0 ? (
          <span className="text-[11px] text-[var(--muted)]">
            {filtered.length} of {entries.length} message
            {entries.length === 1 ? "" : "s"} shown
          </span>
        ) : null}
      </div>

      {loading && !entries ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          Loading…
        </div>
      ) : error ? (
        <p className="text-[12px] text-[var(--danger)]">{error}</p>
      ) : entries && filtered.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          {entries.length === 0
            ? "No messages found for this staff member yet."
            : "No messages match this filter."}
        </div>
      ) : entries ? (
        <>
          <ul className="space-y-2">
            {filtered.map((e) => (
              <li
                key={e.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-[var(--brand-deep)]">
                    {CHANNEL_LABEL[e.channel]}
                    {e.channel === "wa" ? ` · ${e.purpose}` : ""}
                    {e.direction === "in" ? " · inbound" : " · outbound"}
                  </span>
                  <span className="text-[10px] text-[var(--muted)]">
                    {e.at.slice(0, 16).replace("T", " ")}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[12px] text-[var(--ink)]">
                  {e.preview || (e.templateName ? `Template: ${e.templateName}` : "—")}
                </p>
                {e.status === "failed" ? (
                  <p className="mt-1 text-[10px] text-[var(--danger)]">
                    Failed{e.error ? ` — ${e.error}` : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {canLoadMore ? (
            <div className="flex justify-center">
              <button
                type="button"
                disabled={loading}
                onClick={() => setLimit((l) => l + PAGE_SIZE)}
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-[11px] font-semibold text-[var(--ink)] hover:bg-[var(--surface-sunken)] disabled:opacity-60"
              >
                {loading ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
