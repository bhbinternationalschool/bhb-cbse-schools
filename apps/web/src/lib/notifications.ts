/**
 * In-app notifications — bell + read state for staff and parents.
 * Store: localStorage `bhb_notifications_v1` + Supabase blob.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { getSessionActor } from "@/lib/sessionActor";
import type { CommsAudience } from "@/lib/schoolComms";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

const STORAGE_KEY = "bhb_notifications_v1";

export type NotificationKind =
  | "notice"
  | "news"
  | "gallery"
  | "fees"
  | "homework"
  | "leave"
  | "ptm"
  | "system";

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  kind: NotificationKind;
  href: string;
  audience: CommsAudience;
  sourceId: string;
  createdAt: string;
  /** Persona keys that have read: staff:<staffId|email>, parent:<mobile|name> */
  readBy: string[];
};

export type NotificationsState = {
  version: 1;
  items: AppNotification[];
};

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
function nowIso() {
  return new Date().toISOString();
}

export function emptyNotifications(): NotificationsState {
  return { version: 1, items: [] };
}

export function loadNotifications(): NotificationsState {
  if (typeof window === "undefined") return emptyNotifications();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyNotifications();
    const parsed = JSON.parse(raw) as Partial<NotificationsState>;
    return {
      version: 1,
      items: Array.isArray(parsed.items) ? (parsed.items as AppNotification[]) : [],
    };
  } catch {
    return emptyNotifications();
  }
}

export function writeNotificationsLocalRaw(state: NotificationsState): void {
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
}

export function notificationsIsEmpty(state: NotificationsState): boolean {
  return (state.items?.length ?? 0) === 0;
}

export function saveNotifications(state: NotificationsState): void {
  if (typeof window === "undefined") return;
  writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(state));
  void import("@/lib/notificationsPersistence").then(
    ({ scheduleNotificationsSync }) => {
      scheduleNotificationsSync(state);
    },
  );
}

export function recipientKey(opts: {
  persona: "staff" | "parent" | "field" | "student";
  staffId?: string;
  email?: string;
  fullName?: string;
  mobile?: string;
}): string {
  if (opts.persona === "staff") {
    return `staff:${opts.staffId || opts.email || opts.fullName || "anon"}`;
  }
  if (opts.persona === "parent") {
    return `parent:${opts.mobile || opts.fullName || "anon"}`;
  }
  return `${opts.persona}:${opts.fullName || "anon"}`;
}

export function pushNotification(input: {
  title: string;
  body: string;
  kind: NotificationKind;
  href?: string;
  audience?: CommsAudience;
  sourceId?: string;
}): AppNotification {
  const state = loadNotifications();
  const item: AppNotification = {
    id: nid("nf"),
    title: input.title.trim() || "Notification",
    body: (input.body || "").trim().slice(0, 280),
    kind: input.kind,
    href: input.href || "/home",
    audience: input.audience || "all",
    sourceId: input.sourceId || "",
    createdAt: nowIso(),
    readBy: [],
  };
  // Dedupe same source within 2 minutes
  if (item.sourceId) {
    const recent = state.items.find(
      (x) =>
        x.sourceId === item.sourceId &&
        x.kind === item.kind &&
        Date.now() - new Date(x.createdAt).getTime() < 120_000,
    );
    if (recent) return recent;
  }
  const next = {
    version: 1 as const,
    items: [item, ...state.items].slice(0, 300),
  };
  saveNotifications(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("bhb-notifications"));
  }
  return item;
}

function matchesAudience(
  item: AppNotification,
  persona: "staff" | "parent" | "field" | "student",
): boolean {
  if (item.audience === "all") return true;
  if (item.audience === "staff") return persona === "staff";
  if (item.audience === "parents") return persona === "parent";
  if (item.audience === "students") return persona === "student";
  return true;
}

export function listNotificationsFor(
  key: string,
  persona: "staff" | "parent" | "field" | "student",
  state?: NotificationsState,
): AppNotification[] {
  const s = state ?? loadNotifications();
  return s.items
    .filter((i) => matchesAudience(i, persona))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function unreadCountFor(
  key: string,
  persona: "staff" | "parent" | "field" | "student",
  state?: NotificationsState,
): number {
  return listNotificationsFor(key, persona, state).filter(
    (i) => !i.readBy.includes(key),
  ).length;
}

export function markNotificationRead(
  id: string,
  key: string,
): NotificationsState {
  const state = loadNotifications();
  const next = {
    ...state,
    items: state.items.map((i) =>
      i.id === id && !i.readBy.includes(key)
        ? { ...i, readBy: [...i.readBy, key] }
        : i,
    ),
  };
  saveNotifications(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("bhb-notifications"));
  }
  return next;
}

export function markAllNotificationsRead(
  key: string,
  persona: "staff" | "parent" | "field" | "student",
): NotificationsState {
  const state = loadNotifications();
  const next = {
    ...state,
    items: state.items.map((i) => {
      if (!matchesAudience(i, persona)) return i;
      if (i.readBy.includes(key)) return i;
      return { ...i, readBy: [...i.readBy, key] };
    }),
  };
  saveNotifications(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("bhb-notifications"));
  }
  return next;
}

/** Soft clear (admin) — keeps last 50 */
export function pruneNotifications(): NotificationsState {
  if (!assertModulePermission("notifications", "edit", "pruneNotifications")) {
    return loadNotifications();
  }
  const state = loadNotifications();
  const next = { ...state, items: state.items.slice(0, 50) };
  saveNotifications(next);
  return next;
}

export function currentStaffRecipientKey(): string {
  const actor = getSessionActor();
  return recipientKey({
    persona: "staff",
    staffId: actor?.staffId,
    email: actor?.email,
    fullName: actor?.fullName,
  });
}
