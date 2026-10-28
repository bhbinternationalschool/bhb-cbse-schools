/**
 * The OLD header chat's shapes and pure helpers (staff DMs/groups,
 * staff–parent DMs, class announcements). Nothing writes this chat any more:
 * since 29 Oct 2026 the header chat is school chat (lib/schoolChat*.ts,
 * rows in the database). Kept only for what still reads its old rows (the
 * message logs read the erp_chat_state blob) and chatSelfFromSession.
 */

import type { MastersState } from "@/lib/masters";
import {
  canCreateClassAnnouncement,
  canCreateStaffGroup,
  parentActorKey,
  parseParentActorKey,
  resolveChatActor,
  type ChatActor,
  type ChatParentContact,
  type ChatSectionRef,
} from "@/lib/erpChatAccess";
import type { SessionLike } from "@/lib/rbac";
import { resolveSessionStaff } from "@/lib/staffResolve";
import type { SisState } from "@/lib/sis";
import type { StaffRecord } from "@/lib/foundationMasters";

export type ErpChatThreadKind =
  | "staff_dm"
  | "staff_group"
  | "staff_parent_dm"
  | "class_announcement";

export type ErpChatParticipant = {
  actorKey: string;
  actorKind: "staff" | "parent";
  canPost: boolean;
};

export type ErpChatMessage = {
  id: string;
  threadId: string;
  fromActorKey: string;
  fromActorKind: "staff" | "parent";
  text: string;
  at: string;
  readBy: string[];
};

export type ErpChatThread = {
  id: string;
  kind: ErpChatThreadKind;
  title: string;
  participantIds: string[];
  participants: ErpChatParticipant[];
  classId: string;
  sectionId: string;
  householdId: string;
  academicYearCode: string;
  createdBy: string;
  updatedAt: string;
  createdAt: string;
};

export type ErpChatState = {
  version: 2;
  threads: ErpChatThread[];
  messages: ErpChatMessage[];
};

export const ERP_CHAT_EVENT = "bhb-erp-chat";

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

export function emptyErpChatState(): ErpChatState {
  return { version: 2, threads: [], messages: [] };
}

function normalizeParticipant(
  p: Partial<ErpChatParticipant>,
): ErpChatParticipant | null {
  if (!p.actorKey) return null;
  return {
    actorKey: String(p.actorKey),
    actorKind: p.actorKind === "parent" ? "parent" : "staff",
    canPost: p.canPost !== false,
  };
}

function normalizeMessage(m: Partial<ErpChatMessage>): ErpChatMessage | null {
  if (!m.threadId || !m.fromActorKey || !m.text) return null;
  return {
    id: m.id || nid("ecm"),
    threadId: m.threadId,
    fromActorKey: String(m.fromActorKey),
    fromActorKind: m.fromActorKind === "parent" ? "parent" : "staff",
    text: String(m.text).slice(0, 4000),
    at: m.at || nowIso(),
    readBy: Array.isArray(m.readBy)
      ? m.readBy.map(String).filter(Boolean)
      : [],
  };
}

function normalizeThread(t: Partial<ErpChatThread>): ErpChatThread | null {
  const kind = (t.kind || "staff_dm") as ErpChatThreadKind;
  if (
    ![
      "staff_dm",
      "staff_group",
      "staff_parent_dm",
      "class_announcement",
    ].includes(kind)
  ) {
    return null;
  }

  let participants = Array.isArray(t.participants)
    ? t.participants
        .map(normalizeParticipant)
        .filter((x): x is ErpChatParticipant => !!x)
    : [];

  if (!participants.length && Array.isArray(t.participantIds)) {
    participants = t.participantIds.map(String).filter(Boolean).map((id) => ({
      actorKey: id,
      actorKind: (parseParentActorKey(id) ? "parent" : "staff") as
        | "staff"
        | "parent",
      canPost: kind !== "class_announcement" || !parseParentActorKey(id),
    }));
  }

  if (kind === "staff_dm" && participants.length !== 2) return null;
  if (kind === "staff_parent_dm" && participants.length < 2) return null;
  if (kind === "staff_group" && participants.length < 2) return null;
  if (kind === "class_announcement" && !t.sectionId) return null;

  const participantIds = [
    ...new Set(participants.map((p) => p.actorKey)),
  ].sort();

  return {
    id: t.id || nid("ect"),
    kind,
    title: String(t.title || "").slice(0, 120),
    participantIds,
    participants,
    classId: String(t.classId || ""),
    sectionId: String(t.sectionId || ""),
    householdId: String(t.householdId || ""),
    academicYearCode: String(t.academicYearCode || ""),
    createdBy: String(t.createdBy || ""),
    updatedAt: t.updatedAt || nowIso(),
    createdAt: t.createdAt || nowIso(),
  };
}

export function normalizeErpChatState(raw: unknown): ErpChatState {
  if (!raw || typeof raw !== "object") return emptyErpChatState();
  const p = raw as Record<string, unknown> & {
    version?: number;
    threads?: unknown;
    messages?: unknown;
  };

  // Import legacy staff DM blob (v1)
  const isLegacyV1 =
    p.version === 1 ||
    (Array.isArray(p.messages) &&
      (p.messages as Array<{ fromStaffId?: string }>).some(
        (m) => typeof m?.fromStaffId === "string",
      ));
  if (isLegacyV1) {
    const legacy = raw as {
      threads?: Array<{
        id?: string;
        participantIds?: string[];
        updatedAt?: string;
      }>;
      messages?: Array<{
        id?: string;
        threadId?: string;
        fromStaffId?: string;
        text?: string;
        at?: string;
        readBy?: string[];
      }>;
    };
    const threads: ErpChatThread[] = [];
    for (const t of legacy.threads ?? []) {
      const ids = (t.participantIds ?? []).map(String).filter(Boolean);
      if (ids.length !== 2) continue;
      const normalized = normalizeThread({
        id: t.id || staffDmThreadId(ids[0]!, ids[1]!),
        kind: "staff_dm",
        participantIds: ids,
        participants: ids.map((id) => ({
          actorKey: id,
          actorKind: "staff",
          canPost: true,
        })),
        updatedAt: t.updatedAt,
        createdAt: t.updatedAt,
      });
      if (normalized) threads.push(normalized);
    }
    const messages = (legacy.messages ?? [])
      .map((m) =>
        normalizeMessage({
          id: m.id,
          threadId: m.threadId,
          fromActorKey: m.fromStaffId,
          fromActorKind: "staff",
          text: m.text,
          at: m.at,
          readBy: m.readBy,
        }),
      )
      .filter((x): x is ErpChatMessage => !!x);
    return { version: 2, threads, messages };
  }

  return {
    version: 2,
    threads: Array.isArray(p.threads)
      ? p.threads.map(normalizeThread).filter((x): x is ErpChatThread => !!x)
      : [],
    messages: Array.isArray(p.messages)
      ? p.messages
          .map(normalizeMessage)
          .filter((x): x is ErpChatMessage => !!x)
      : [],
  };
}

/** Union threads/messages by id; prefer newer updatedAt / keep both messages. */
export function mergeErpChatStates(
  a: ErpChatState,
  b: ErpChatState,
): ErpChatState {
  const threadMap = new Map<string, ErpChatThread>();
  for (const t of [...a.threads, ...b.threads]) {
    const prev = threadMap.get(t.id);
    if (!prev || t.updatedAt >= prev.updatedAt) threadMap.set(t.id, t);
  }
  const msgMap = new Map<string, ErpChatMessage>();
  for (const m of [...a.messages, ...b.messages]) {
    const prev = msgMap.get(m.id);
    if (!prev) {
      msgMap.set(m.id, m);
      continue;
    }
    const readBy = [...new Set([...prev.readBy, ...m.readBy])];
    msgMap.set(m.id, {
      ...(m.at >= prev.at ? m : prev),
      readBy,
    });
  }
  return normalizeErpChatState({
    version: 2,
    threads: [...threadMap.values()],
    messages: [...msgMap.values()],
  });
}

export function erpChatStateIsEmpty(state: ErpChatState): boolean {
  return (state.threads?.length ?? 0) === 0 && (state.messages?.length ?? 0) === 0;
}

export function staffDmThreadId(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `sdm_${x}__${y}`;
}

export function staffParentDmThreadId(
  staffId: string,
  householdId: string,
): string {
  return `spm_${staffId}__${householdId}`;
}

export function classAnnouncementThreadId(
  academicYearCode: string,
  sectionId: string,
): string {
  return `ann_${academicYearCode}_${sectionId}`;
}

export function messagesForThread(
  threadId: string,
  state?: ErpChatState,
): ErpChatMessage[] {
  const s = state ?? emptyErpChatState();
  return s.messages
    .filter((m) => m.threadId === threadId)
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function lastMessageForThread(
  threadId: string,
  state?: ErpChatState,
): ErpChatMessage | undefined {
  const msgs = messagesForThread(threadId, state);
  return msgs[msgs.length - 1];
}

export function unreadInThread(
  threadId: string,
  actorKey: string,
  state?: ErpChatState,
): number {
  const s = state ?? emptyErpChatState();
  return s.messages.filter(
    (m) =>
      m.threadId === threadId &&
      m.fromActorKey !== actorKey &&
      !m.readBy.includes(actorKey),
  ).length;
}

export function totalUnreadForActor(
  actorKey: string,
  state?: ErpChatState,
): number {
  const s = state ?? emptyErpChatState();
  const myThreadIds = new Set(
    s.threads
      .filter((t) => t.participantIds.includes(actorKey))
      .map((t) => t.id),
  );
  return s.messages.filter(
    (m) =>
      myThreadIds.has(m.threadId) &&
      m.fromActorKey !== actorKey &&
      !m.readBy.includes(actorKey),
  ).length;
}

export function threadsForActor(
  actorKey: string,
  state?: ErpChatState,
): ErpChatThread[] {
  const s = state ?? emptyErpChatState();
  return s.threads
    .filter((t) => t.participantIds.includes(actorKey))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function actorCanPost(
  thread: ErpChatThread,
  actorKey: string,
): boolean {
  const p = thread.participants.find((x) => x.actorKey === actorKey);
  if (!p) return false;
  return p.canPost !== false;
}

export function findOrCreateStaffDm(
  meStaffId: string,
  peerStaffId: string,
  state?: ErpChatState,
): { state: ErpChatState; thread: ErpChatThread } {
  const s = state ?? emptyErpChatState();
  const id = staffDmThreadId(meStaffId, peerStaffId);
  const existing = s.threads.find((t) => t.id === id);
  if (existing) return { state: s, thread: existing };
  const thread = normalizeThread({
    id,
    kind: "staff_dm",
    participants: [
      { actorKey: meStaffId, actorKind: "staff", canPost: true },
      { actorKey: peerStaffId, actorKind: "staff", canPost: true },
    ],
    createdBy: meStaffId,
  })!;
  return { state: { ...s, threads: [thread, ...s.threads] }, thread };
}

export function findOrCreateStaffParentDm(input: {
  staffId: string;
  householdId: string;
  academicYearCode: string;
  state?: ErpChatState;
}): { state: ErpChatState; thread: ErpChatThread } {
  const s = input.state ?? emptyErpChatState();
  const hhKey = parentActorKey(input.householdId);
  const id = staffParentDmThreadId(input.staffId, input.householdId);
  const existing = s.threads.find((t) => t.id === id);
  if (existing) return { state: s, thread: existing };
  const thread = normalizeThread({
    id,
    kind: "staff_parent_dm",
    householdId: input.householdId,
    academicYearCode: input.academicYearCode,
    participants: [
      { actorKey: input.staffId, actorKind: "staff", canPost: true },
      { actorKey: hhKey, actorKind: "parent", canPost: true },
    ],
    createdBy: input.staffId,
  })!;
  return { state: { ...s, threads: [thread, ...s.threads] }, thread };
}

export function findOrCreateClassAnnouncement(input: {
  section: ChatSectionRef;
  academicYearCode: string;
  createdBy: string;
  parentHouseholdIds: string[];
  state?: ErpChatState;
}): { state: ErpChatState; thread: ErpChatThread } {
  const s = input.state ?? emptyErpChatState();
  const id = classAnnouncementThreadId(
    input.academicYearCode,
    input.section.sectionId,
  );
  const existing = s.threads.find((t) => t.id === id);
  if (existing) {
    // Ensure new parents are participants (read-only)
    const known = new Set(existing.participantIds);
    const added: ErpChatParticipant[] = [];
    for (const hh of input.parentHouseholdIds) {
      const key = parentActorKey(hh);
      if (!known.has(key)) {
        added.push({
          actorKey: key,
          actorKind: "parent",
          canPost: false,
        });
      }
    }
    if (!added.length) return { state: s, thread: existing };
    const participants = [...existing.participants, ...added];
    const thread = normalizeThread({
      ...existing,
      participants,
      updatedAt: nowIso(),
    })!;
    const next = {
      ...s,
      threads: [thread, ...s.threads.filter((t) => t.id !== thread.id)],
    };
    return { state: next, thread };
  }

  const participants: ErpChatParticipant[] = [
    {
      actorKey: input.createdBy,
      actorKind: "staff",
      canPost: true,
    },
    ...input.parentHouseholdIds.map((hh) => ({
      actorKey: parentActorKey(hh),
      actorKind: "parent" as const,
      canPost: false,
    })),
  ];

  const thread = normalizeThread({
    id,
    kind: "class_announcement",
    title: `${input.section.label} announcements`,
    classId: input.section.classId,
    sectionId: input.section.sectionId,
    academicYearCode: input.academicYearCode,
    createdBy: input.createdBy,
    participants,
  })!;
  return { state: { ...s, threads: [thread, ...s.threads] }, thread };
}

export function listActiveStaffForChat(
  masters: MastersState,
  meStaffId: string | null,
): StaffRecord[] {
  return (masters.staff ?? [])
    .filter((s) => s.status === "active" && s.id !== meStaffId)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
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

export function actorDisplayName(
  masters: MastersState,
  actorKey: string,
  parents?: ChatParentContact[],
  sessionFallback?: SessionLike,
): string {
  const hh = parseParentActorKey(actorKey);
  if (hh) {
    const hit = parents?.find((p) => p.householdId === hh);
    return hit?.guardianName || "Parent";
  }
  return staffDisplayName(masters, actorKey, sessionFallback);
}

export function threadTitle(
  thread: ErpChatThread,
  meKey: string,
  masters: MastersState,
  parents?: ChatParentContact[],
): string {
  if (thread.title) return thread.title;
  if (thread.kind === "staff_dm") {
    const peer = thread.participantIds.find((id) => id !== meKey) || "";
    return staffDisplayName(masters, peer);
  }
  if (thread.kind === "staff_parent_dm") {
    const hh = thread.householdId;
    const parent = parents?.find((p) => p.householdId === hh);
    if (meKey.startsWith("hh:")) {
      const staffId = thread.participantIds.find((id) => !id.startsWith("hh:"));
      return staffId ? staffDisplayName(masters, staffId) : "Teacher";
    }
    return parent
      ? `${parent.guardianName}${parent.childNames.length ? ` · ${parent.childNames.join(", ")}` : ""}`
      : "Parent";
  }
  if (thread.kind === "class_announcement") {
    return thread.title || "Class announcements";
  }
  return thread.title || "Group";
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

export function chatSelfFromSession(
  session: SessionLike & { householdId?: string; academicYearCode?: string },
  masters: MastersState,
  sis?: SisState,
): ChatActor | null {
  return resolveChatActor(session, masters, sis);
}

/** Legacy helper used by older staff chat UI */
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

export { canCreateStaffGroup, canCreateClassAnnouncement };
