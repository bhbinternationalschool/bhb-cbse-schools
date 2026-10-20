/**
 * What can be notified, and how each kind behaves (director, 15 Oct 2026:
 * "every activity notification should reach the ERP as well as the app,
 * with voice notification, to every user based on roles"). Pure — shared by
 * the server (lib/notify/notify.server.ts), the ERP bell and the self-tests.
 *
 *   kind   what happened ('staff_leave.requested'); stored on the row
 *   topic  the group a person mutes in settings, and the spoken line the
 *          phone plays (lib/pushVoice.ts: channel bhb_voice_<topic>_<hi|en>)
 */
import type { PushVoiceKind } from "@/lib/pushVoice";

export type NotifyTopic = PushVoiceKind;

export const NOTIFY_TOPICS: readonly NotifyTopic[] = [
  "approval",
  "leave",
  "document",
  "message",
  "fees",
  "homework",
  "attendance",
  "notice",
] as const;

export const NOTIFY_TOPIC_LABELS: Record<NotifyTopic, { en: string; hi: string }> = {
  approval: { en: "Approvals", hi: "मंज़ूरी" },
  leave: { en: "Leave", hi: "छुट्टी" },
  document: { en: "Documents", hi: "दस्तावेज़" },
  message: { en: "Messages", hi: "संदेश" },
  fees: { en: "Fees & receipts", hi: "फीस व रसीद" },
  homework: { en: "Homework", hi: "होमवर्क" },
  attendance: { en: "Attendance", hi: "हाज़िरी" },
  notice: { en: "Notices", hi: "सूचनाएँ" },
};

export type NotifyKindDef = {
  topic: NotifyTopic;
  /** Rings even in quiet hours (and cannot be muted away from the bell). */
  urgent: boolean;
  /** Short description for the PR table and the settings screen. */
  what: string;
};

export const NOTIFY_KINDS = {
  "staff_leave.requested": { topic: "leave", urgent: false, what: "A member of staff applied for leave" },
  "staff_leave.decided": { topic: "leave", urgent: false, what: "Your leave was approved / not approved" },
  "student_leave.requested": { topic: "leave", urgent: false, what: "A parent asked leave for a child" },
  "student_leave.decided": { topic: "leave", urgent: false, what: "The school decided your child's leave" },
  "staff_request.raised": { topic: "approval", urgent: false, what: "A member of staff raised a request" },
  "staff_request.updated": { topic: "approval", urgent: false, what: "Your request was assigned / resolved" },
  "gallery.held": { topic: "approval", urgent: false, what: "A class photo is waiting for review" },
  "document.received": { topic: "document", urgent: false, what: "A family sent a document" },
  "document.reviewed": { topic: "document", urgent: false, what: "Your document was verified / needs another upload" },
  "message.chat": { topic: "message", urgent: false, what: "A new chat message" },
  "complaint.created": { topic: "message", urgent: false, what: "A family raised a complaint" },
  "fees.received": { topic: "fees", urgent: false, what: "A fee was received" },
  "fees.receipt": { topic: "fees", urgent: false, what: "Your fee receipt" },
} as const satisfies Record<string, NotifyKindDef>;

export type NotifyKind = keyof typeof NOTIFY_KINDS;

export function isNotifyKind(k: string): k is NotifyKind {
  return Object.prototype.hasOwnProperty.call(NOTIFY_KINDS, k);
}

export function isNotifyTopic(t: unknown): t is NotifyTopic {
  return typeof t === "string" && (NOTIFY_TOPICS as readonly string[]).includes(t);
}

export type RecipientType = "staff" | "parent";
export type Recipient = { type: RecipientType; id: string };

export function recipientKey(r: Recipient): string {
  return `${r.type}:${r.id}`;
}

/** The erp_notification_prefs row id for one person. */
export function prefsRowId(r: Recipient): string {
  return `nfp_${r.type}_${r.id}`;
}

export type NotifyPrefs = {
  mutedTopics: NotifyTopic[];
  voice: boolean;
  quietEnabled: boolean;
  /** 'HH:MM', India time. */
  quietStart: string;
  quietEnd: string;
};

/** The director's defaults: everything on, voice on, silent 9 pm – 7 am except urgent. */
export const DEFAULT_PREFS: NotifyPrefs = {
  mutedTopics: [],
  voice: true,
  quietEnabled: true,
  quietStart: "21:00",
  quietEnd: "07:00",
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isHhMm(v: unknown): v is string {
  return typeof v === "string" && HHMM.test(v);
}

/** A stored / posted settings object as prefs; unknown fields dropped, bad ones defaulted. */
export function prefsFrom(raw: unknown): NotifyPrefs {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const muted = Array.isArray(o.mutedTopics ?? o.muted_topics) ? ((o.mutedTopics ?? o.muted_topics) as unknown[]) : [];
  const qs = o.quietStart ?? o.quiet_start;
  const qe = o.quietEnd ?? o.quiet_end;
  const qen = o.quietEnabled ?? o.quiet_enabled;
  return {
    mutedTopics: [...new Set(muted.filter(isNotifyTopic))],
    voice: typeof o.voice === "boolean" ? o.voice : DEFAULT_PREFS.voice,
    quietEnabled: typeof qen === "boolean" ? qen : DEFAULT_PREFS.quietEnabled,
    quietStart: isHhMm(qs) ? qs : DEFAULT_PREFS.quietStart,
    quietEnd: isHhMm(qe) ? qe : DEFAULT_PREFS.quietEnd,
  };
}
