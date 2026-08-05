"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CRM_CHAT_AUDIENCE,
  closeCrmThread,
  crmChatUnreadCount,
  listCrmThreadsForStaff,
  loadCrmParentChat,
  markCrmThreadRead,
  postCrmStaffReply,
  saveCrmParentChat,
  type CrmChatThread,
  type CrmParentChatState,
} from "@/lib/crmParentChat";
import { CRM_BOT_QUICK_PROMPTS } from "@/lib/crmAdmissionBotEngine";
import {
  MastersEmptyRow,
  MastersTableCard,
  MastersWorkCard,
} from "@/components/masters/MastersLayout";

const inp =
  "w-full rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-3 py-2 text-sm";

type Channel = "web" | "whatsapp";

type WaThread = {
  id: string;
  mobile: string;
  parentName: string;
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

export function AdmissionCrmChatInbox({
  by,
  canEdit,
}: {
  by: string;
  canEdit: boolean;
}) {
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [state, setState] = useState<CrmParentChatState>(() =>
    loadCrmParentChat(),
  );
  const [waThreads, setWaThreads] = useState<WaThread[]>([]);
  const [waConfigured, setWaConfigured] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function refreshWeb() {
    setState(loadCrmParentChat());
  }

  const refreshWa = useCallback(async () => {
    try {
      const res = await fetch("/api/wa/bot/threads");
      if (!res.ok) return;
      const json = (await res.json()) as {
        outboundConfigured?: boolean;
        threads?: WaThread[];
      };
      setWaConfigured(!!json.outboundConfigured);
      const list = Array.isArray(json.threads) ? json.threads : [];
      setWaThreads(list);
      return list;
    } catch {
      /* offline */
    }
    return [];
  }, []);

  useEffect(() => {
    refreshWeb();
    void refreshWa();
    const onFocus = () => {
      refreshWeb();
      void refreshWa();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onFocus);
    };
  }, [refreshWa]);

  useEffect(() => {
    if (channel !== "whatsapp") return;
    void refreshWa();
    const t = window.setInterval(() => void refreshWa(), 12_000);
    return () => window.clearInterval(t);
  }, [channel, refreshWa]);

  const webThreads = useMemo(() => listCrmThreadsForStaff(state), [state]);
  const selectedWeb = webThreads.find((t) => t.id === selectedId) || null;
  const selectedWa = waThreads.find((t) => t.id === selectedId) || null;
  const unreadWeb = crmChatUnreadCount(state);
  const unreadWa = waThreads.reduce((n, t) => n + (t.unreadStaff || 0), 0);

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3200);
  }

  function commit(next: CrmParentChatState, msg?: string) {
    saveCrmParentChat(next);
    setState(next);
    if (msg) flash(msg);
  }

  function openWebThread(t: CrmChatThread) {
    setSelectedId(t.id);
    commit(markCrmThreadRead(state, t.id));
  }

  function openWaThread(t: WaThread) {
    setSelectedId(t.id);
    setWaThreads((prev) =>
      prev.map((row) =>
        row.id === t.id ? { ...row, unreadStaff: 0 } : row,
      ),
    );
    void fetch("/api/wa/bot/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "markRead", threadId: t.id }),
    }).catch(() => {
      /* offline */
    });
  }

  function onWebReply() {
    if (!selectedWeb || !canEdit) return;
    const r = postCrmStaffReply(state, selectedWeb.id, reply, by);
    if (!r.ok) {
      flash(r.reason);
      return;
    }
    commit(r.state, "Reply sent");
    setReply("");
  }

  async function onWaReply() {
    if (!selectedWa || !canEdit || busy) return;
    const text = reply.trim();
    if (!text) {
      flash("Enter a reply");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/wa/bot/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: selectedWa.id,
          text,
          by,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        flash(json.error || "WhatsApp reply failed");
        await refreshWa();
        return;
      }
      flash("Sent on WhatsApp");
      setReply("");
      await refreshWa();
    } finally {
      setBusy(false);
    }
  }

  const keywords = CRM_BOT_QUICK_PROMPTS.map((q) => q.waKeyword).join(" · ");

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-[var(--muted)]">
        Inbox for <strong>CRM / admission parents</strong> (
        {CRM_CHAT_AUDIENCE}).{" "}
        <span className="text-[#9a3412]">
          WhatsApp messages appear under <strong>WhatsApp bot</strong> — not Web
          chat. Enrolled families use Parent login (/parent), not this inbox.
        </span>
      </p>

      {channel === "web" && waThreads.length > 0 ? (
        <p className="rounded-lg border border-[rgba(180,83,9,0.35)] bg-[rgba(251,191,36,0.12)] px-3 py-2 text-[12px] text-[#92400e]">
          You have {waThreads.length} WhatsApp conversation
          {waThreads.length === 1 ? "" : "s"}
          {unreadWa > 0 ? ` (${unreadWa} unread)` : ""}. Switch to{" "}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => {
              setChannel("whatsapp");
              setSelectedId(null);
            }}
          >
            WhatsApp bot
          </button>{" "}
          to see messages from your school number.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold ${
            channel === "web"
              ? "bg-[var(--brand-deep)] text-white"
              : "border border-[rgba(32,48,80,0.15)]"
          }`}
          onClick={() => {
            setChannel("web");
            setSelectedId(null);
          }}
        >
          Web chat
          {unreadWeb > 0 ? ` · ${unreadWeb}` : ""}
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold ${
            channel === "whatsapp"
              ? "bg-[var(--brand-deep)] text-white"
              : "border border-[rgba(32,48,80,0.15)]"
          }`}
          onClick={() => {
            setChannel("whatsapp");
            setSelectedId(null);
          }}
        >
          WhatsApp bot
          {unreadWa > 0 ? ` · ${unreadWa}` : ""}
        </button>
      </div>

      {channel === "whatsapp" ? (
        <p className="rounded-lg border border-[rgba(32,48,80,0.12)] bg-[rgba(248,248,240,0.8)] px-3 py-2 text-[11px] text-[var(--muted)]">
          Parents message your WhatsApp Business number. Keywords:{" "}
          <strong className="text-[var(--brand-deep)]">{keywords}</strong>.
          {waConfigured
            ? " · Connected"
            : " · Configure WhatsApp in Masters → Integrations"}
        </p>
      ) : null}

      {notice ? (
        <p className="rounded-lg border border-[rgba(22,101,52,0.25)] bg-[rgba(22,101,52,0.08)] px-3 py-2 text-[12px] text-[#166534]">
          {notice}
        </p>
      ) : null}

      {channel === "web" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <MastersTableCard title="CRM parent threads (web)">
            {webThreads.length === 0 ? (
              <MastersEmptyRow label="No chats yet — parents use Admissions chat on /apply or /register." />
            ) : (
              <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
                {webThreads.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-[rgba(32,48,80,0.03)] ${
                        selectedId === t.id ? "bg-[rgba(21,128,61,0.1)]" : ""
                      }`}
                      onClick={() => openWebThread(t)}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-[var(--brand-deep)]">
                          {t.parentName || "Parent"} · {t.mobile}
                        </span>
                        {t.unreadStaff > 0 ? (
                          <span className="rounded-full bg-[#0f766e] px-1.5 text-[10px] font-bold text-white">
                            {t.unreadStaff}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-[11px] text-[var(--muted)]">
                        {t.status}
                        {t.childName ? ` · ${t.childName}` : ""} ·{" "}
                        {t.updatedAt.slice(0, 16).replace("T", " ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </MastersTableCard>

          <MastersWorkCard
            title={
              selectedWeb
                ? `Chat · ${selectedWeb.parentName || selectedWeb.mobile}`
                : "Select a thread"
            }
            hint={
              selectedWeb
                ? `${selectedWeb.childName || "No child linked"} · lead ${selectedWeb.leadId || "—"}`
                : "Replies appear in the parent Admissions chat widget"
            }
          >
            {!selectedWeb ? (
              <p className="text-[12px] text-[var(--muted)]">
                Choose a CRM parent conversation.
              </p>
            ) : (
              <ThreadPane
                messages={selectedWeb.messages}
                canEdit={canEdit}
                reply={reply}
                setReply={setReply}
                onSend={onWebReply}
                onClose={() =>
                  commit(closeCrmThread(state, selectedWeb.id), "Closed")
                }
              />
            )}
          </MastersWorkCard>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <MastersTableCard title="WhatsApp CRM bot threads">
            {waThreads.length === 0 ? (
              <MastersEmptyRow label="No WhatsApp chats yet — parents text your Business number; Meta webhook posts to /api/wa/webhook." />
            ) : (
              <ul className="divide-y divide-[rgba(32,48,80,0.08)]">
                {waThreads.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-[rgba(32,48,80,0.03)] ${
                        selectedId === t.id ? "bg-[rgba(21,128,61,0.1)]" : ""
                      }`}
                      onClick={() => openWaThread(t)}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-[var(--brand-deep)]">
                          {t.parentName || "Parent"} · {t.mobile}
                        </span>
                        {t.unreadStaff > 0 ? (
                          <span className="rounded-full bg-[#0f766e] px-1.5 text-[10px] font-bold text-white">
                            {t.unreadStaff}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-[11px] text-[var(--muted)]">
                        {t.status} ·{" "}
                        {t.updatedAt.slice(0, 16).replace("T", " ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </MastersTableCard>

          <MastersWorkCard
            title={
              selectedWa
                ? `WhatsApp · ${selectedWa.parentName || selectedWa.mobile}`
                : "Select a WhatsApp thread"
            }
            hint="Staff replies go out on the WhatsApp Business API"
          >
            {!selectedWa ? (
              <p className="text-[12px] text-[var(--muted)]">
                Choose a WhatsApp conversation. Escalations show as needs_staff.
              </p>
            ) : (
              <ThreadPane
                messages={selectedWa.messages}
                canEdit={canEdit}
                reply={reply}
                setReply={setReply}
                onSend={() => void onWaReply()}
                sendLabel={busy ? "Sending…" : "Send on WhatsApp"}
                sendDisabled={busy}
              />
            )}
          </MastersWorkCard>
        </div>
      )}
    </div>
  );
}

function ThreadPane({
  messages,
  canEdit,
  reply,
  setReply,
  onSend,
  onClose,
  sendLabel = "Send reply",
  sendDisabled,
}: {
  messages: {
    id: string;
    role: string;
    text: string;
    by?: string;
  }[];
  canEdit: boolean;
  reply: string;
  setReply: (v: string) => void;
  onSend: () => void;
  onClose?: () => void;
  sendLabel?: string;
  sendDisabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-[rgba(32,48,80,0.1)] bg-[rgba(248,248,240,0.6)] p-2">
        {messages.map((m) => (
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
              {m.role} · {m.by || "—"}
            </p>
            {m.text}
          </div>
        ))}
      </div>
      {canEdit ? (
        <>
          <textarea
            className={`${inp} min-h-[72px]`}
            placeholder="Reply as admissions…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={sendDisabled}
              className="rounded-lg bg-[var(--brand-deep)] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-60"
              onClick={onSend}
            >
              {sendLabel}
            </button>
            {onClose ? (
              <button
                type="button"
                className="rounded-lg border px-3 py-2 text-[11px] font-semibold"
                onClick={onClose}
              >
                Close thread
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
