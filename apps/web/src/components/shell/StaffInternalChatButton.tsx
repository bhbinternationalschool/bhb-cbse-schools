"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  alertOnIncomingMessages,
  ensureBrowserNotifyPermission,
  loadChatAlertPrefs,
  markMessagesSeen,
  saveChatAlertPrefs,
  type ChatAlertPrefs,
} from "@/lib/chatAlerts";
import {
  actorCanPost,
  actorDisplayName,
  chatSelfFromSession,
  createStaffGroup,
  ERP_CHAT_EVENT,
  formatChatTime,
  lastMessageForThread,
  listActiveStaffForChat,
  loadErpChat,
  markThreadRead,
  messagesForThread,
  openClassAnnouncement,
  openStaffDm,
  openStaffParentDm,
  sendErpChatMessage,
  staffInitials,
  threadTitle,
  threadsForActor,
  totalUnreadForActor,
  unreadInThread,
  type ErpChatState,
  type ErpChatThread,
} from "@/lib/erpChat";
import {
  parentAllowedTeachers,
  staffAllowedParentContacts,
  staffAllowedSections,
  type ChatParentContact,
  type ChatSectionRef,
} from "@/lib/erpChatAccess";
import { loadMasters, type MastersState } from "@/lib/masters";
import { loadSis } from "@/lib/sis";
import { useDemoSessionOptional } from "@/components/shell/SessionContext";

type TabId = "recent" | "staff" | "parents" | "groups";
type ComposerMode = null | "new-group" | "new-announcement";

/**
 * Header WhatsApp-style chat: staff DMs/groups, parent DMs, class announcements.
 */
export function StaffInternalChatButton() {
  const session = useDemoSessionOptional();
  const [open, setOpen] = useState(false);
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [state, setState] = useState<ErpChatState | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<TabId>("recent");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerMode>(null);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [announceSectionId, setAnnounceSectionId] = useState("");
  const [prefs, setPrefs] = useState<ChatAlertPrefs>(defaultPrefsSafe);
  const rootRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const knownMsgIds = useRef<Set<string>>(new Set());
  const primedAlerts = useRef(false);

  const ay = session?.academicYearCode || "";

  const actor = useMemo(() => {
    if (!masters || !session) return null;
    return chatSelfFromSession(session, masters, loadSis());
  }, [masters, session]);

  const meKey = actor?.key || "";
  const isParent = actor?.kind === "parent";

  const refresh = useCallback(() => {
    setState(loadErpChat());
  }, []);

  useEffect(() => {
    setMasters(loadMasters());
    setPrefs(loadChatAlertPrefs());
    refresh();
    void import("@/lib/erpChatPersistence").then(
      ({ ensureErpChatHydrated }) => {
        void ensureErpChatHydrated().then((changed) => {
          if (changed) refresh();
        });
      },
    );
    function onChat() {
      refresh();
    }
    function onPrefs() {
      setPrefs(loadChatAlertPrefs());
    }
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener(ERP_CHAT_EVENT, onChat);
    window.addEventListener("bhb-staff-chat", onChat);
    window.addEventListener("bhb-chat-alert-prefs", onPrefs);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener(ERP_CHAT_EVENT, onChat);
      window.removeEventListener("bhb-staff-chat", onChat);
      window.removeEventListener("bhb-chat-alert-prefs", onPrefs);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [refresh]);

  // Poll remote while visible
  useEffect(() => {
    if (!open && typeof document !== "undefined" && document.hidden) return;
    let alive = true;
    async function tick() {
      if (!alive) return;
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const { pollErpChatRemote } = await import("@/lib/erpChatPersistence");
        const changed = await pollErpChatRemote();
        if (changed) refresh();
        // Also merge from server API when session cookie exists
        const res = await fetch("/api/chat", { method: "GET" }).catch(() => null);
        if (res?.ok) {
          const body = (await res.json()) as { state?: ErpChatState };
          if (body.state) {
            const { mergeErpChatStates, writeErpChatLocalRaw, loadErpChat } =
              await import("@/lib/erpChat");
            const merged = mergeErpChatStates(loadErpChat(), body.state);
            writeErpChatLocalRaw(merged);
            refresh();
            void fetch("/api/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "sync", state: merged }),
            }).catch(() => null);
          }
        }
      } catch {
        /* ignore */
      }
    }
    // Was 8000 — this button is mounted globally in AppShell, so every
    // logged-in staff member's open tab was hitting /api/chat every 8s,
    // all day. That was the largest identified driver of Supabase egress:
    // GET /api/chat used to pull the full 4.13 MB school_mirror_state
    // blob (now fixed separately — see erpChatActorLite.server.ts), but
    // even with that fixed, an internal staff chat has no reason to poll
    // this aggressively. 30s is still responsive for a workplace tool.
    const id = window.setInterval(() => void tick(), 30_000);
    void tick();
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [open, refresh]);

  const parents = useMemo((): ChatParentContact[] => {
    if (!masters || !actor || !ay) return [];
    if (actor.kind === "staff") {
      return staffAllowedParentContacts(actor, masters, ay, loadSis());
    }
    return [];
  }, [masters, actor, ay]);

  const sections = useMemo((): ChatSectionRef[] => {
    if (!masters || !actor || actor.kind !== "staff" || !ay) return [];
    const staff = (masters.staff ?? []).find((s) => s.id === actor.staffId);
    return staffAllowedSections(staff, masters, ay, actor.roleCodes);
  }, [masters, actor, ay]);

  const parentTeachers = useMemo(() => {
    if (!masters || !actor || actor.kind !== "parent" || !actor.householdId || !ay) {
      return [];
    }
    return parentAllowedTeachers(actor.householdId, masters, ay, loadSis());
  }, [masters, actor, ay]);

  const unread = useMemo(() => {
    if (!state || !meKey) return 0;
    return totalUnreadForActor(meKey, state);
  }, [state, meKey]);

  const myThreads = useMemo(() => {
    if (!state || !meKey) return [] as ErpChatThread[];
    return threadsForActor(meKey, state);
  }, [state, meKey]);

  const activeThread = useMemo(() => {
    if (!state || !activeThreadId) return null;
    return state.threads.find((t) => t.id === activeThreadId) || null;
  }, [state, activeThreadId]);

  const activeMessages = useMemo(() => {
    if (!state || !activeThread) return [];
    return messagesForThread(activeThread.id, state);
  }, [state, activeThread]);

  // Alerts on new inbound messages
  useEffect(() => {
    if (!state || !meKey || !masters) return;
    const inbound = state.messages.filter((m) => m.fromActorKey !== meKey);
    if (!primedAlerts.current) {
      knownMsgIds.current = new Set(inbound.map((m) => m.id));
      markMessagesSeen(inbound.map((m) => m.id));
      primedAlerts.current = true;
      return;
    }
    const fresh = inbound.filter((m) => !knownMsgIds.current.has(m.id));
    for (const m of fresh) knownMsgIds.current.add(m.id);
    if (!fresh.length) return;
    const openId = open ? activeThreadId : null;
    alertOnIncomingMessages({
      myActorKey: meKey,
      openThreadId: openId,
      messages: fresh.map((m) => {
        const th = state.threads.find((t) => t.id === m.threadId);
        return {
          messageId: m.id,
          threadId: m.threadId,
          fromLabel: actorDisplayName(masters, m.fromActorKey, parents, session ?? undefined),
          text: m.text,
          threadTitle: th
            ? threadTitle(th, meKey, masters, parents)
            : "Chat",
        };
      }),
    });
  }, [state, meKey, masters, parents, session, open, activeThreadId]);

  useEffect(() => {
    if (!open || !activeThread || !meKey) return;
    markThreadRead(activeThread.id, meKey);
    refresh();
    void fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_read", threadId: activeThread.id }),
    }).catch(() => null);
  }, [open, activeThread, meKey, activeMessages.length, refresh]);

  useEffect(() => {
    if (!open || !activeThreadId) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    window.setTimeout(() => inputRef.current?.focus(), 60);
  }, [open, activeThreadId, activeMessages.length]);

  const q = query.trim().toLowerCase();
  const staffRoster = useMemo(() => {
    if (!masters || !actor || actor.kind !== "staff") return [];
    const all = listActiveStaffForChat(
      masters,
      actor.staffId?.startsWith("sess_") ? "" : actor.staffId || "",
    );
    if (!q) return all;
    return all.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        s.empCode.toLowerCase().includes(q) ||
        s.mobile.includes(q),
    );
  }, [masters, actor, q]);

  const parentRoster = useMemo(() => {
    if (!q) return parents;
    return parents.filter(
      (p) =>
        p.guardianName.toLowerCase().includes(q) ||
        p.childNames.some((n) => n.toLowerCase().includes(q)) ||
        p.classLabels.some((c) => c.toLowerCase().includes(q)) ||
        p.mobile.includes(q),
    );
  }, [parents, q]);

  const filteredThreads = useMemo(() => {
    let list = myThreads;
    if (tab === "groups") {
      list = list.filter(
        (t) => t.kind === "staff_group" || t.kind === "class_announcement",
      );
    } else if (tab === "staff") {
      list = list.filter((t) => t.kind === "staff_dm");
    } else if (tab === "parents") {
      list = list.filter(
        (t) => t.kind === "staff_parent_dm" || t.kind === "class_announcement",
      );
    }
    if (!q || !masters) return list;
    return list.filter((t) =>
      threadTitle(t, meKey, masters, parents).toLowerCase().includes(q),
    );
  }, [myThreads, tab, q, masters, meKey, parents]);

  if (!session) return null;

  function syncServer(next: ErpChatState) {
    void fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync", state: next }),
    }).catch(() => null);
  }

  function openThread(threadId: string) {
    setActiveThreadId(threadId);
    setComposer(null);
    setError(null);
    setDraft("");
  }

  function onOpenStaff(peerId: string) {
    if (!actor?.staffId) return;
    const r = openStaffDm({ meStaffId: actor.staffId, peerStaffId: peerId });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setState(r.state);
    syncServer(r.state);
    openThread(r.thread.id);
  }

  function onOpenParent(householdId: string, staffId?: string) {
    if (!actor || !masters) return;
    const sid =
      staffId ||
      (actor.kind === "staff" ? actor.staffId : undefined) ||
      "";
    if (!sid) return;
    const r = openStaffParentDm({
      actor,
      householdId,
      staffId: sid,
      academicYearCode: ay,
      masters,
      sis: loadSis(),
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setState(r.state);
    syncServer(r.state);
    openThread(r.thread.id);
  }

  function onCreateGroup() {
    if (!actor?.staffId) return;
    const r = createStaffGroup({
      title: groupTitle,
      memberStaffIds: groupMembers,
      createdBy: actor.staffId,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setState(r.state);
    syncServer(r.state);
    setGroupTitle("");
    setGroupMembers([]);
    setComposer(null);
    openThread(r.thread.id);
  }

  function onCreateAnnouncement() {
    if (!actor || !masters || !announceSectionId) return;
    const r = openClassAnnouncement({
      actor,
      sectionId: announceSectionId,
      academicYearCode: ay,
      masters,
      sis: loadSis(),
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setState(r.state);
    syncServer(r.state);
    setAnnounceSectionId("");
    setComposer(null);
    openThread(r.thread.id);
  }

  function onSend() {
    if (!actor || !activeThread) return;
    const r = sendErpChatMessage({
      threadId: activeThread.id,
      fromActorKey: actor.key,
      fromActorKind: actor.kind,
      text: draft,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setDraft("");
    setError(null);
    setState(r.state);
    syncServer(r.state);
  }

  function toggleMute() {
    const next = { ...prefs, muted: !prefs.muted };
    saveChatAlertPrefs(next);
    setPrefs(next);
  }

  async function enableBrowserAlerts() {
    const perm = await ensureBrowserNotifyPermission();
    const next = {
      ...prefs,
      browser: perm === "granted",
      muted: false,
    };
    saveChatAlertPrefs(next);
    setPrefs(next);
  }

  const headerTitle = isParent ? "School chat" : "Staff & parents";
  const activeTitle =
    activeThread && masters
      ? threadTitle(activeThread, meKey, masters, parents)
      : "";
  const canPost = activeThread && meKey
    ? actorCanPost(activeThread, meKey)
    : false;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full bg-[#25D366] text-white shadow-sm transition hover:brightness-105"
        aria-label="Chat"
        title={headerTitle}
      >
        <WhatsAppGlyph />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#dc2626] px-1 text-[9px] font-bold text-white ring-2 ring-[var(--surface)]">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 flex h-[min(78vh,32rem)] w-[min(100vw-1.5rem,23rem)] flex-col overflow-hidden rounded-2xl border border-[rgba(32,48,80,0.14)] bg-white shadow-[0_16px_40px_rgba(32,48,80,0.28)]">
          <header className="flex items-center justify-between gap-2 bg-[#075E54] px-3 py-2.5 text-white">
            <div className="min-w-0">
              <p className="text-[13px] font-bold tracking-wide">{headerTitle}</p>
              <p className="truncate text-[10px] text-white/80">
                {session.fullName}
                {actor?.roleCodes?.length
                  ? ` · ${actor.roleCodes[0]}`
                  : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="rounded-md px-1.5 py-1 text-[11px] font-semibold hover:bg-white/10"
                title={prefs.muted ? "Unmute alerts" : "Mute alerts"}
                onClick={toggleMute}
              >
                {prefs.muted ? "🔇" : "🔔"}
              </button>
              {activeThreadId || composer ? (
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-[11px] font-semibold hover:bg-white/10"
                  onClick={() => {
                    setActiveThreadId(null);
                    setComposer(null);
                  }}
                >
                  ← Chats
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-[11px] font-semibold hover:bg-white/10"
                  onClick={() => setOpen(false)}
                >
                  ✕
                </button>
              )}
            </div>
          </header>

          {composer === "new-group" && actor?.kind === "staff" ? (
            <div className="flex flex-1 flex-col overflow-hidden bg-white">
              <div className="space-y-2 border-b border-[rgba(32,48,80,0.08)] px-3 py-2">
                <p className="text-[12px] font-bold text-[var(--brand-deep)]">
                  New staff group
                </p>
                <input
                  className="w-full rounded-lg border border-[rgba(32,48,80,0.12)] px-3 py-1.5 text-[12px] outline-none"
                  placeholder="Group name"
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                />
              </div>
              <div className="flex-1 overflow-y-auto">
                {staffRoster.map((s) => {
                  const on = groupMembers.includes(s.id);
                  return (
                    <label
                      key={s.id}
                      className="flex cursor-pointer items-center gap-2 border-b border-[rgba(32,48,80,0.06)] px-3 py-2 text-[12px]"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setGroupMembers((prev) =>
                            on
                              ? prev.filter((id) => id !== s.id)
                              : [...prev, s.id],
                          )
                        }
                      />
                      <span className="font-semibold text-[var(--brand-deep)]">
                        {s.fullName}
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="flex gap-2 border-t border-[rgba(32,48,80,0.08)] p-2">
                <button
                  type="button"
                  className="flex-1 rounded-lg bg-[#25D366] py-2 text-[12px] font-bold text-white disabled:opacity-40"
                  disabled={!groupTitle.trim() || groupMembers.length === 0}
                  onClick={onCreateGroup}
                >
                  Create group
                </button>
              </div>
            </div>
          ) : composer === "new-announcement" && actor?.kind === "staff" ? (
            <div className="flex flex-1 flex-col gap-2 bg-white p-3">
              <p className="text-[12px] font-bold text-[var(--brand-deep)]">
                Class announcement channel
              </p>
              <p className="text-[11px] text-[var(--muted)]">
                Parents can read only; staff assigned to the section can post.
              </p>
              <select
                className="rounded-lg border border-[rgba(32,48,80,0.12)] px-3 py-2 text-[12px]"
                value={announceSectionId}
                onChange={(e) => setAnnounceSectionId(e.target.value)}
              >
                <option value="">Select section…</option>
                {sections.map((s) => (
                  <option key={s.sectionId} value={s.sectionId}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded-lg bg-[#25D366] py-2 text-[12px] font-bold text-white disabled:opacity-40"
                disabled={!announceSectionId}
                onClick={onCreateAnnouncement}
              >
                Open channel
              </button>
            </div>
          ) : !activeThreadId ? (
            <>
              <div className="flex gap-1 border-b border-[rgba(32,48,80,0.08)] bg-[#f0f2f5] px-2 py-1.5">
                {(
                  (isParent
                    ? (["recent", "parents"] as TabId[])
                    : (["recent", "staff", "parents", "groups"] as TabId[]))
                ).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                      tab === id
                        ? "bg-white text-[#075E54] shadow-sm"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    {id === "parents" && isParent ? "Teachers" : id}
                  </button>
                ))}
              </div>
              <div className="border-b border-[rgba(32,48,80,0.08)] bg-[#f0f2f5] px-2.5 py-2">
                <input
                  className="w-full rounded-lg border-0 bg-white px-3 py-1.5 text-[12px] text-[var(--brand-deep)] shadow-sm outline-none ring-1 ring-[rgba(32,48,80,0.08)]"
                  placeholder={
                    isParent
                      ? "Search teachers…"
                      : "Search name / class…"
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {!isParent ? (
                <div className="flex gap-1 border-b border-[rgba(32,48,80,0.06)] bg-white px-2 py-1.5">
                  <button
                    type="button"
                    className="rounded-md bg-[#e7f8ef] px-2 py-1 text-[10px] font-bold text-[#075E54]"
                    onClick={() => setComposer("new-group")}
                  >
                    + Group
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-[#e7f0f8] px-2 py-1 text-[10px] font-bold text-[#203050]"
                    onClick={() => setComposer("new-announcement")}
                  >
                    + Class announce
                  </button>
                  <button
                    type="button"
                    className="ml-auto rounded-md px-2 py-1 text-[10px] font-semibold text-[var(--muted)]"
                    onClick={() => void enableBrowserAlerts()}
                  >
                    {prefs.browser ? "Alerts on" : "Enable alerts"}
                  </button>
                </div>
              ) : (
                <div className="flex justify-end border-b border-[rgba(32,48,80,0.06)] bg-white px-2 py-1.5">
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-[10px] font-semibold text-[var(--muted)]"
                    onClick={() => void enableBrowserAlerts()}
                  >
                    {prefs.browser ? "Alerts on" : "Enable alerts"}
                  </button>
                </div>
              )}
              <div className="flex-1 overflow-y-auto bg-white">
                {(tab === "recent" || tab === "groups") &&
                  filteredThreads.map((t) => {
                    if (!masters) return null;
                    const name = threadTitle(t, meKey, masters, parents);
                    const last = lastMessageForThread(t.id, state!);
                    const n = unreadInThread(t.id, meKey, state!);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className="flex w-full items-center gap-2.5 border-b border-[rgba(32,48,80,0.06)] px-3 py-2.5 text-left hover:bg-[#f5f6f6]"
                        onClick={() => openThread(t.id)}
                      >
                        <Avatar name={name} kind={t.kind} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[13px] font-semibold text-[var(--brand-deep)]">
                              {name}
                            </span>
                            <span className="shrink-0 text-[10px] text-[var(--muted)]">
                              {last ? formatChatTime(last.at) : ""}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-[11px] text-[var(--muted)]">
                              {kindBadge(t.kind)}
                              {last
                                ? ` · ${last.fromActorKey === meKey ? "You: " : ""}${last.text}`
                                : " · No messages yet"}
                            </p>
                            {n > 0 ? (
                              <span className="rounded-full bg-[#25D366] px-1.5 text-[10px] font-bold text-white">
                                {n}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })}

                {tab === "staff" &&
                  !isParent &&
                  (staffRoster.length === 0 ? (
                    <p className="px-3 py-4 text-[12px] text-[var(--muted)]">
                      No other active staff found.
                    </p>
                  ) : (
                    staffRoster.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="flex w-full items-center gap-2.5 border-b border-[rgba(32,48,80,0.06)] px-3 py-2.5 text-left hover:bg-[#f5f6f6]"
                        onClick={() => onOpenStaff(s.id)}
                      >
                        <Avatar name={s.fullName} kind="staff_dm" />
                        <div className="min-w-0 flex-1">
                          <span className="truncate text-[13px] font-semibold text-[var(--brand-deep)]">
                            {s.fullName}
                          </span>
                          <p className="truncate text-[11px] text-[var(--muted)]">
                            {s.empCode ? `${s.empCode} · ` : ""}
                            Staff
                          </p>
                        </div>
                      </button>
                    ))
                  ))}

                {tab === "parents" &&
                  !isParent &&
                  (parentRoster.length === 0 ? (
                    <p className="px-3 py-4 text-[12px] text-[var(--muted)]">
                      {actor?.roleCodes.includes("teacher")
                        ? "No parents in your assigned classes yet. Link class/subject duties in Staff."
                        : "No parent contacts for the current session."}
                    </p>
                  ) : (
                    parentRoster.map((p) => (
                      <button
                        key={p.householdId}
                        type="button"
                        className="flex w-full items-center gap-2.5 border-b border-[rgba(32,48,80,0.06)] px-3 py-2.5 text-left hover:bg-[#f5f6f6]"
                        onClick={() => onOpenParent(p.householdId)}
                      >
                        <Avatar name={p.guardianName} kind="staff_parent_dm" />
                        <div className="min-w-0 flex-1">
                          <span className="truncate text-[13px] font-semibold text-[var(--brand-deep)]">
                            {p.guardianName}
                          </span>
                          <p className="truncate text-[11px] text-[var(--muted)]">
                            {p.childNames.join(", ")}
                            {p.classLabels.length
                              ? ` · ${p.classLabels.join(", ")}`
                              : ""}
                          </p>
                        </div>
                      </button>
                    ))
                  ))}

                {tab === "parents" &&
                  isParent &&
                  (parentTeachers.length === 0 ? (
                    <p className="px-3 py-4 text-[12px] text-[var(--muted)]">
                      No assigned teachers found for your children.
                    </p>
                  ) : (
                    parentTeachers.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="flex w-full items-center gap-2.5 border-b border-[rgba(32,48,80,0.06)] px-3 py-2.5 text-left hover:bg-[#f5f6f6]"
                        onClick={() =>
                          actor?.householdId &&
                          onOpenParent(actor.householdId, t.id)
                        }
                      >
                        <Avatar name={t.fullName} kind="staff_parent_dm" />
                        <div className="min-w-0 flex-1">
                          <span className="truncate text-[13px] font-semibold text-[var(--brand-deep)]">
                            {t.fullName}
                          </span>
                          <p className="truncate text-[11px] text-[var(--muted)]">
                            Class / subject teacher
                          </p>
                        </div>
                      </button>
                    ))
                  ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-[rgba(32,48,80,0.08)] bg-[#f0f2f5] px-3 py-2">
                <Avatar
                  name={activeTitle}
                  kind={activeThread?.kind || "staff_dm"}
                />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-bold text-[var(--brand-deep)]">
                    {activeTitle}
                  </p>
                  <p className="text-[10px] text-[var(--muted)]">
                    {activeThread ? kindBadge(activeThread.kind) : ""}
                    {!canPost ? " · Read only" : ""}
                  </p>
                </div>
              </div>
              <div
                className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3"
                style={{
                  background:
                    "linear-gradient(180deg, #e5ddd5 0%, #d4cfc7 100%)",
                }}
              >
                {activeMessages.length === 0 ? (
                  <p className="rounded-lg bg-white/80 px-3 py-2 text-center text-[11px] text-[var(--muted)]">
                    {canPost
                      ? "Say hello — messages stay inside the school ERP."
                      : "Waiting for school updates…"}
                  </p>
                ) : (
                  activeMessages.map((m) => {
                    const mine = m.fromActorKey === meKey;
                    return (
                      <div
                        key={m.id}
                        className={`flex ${mine ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[12px] shadow-sm ${
                            mine
                              ? "rounded-br-sm bg-[#dcf8c6] text-[var(--brand-deep)]"
                              : "rounded-bl-sm bg-white text-[var(--brand-deep)]"
                          }`}
                        >
                          {!mine ? (
                            <p className="mb-0.5 text-[10px] font-bold text-[#075E54]">
                              {masters
                                ? actorDisplayName(
                                    masters,
                                    m.fromActorKey,
                                    parents,
                                    session,
                                  )
                                : ""}
                            </p>
                          ) : null}
                          <p className="whitespace-pre-wrap leading-snug">
                            {m.text}
                          </p>
                          <p className="mt-0.5 text-right text-[9px] text-[var(--muted)]">
                            {formatChatTime(m.at)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>
              {error ? (
                <p className="bg-[#fee2e2] px-3 py-1 text-[11px] text-[#b91c1c]">
                  {error}
                </p>
              ) : null}
              {canPost ? (
                <form
                  className="flex items-center gap-1.5 bg-[#f0f2f5] px-2 py-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onSend();
                  }}
                >
                  <input
                    ref={inputRef}
                    className="min-w-0 flex-1 rounded-full border-0 bg-white px-3 py-2 text-[13px] text-[var(--brand-deep)] shadow-sm outline-none ring-1 ring-[rgba(32,48,80,0.08)]"
                    placeholder="Type a message"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white disabled:opacity-40"
                    aria-label="Send"
                  >
                    <SendGlyph />
                  </button>
                </form>
              ) : (
                <p className="bg-[#f0f2f5] px-3 py-2 text-center text-[11px] text-[var(--muted)]">
                  Read-only class announcements
                </p>
              )}
            </>
          )}
          {error && !activeThreadId ? (
            <p className="bg-[#fee2e2] px-3 py-1 text-[11px] text-[#b91c1c]">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function defaultPrefsSafe(): ChatAlertPrefs {
  return { sound: true, browser: true, muted: false };
}

function kindBadge(kind: ErpChatThread["kind"]): string {
  if (kind === "staff_group") return "Group";
  if (kind === "staff_parent_dm") return "Parent";
  if (kind === "class_announcement") return "Announce";
  return "Staff";
}

function Avatar({
  name,
  kind,
}: {
  name: string;
  kind: ErpChatThread["kind"] | "staff_dm";
}) {
  const bg =
    kind === "class_announcement"
      ? "bg-[#203050]"
      : kind === "staff_group"
        ? "bg-[#128C7E]"
        : kind === "staff_parent_dm"
          ? "bg-[#075E54]"
          : "bg-[#128C7E]";
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${bg}`}
    >
      {staffInitials(name || "?")}
    </span>
  );
}

function WhatsAppGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function SendGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  );
}

/** Alias for parent portal / future imports */
export const ErpChatButton = StaffInternalChatButton;
