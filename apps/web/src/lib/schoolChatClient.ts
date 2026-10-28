/**
 * School chat — what the web ERP reads and how it posts (client-safe).
 * Shapes are the server's (lib/schoolChat.server.ts), imported as types only.
 */
import { erpFetch } from "@/lib/data/erpFetch";
import type {
  BehaviourRow,
  ChatMessageOut,
  ConversationAccess,
  ConversationSummary,
  QueueItem,
} from "@/lib/schoolChat.server";
import type { ChatBlock } from "@/lib/schoolChat";

export type ConversationsView = {
  conversations: ConversationSummary[];
  blocked: boolean;
  muted: boolean;
  moderator: boolean;
  me: { kind: "staff"; staffId: string } | { kind: "family"; studentId: string; section: string };
};
export type MessagesView = {
  conversation: ConversationAccess & { canSend: boolean; muted: boolean; moderator: boolean };
  messages: ChatMessageOut[];
};
export type ContactsView = {
  staff: { id: string; name: string; role: string }[];
  families: { studentId: string; label: string }[];
  /** Sections the caller may add to a new group (staff). */
  sections: { classId: string; sectionId: string; label: string }[];
};
export type QueueView = { items: QueueItem[] };
export type BlocksView = { blocks: (ChatBlock & { liftedAt: string | null; liftReason: string })[] };
export type BehaviourView = {
  days: number;
  since: string;
  totals: { sent: number; held: number; removed: number; warned: number; flagged: number };
  people: BehaviourRow[];
};

/** One POST; a refusal comes back as {ok:false, error} with the server's words. */
export async function chatPost<T = unknown>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  let res: Response;
  try {
    res = await erpFetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, error: "Could not reach the server — check the connection and try again.", status: 0 };
  }
  const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: string | { message?: string } } | null;
  if (res.ok && j?.ok) return { ok: true, data: j.data as T };
  const e = j?.error;
  return { ok: false, error: (typeof e === "string" ? e : e?.message) || `Request failed (${res.status})`, status: res.status };
}
