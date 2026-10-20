/**
 * The shape of one person's notifications, as the ERP bell and the apps
 * read it (GET /api/data/views/notifications, GET /api/v1/notifications).
 * Client-safe.
 */
import { isNotifyTopic, prefsFrom, type NotifyPrefs, type NotifyTopic, type Recipient } from "./kinds";

export type InboxItem = {
  id: string;
  kind: string;
  topic: NotifyTopic;
  title: string;
  body: string;
  titleHi: string;
  bodyHi: string;
  /** In-app route (phone). */
  link: string;
  /** ERP page. */
  webLink: string;
  payload: Record<string, unknown>;
  urgent: boolean;
  /** > 1 = a burst folded into this row. */
  groupCount: number;
  actor: string;
  readAt: string | null;
  createdAt: string;
  /** The row's revision (updated_at). */
  rev: string;
};

export type InboxView = {
  recipient: Recipient;
  items: InboxItem[];
  unread: number;
  prefs: NotifyPrefs;
  /** The settings row's revision; null = never saved (the defaults). */
  prefsRev: string | null;
};

export function inboxItemFromRow(row: Record<string, unknown>): InboxItem | null {
  const id = typeof row.id === "string" ? row.id : "";
  const title = typeof row.title === "string" ? row.title : "";
  if (!id || !title) return null;
  const s = (k: string) => (typeof row[k] === "string" ? (row[k] as string) : "");
  return {
    id,
    kind: s("kind"),
    topic: isNotifyTopic(row.topic) ? row.topic : "notice",
    title,
    body: s("body"),
    titleHi: s("title_hi"),
    bodyHi: s("body_hi"),
    link: s("link"),
    webLink: s("web_link") || s("link"),
    payload: row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : {},
    urgent: row.urgent === true,
    groupCount: typeof row.group_count === "number" && row.group_count > 0 ? row.group_count : 1,
    actor: s("actor"),
    readAt: typeof row.read_at === "string" ? row.read_at : null,
    createdAt: s("created_at"),
    rev: s("updated_at"),
  };
}

/** Check an answer's shape (the bell's useErpQuery parse); throws on a malformed one. */
export function parseInboxView(data: unknown): InboxView {
  const d = data as Partial<InboxView> | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.items) || typeof d.unread !== "number" || !d.recipient) {
    throw new Error("notifications: malformed answer");
  }
  return {
    recipient: d.recipient,
    items: d.items,
    unread: d.unread,
    prefs: prefsFrom(d.prefs),
    prefsRev: typeof d.prefsRev === "string" ? d.prefsRev : null,
  };
}
