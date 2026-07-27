/**
 * In-app chat alerts: sound + browser Notification while ERP is open.
 */

const PREF_KEY = "bhb_chat_alert_prefs_v1";
const SEEN_KEY = "bhb_chat_alert_seen_v1";

export type ChatAlertPrefs = {
  sound: boolean;
  browser: boolean;
  muted: boolean;
};

export function defaultChatAlertPrefs(): ChatAlertPrefs {
  return { sound: true, browser: true, muted: false };
}

export function loadChatAlertPrefs(): ChatAlertPrefs {
  if (typeof window === "undefined") return defaultChatAlertPrefs();
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return defaultChatAlertPrefs();
    const p = JSON.parse(raw) as Partial<ChatAlertPrefs>;
    return {
      sound: p.sound !== false,
      browser: p.browser !== false,
      muted: p.muted === true,
    };
  } catch {
    return defaultChatAlertPrefs();
  }
}

export function saveChatAlertPrefs(prefs: ChatAlertPrefs) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  window.dispatchEvent(new Event("bhb-chat-alert-prefs"));
}

function loadSeenIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr.slice(-500) : []);
  } catch {
    return new Set();
  }
}

function saveSeenIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-500)));
}

export function markMessagesSeen(messageIds: string[]) {
  const seen = loadSeenIds();
  for (const id of messageIds) seen.add(id);
  saveSeenIds(seen);
}

export function playChatTone() {
  if (typeof window === "undefined") return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    window.setTimeout(() => void ctx.close(), 300);
  } catch {
    /* ignore */
  }
}

export async function ensureBrowserNotifyPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function showBrowserChatNotification(input: {
  title: string;
  body: string;
  tag?: string;
}) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(input.title, {
      body: input.body.slice(0, 160),
      tag: input.tag || "erp-chat",
      silent: true,
    });
    window.setTimeout(() => n.close(), 6000);
  } catch {
    /* ignore */
  }
}

export type IncomingChatAlert = {
  messageId: string;
  threadId: string;
  fromLabel: string;
  text: string;
  threadTitle: string;
};

/**
 * Alert for newly received messages. Skips open thread, own messages, and seen ids.
 */
export function alertOnIncomingMessages(input: {
  messages: IncomingChatAlert[];
  openThreadId: string | null;
  myActorKey: string;
}): void {
  const prefs = loadChatAlertPrefs();
  if (prefs.muted) {
    markMessagesSeen(input.messages.map((m) => m.messageId));
    return;
  }
  const seen = loadSeenIds();
  const fresh = input.messages.filter(
    (m) =>
      !seen.has(m.messageId) &&
      m.threadId !== input.openThreadId,
  );
  if (!fresh.length) return;

  markMessagesSeen(fresh.map((m) => m.messageId));

  if (prefs.sound) playChatTone();

  if (prefs.browser && "Notification" in window) {
    if (Notification.permission === "granted") {
      const first = fresh[0]!;
      const extra =
        fresh.length > 1 ? ` (+${fresh.length - 1} more)` : "";
      showBrowserChatNotification({
        title: first.threadTitle || "New message",
        body: `${first.fromLabel}: ${first.text}${extra}`,
        tag: `erp-chat-${first.threadId}`,
      });
    }
  }
}
