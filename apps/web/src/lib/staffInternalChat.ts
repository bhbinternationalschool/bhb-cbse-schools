/**
 * The first staff chat's shapes (v1, before the ERP chat). Nothing reads or
 * writes it any more — the header chat is school chat (29 Oct 2026). Kept
 * for the blob reset script's empty state only.
 */

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
export function threadIdFor(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `sct_${x}__${y}`;
}
