/**
 * Internal staff chat (ERP) — WhatsApp-style DMs between active staff.
 * Demo store: localStorage `bhb_staff_chat_v1` (+ optional remote blob).
 */

import type { MastersState } from "@/lib/masters";
import type { StaffRecord } from "@/lib/foundationMasters";
import { resolveSessionStaff } from "@/lib/staffResolve";
import type { SessionLike } from "@/lib/rbac";

export type StaffChatMessage = {
  id: string;
  threadId: string;
  fromStaffId: string;
  text: string;
  at: string;
  /** Peer staff ids who have read this message */
  readBy: string[];
};

export type StaffChatThread = {
  id: string;
  /** Sorted pair of staff ids — always two participants for DM */
  participantIds: [string, string];
  updatedAt: string;
};

export type StaffChatState = {
  version: 1;
  threads: StaffChatThread[];
  messages: StaffChatMessage[];
};

const STORAGE_KEY = "bhb_staff_chat_v1";

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

export function emptyStaffChatState(): StaffChatState {
  return { version: 1, threads: [], messages: [] };
}

function normalizeMessage(m: Partial<StaffChatMessage>): StaffChatMessage | null {
  if (!m.threadId || !m.fromStaffId || !m.text) return null;
  return {
    id: m.id || nid("scm"),
    threadId: m.threadId,
    fromStaffId: m.fromStaffId,
    text: String(m.text).slice(0, 4000),
    at: m.at || nowIso(),
    readBy: Array.isArray(m.readBy)
      ? m.readBy.map(String).filter(Boolean)
      : [],
  };
}

function normalizeThread(t: Partial<StaffChatThread>): StaffChatThread | null {
  const ids = Array.isArray(t.participantIds)
    ? [...t.participantIds].map(String).filter(Boolean)
    : [];
  if (ids.length !== 2 || ids[0] === ids[1]) return null;
  const sorted = [...ids].sort() as [string, string];
  return {
    id: t.id || threadIdFor(sorted[0], sorted[1]),
    participantIds: sorted,
    updatedAt: t.updatedAt || nowIso(),
  };
}

export function normalizeStaffChatState(raw: unknown): StaffChatState {
  if (!raw || typeof raw !== "object") return emptyStaffChatState();
  const p = raw as Partial<StaffChatState>;
  return {
    version: 1,
    threads: Array.isArray(p.threads)
      ? p.threads.map(normalizeThread).filter((x): x is StaffChatThread => !!x)
      : [],
    messages: Array.isArray(p.messages)
      ? p.messages
          .map(normalizeMessage)
          .filter((x): x is StaffChatMessage => !!x)
      : [],
  };
}

export function loadStaffChat(): StaffChatState {
  if (typeof window === "undefined") return emptyStaffChatState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStaffChatState();
    return normalizeStaffChatState(JSON.parse(raw));
  } catch {
    return emptyStaffChatState();
  }
}

export function saveStaffChat(state: StaffChatState) {
  if (typeof window === "undefined") return;
  const next = normalizeStaffChatState(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("bhb-staff-chat"));
  void import("@/lib/staffChatPersistence").then(({ scheduleStaffChatSync }) => {
    scheduleStaffChatSync(next);
  });
}

export function writeStaffChatLocalRaw(state: StaffChatState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(normalizeStaffChatState(state)),
  );
}

export function staffChatStateIsEmpty(state: StaffChatState): boolean {
  return (state.threads?.length ?? 0) === 0 && (state.messages?.length ?? 0) === 0;
}

export function threadIdFor(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `sct_${x}__${y}`;
}

export function peerId(thread: StaffChatThread, me: string): string {
  return thread.participantIds[0] === me
    ? thread.participantIds[1]!
    : thread.participantIds[0]!;
}

export function findOrCreateThread(
  me: string,
  peer: string,
  state?: StaffChatState,
): { state: StaffChatState; thread: StaffChatThread } {
  const s = state ?? loadStaffChat();
  const id = threadIdFor(me, peer);
  const existing = s.threads.find((t) => t.id === id);
  if (existing) return { state: s, thread: existing };
  const thread = normalizeThread({
    id,
    participantIds: [me, peer],
    updatedAt: nowIso(),
  })!;
  const next = { ...s, threads: [thread, ...s.threads] };
  return { state: next, thread };
}

export function listActiveStaffForChat(
  masters: MastersState,
  meStaffId: string | null,
): StaffRecord[] {
  return (masters.staff ?? [])
    .filter((s) => s.status === "active" && s.id !== meStaffId)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export function messagesForThread(
  threadId: string,
  state?: StaffChatState,
): StaffChatMessage[] {
  const s = state ?? loadStaffChat();
  return s.messages
    .filter((m) => m.threadId === threadId)
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function lastMessageForThread(
  threadId: string,
  state?: StaffChatState,
): StaffChatMessage | undefined {
  const msgs = messagesForThread(threadId, state);
  return msgs[msgs.length - 1];
}

export function unreadInThread(
  threadId: string,
  meStaffId: string,
  state?: StaffChatState,
): number {
  const s = state ?? loadStaffChat();
  return s.messages.filter(
    (m) =>
      m.threadId === threadId &&
      m.fromStaffId !== meStaffId &&
      !m.readBy.includes(meStaffId),
  ).length;
}

export function totalUnreadForStaff(
  meStaffId: string,
  state?: StaffChatState,
): number {
  const s = state ?? loadStaffChat();
  return s.messages.filter(
    (m) => m.fromStaffId !== meStaffId && !m.readBy.includes(meStaffId),
  ).length;
}

export function sendStaffChatMessage(input: {
  fromStaffId: string;
  toStaffId: string;
  text: string;
}):
  | { ok: true; state: StaffChatState; thread: StaffChatThread; message: StaffChatMessage }
  | { ok: false; error: string } {
  const text = input.text.trim();
  if (!text) return { ok: false, error: "Type a message" };
  if (!input.fromStaffId || !input.toStaffId) {
    return { ok: false, error: "Pick a teammate to chat with" };
  }
  if (input.fromStaffId === input.toStaffId) {
    return { ok: false, error: "Cannot chat with yourself" };
  }
  let { state, thread } = findOrCreateThread(
    input.fromStaffId,
    input.toStaffId,
  );
  const message = normalizeMessage({
    id: nid("scm"),
    threadId: thread.id,
    fromStaffId: input.fromStaffId,
    text,
    at: nowIso(),
    readBy: [input.fromStaffId],
  })!;
  thread = {
    ...thread,
    updatedAt: message.at,
  };
  state = {
    ...state,
    threads: [
      thread,
      ...state.threads.filter((t) => t.id !== thread.id),
    ],
    messages: [...state.messages, message],
  };
  saveStaffChat(state);
  return { ok: true, state, thread, message };
}

export function markThreadRead(
  threadId: string,
  meStaffId: string,
): StaffChatState {
  const state = loadStaffChat();
  let changed = false;
  const messages = state.messages.map((m) => {
    if (m.threadId !== threadId) return m;
    if (m.fromStaffId === meStaffId) return m;
    if (m.readBy.includes(meStaffId)) return m;
    changed = true;
    return { ...m, readBy: [...m.readBy, meStaffId] };
  });
  if (!changed) return state;
  const next = { ...state, messages };
  saveStaffChat(next);
  return next;
}

export function threadsForStaff(
  meStaffId: string,
  state?: StaffChatState,
): StaffChatThread[] {
  const s = state ?? loadStaffChat();
  return s.threads
    .filter((t) => t.participantIds.includes(meStaffId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function staffChatSelfId(
  session: SessionLike,
  masters: MastersState,
): string {
  const self = resolveSessionStaff(session, masters);
  if (self?.id) return self.id;
  if (session.staffId) return session.staffId;
  const seed = (session.email || session.fullName || "staff")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 24);
  return `sess_${seed || "user"}`;
}

export function staffDisplayName(
  masters: MastersState,
  staffId: string,
  sessionFallback?: SessionLike,
): string {
  if (staffId.startsWith("sess_") && sessionFallback) {
    return sessionFallback.fullName || "You";
  }
  const s = (masters.staff ?? []).find((x) => x.id === staffId);
  return s?.fullName || staffId;
}

export function staffInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function formatChatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}
