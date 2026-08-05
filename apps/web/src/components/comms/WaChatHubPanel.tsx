"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  WA_CHAT_CATEGORIES,
  type WaChatCategory,
} from "@/lib/waChatCategories";
import { loadWaTemplates, type WaTemplate } from "@/lib/waTemplates";
import {
  MastersEmptyRow,
  MastersTableCard,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";

type HubMessage = {
  id: string;
  direction: "in" | "out";
  role: string;
  text: string;
  at: string;
  by: string;
};

type HubThread = {
  id: string;
  mobile: string;
  displayName: string;
  category: WaChatCategory;
  categoryLabel: string;
  status: string;
  unreadStaff: number;
  messages: HubMessage[];
  updatedAt: string;
  lastInText: string;
  lastOutText: string;
};

type HubStats = {
  totalThreads: number;
  unreadTotal: number;
  byCategory: Record<
    WaChatCategory,
    { threads: number; unread: number }
  >;
};

const inp =
  "w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm";

export function WaChatHubPanel({
  by,
  canEdit,
}: {
  by: string;
  canEdit: boolean;
}) {
  const [category, setCategory] = useState<WaChatCategory | "all">("all");
  const [threads, setThreads] = useState<HubThread[]>([]);
  const [stats, setStats] = useState<HubStats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [approvedTemplates, setApprovedTemplates] = useState<WaTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    const tpl = loadWaTemplates();
    setApprovedTemplates(
      tpl.templates.filter((t) => t.status === "approved" && !t.paused),
    );
  }, []);

  const refresh = useCallback(async () => {
    try {
      const q =
        category === "all" ? "" : `?category=${encodeURIComponent(category)}`;
      const res = await fetch(`/api/wa/hub${q}`);
      if (!res.ok) return;
      const json = (await res.json()) as {
        threads?: HubThread[];
        stats?: HubStats;
        outboundConfigured?: boolean;
      };
      setThreads(Array.isArray(json.threads) ? json.threads : []);
      setStats(json.stats ?? null);
      setConfigured(!!json.outboundConfigured);
    } catch {
      /* offline */
    }
  }, [category]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const selected = threads.find((t) => t.id === selectedId) || null;

  const categoryChips = useMemo(() => {
    const chips: { id: WaChatCategory | "all"; label: string; unread: number }[] =
      [
        {
          id: "all",
          label: "All",
          unread: stats?.unreadTotal ?? 0,
        },
      ];
    for (const c of WA_CHAT_CATEGORIES) {
      chips.push({
        id: c.id,
        label: c.short,
        unread: stats?.byCategory?.[c.id]?.unread ?? 0,
      });
    }
    return chips;
  }, [stats]);

  async function openThread(t: HubThread) {
    setSelectedId(t.id);
    if (t.unreadStaff > 0) {
      await fetch("/api/wa/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "markRead",
          mobile: t.mobile,
          category: t.category,
        }),
      }).catch(() => null);
      void refresh();
    }
  }

  async function sendReply() {
    if (!selected || !canEdit || busy) return;
    const text = reply.trim();
    if (!text) return;
    setBusy(true);
    try {
      const res = await fetch("/api/wa/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reply",
          threadId: selected.id,
          text,
          by,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        alert(json.error || "Send failed");
        return;
      }
      setReply("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function sendTemplate() {
    if (!selected || !canEdit || busy || !templateId) return;
    const tpl = approvedTemplates.find((t) => t.id === templateId);
    if (!tpl) return;
    setBusy(true);
    try {
      const res = await fetch("/api/wa/hub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sendTemplate",
          threadId: selected.id,
          by,
          template: {
            name: tpl.metaName,
            language: tpl.metaLanguage || tpl.language,
            variableKeys: tpl.variables,
            variables: Object.fromEntries(
              tpl.variables.map((k) => [k, ""]),
            ),
            previewText: tpl.localFallbackBody || tpl.body,
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        alert(json.error || "Template send failed");
        return;
      }
      setTemplateId("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const selectedTemplate = approvedTemplates.find((t) => t.id === templateId);

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-[var(--muted)]">
        School WhatsApp hub — messages grouped by{" "}
        <strong>parents, staff, admission, jobs, vendors, transport</strong>, etc.
        Bot sends <strong>buttons & list rows</strong> when Meta allows; falls back to
        text keywords.{" "}
        {configured ? (
          <span className="text-[#166534]">Outbound API on.</span>
        ) : (
          <span className="text-[#9a3412]">WhatsApp is not configured yet.</span>
        )}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {categoryChips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              setCategory(c.id);
              setSelectedId(null);
            }}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              category === c.id
                ? "bg-[var(--brand-deep)] text-white"
                : "border border-[rgba(32,48,80,0.15)] bg-white"
            }`}
          >
            {c.label}
            {c.unread > 0 ? ` · ${c.unread}` : ""}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MastersTableCard title="Received · by category">
          {threads.length === 0 ? (
            <MastersEmptyRow label="No WhatsApp threads yet — parents/staff message +91 94519 38805." />
          ) : (
            <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
              {threads.map((t) => (
                <li key={`${t.category}-${t.id}`}>
                  <button
                    type="button"
                    className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-[rgba(32,48,80,0.03)] ${
                      selectedId === t.id ? "bg-[rgba(21,128,61,0.1)]" : ""
                    }`}
                    onClick={() => void openThread(t)}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-[var(--brand-deep)]">
                        {t.displayName || "Contact"} · {t.mobile}
                      </span>
                      {t.unreadStaff > 0 ? (
                        <span className="rounded-full bg-[#0f766e] px-1.5 text-[10px] font-bold text-white">
                          {t.unreadStaff}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[10px] font-medium text-[#0f766e]">
                      {t.categoryLabel} · {t.status}
                    </span>
                    <span className="line-clamp-1 text-[11px] text-[var(--muted)]">
                      In: {t.lastInText || "—"}
                    </span>
                    <span className="line-clamp-1 text-[11px] text-[var(--muted)]">
                      Bot/staff: {t.lastOutText || "—"}
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
              ? `${selected.categoryLabel} · ${selected.displayName || selected.mobile}`
              : "Conversation"
          }
          hint={
            selected
              ? `Updated ${selected.updatedAt.slice(0, 16).replace("T", " ")}`
              : "Select a thread"
          }
        >
          {!selected ? (
            <p className="text-[12px] text-[var(--muted)]">
              Choose a thread to see parent/staff messages (in) and bot replies
              (out).
            </p>
          ) : (
            <div className="space-y-3">
              <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-[rgba(32,48,80,0.1)] bg-[rgba(248,248,240,0.6)] p-2">
                {selected.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg px-2 py-1.5 text-[12px] whitespace-pre-wrap ${
                      m.direction === "in"
                        ? "bg-white border-l-2 border-[#0f766e]"
                        : m.role === "staff"
                          ? "bg-[rgba(15,118,110,0.15)]"
                          : "bg-[rgba(32,48,80,0.06)] border-l-2 border-[#64748b]"
                    }`}
                  >
                    <p className="text-[9px] font-semibold uppercase text-[var(--muted)]">
                      {m.direction === "in" ? "Received" : "Bot / staff"} ·{" "}
                      {m.by || "—"} · {m.at.slice(11, 16)}
                    </p>
                    {m.text}
                  </div>
                ))}
              </div>
              {canEdit ? (
                <div className="space-y-2 border-t border-[rgba(32,48,80,0.1)] pt-3">
                  <textarea
                    className={`${inp} min-h-[72px]`}
                    placeholder={`Reply on WhatsApp (${selected.categoryLabel})…`}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={busy || !reply.trim()}
                    className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-60"
                    onClick={() => void sendReply()}
                  >
                    {busy ? "Sending…" : "Send free-text"}
                  </button>
                  <p className="text-[10px] text-[var(--muted)]">
                    Free-text works within 24h of the contact&apos;s last message.
                    Outside that window, use an approved Meta template.
                  </p>
                  <label className="block text-[11px] font-semibold text-[var(--muted)]">
                    Approved Meta template
                    <select
                      className={`${inp} mt-1`}
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                    >
                      <option value="">None</option>
                      {approvedTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.language}) · {t.metaName}
                        </option>
                      ))}
                    </select>
                  </label>
                  {approvedTemplates.length === 0 ? (
                    <p className="text-[10px] text-amber-800">
                      No approved templates — sync in Masters → WhatsApp templates.
                    </p>
                  ) : null}
                  {selectedTemplate ? (
                    <p className="whitespace-pre-wrap rounded-lg bg-[rgba(32,48,80,0.04)] p-2 text-[10px] text-[var(--muted)]">
                      {selectedTemplate.localFallbackBody || selectedTemplate.body}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy || !templateId}
                    className="rounded-lg border border-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-[var(--brand-deep)] disabled:opacity-60"
                    onClick={() => void sendTemplate()}
                  >
                    {busy ? "Sending…" : "Send template"}
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-[var(--muted)]">
                  Read-only — you need comms edit access to reply.
                </p>
              )}
            </div>
          )}
        </MastersWorkCard>
      </div>
    </div>
  );
}
