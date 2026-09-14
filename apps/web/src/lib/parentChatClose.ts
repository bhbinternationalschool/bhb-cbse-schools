/**
 * When a parent's WhatsApp chat is over, and so gets the closing thank-you.
 *
 * Pure, so the rule can be tested: which threads the sweep closes, and when a
 * parent's "ok / thanks" is itself the end of the conversation.
 */

export type ClosableMsg = { role: "parent" | "bot" | "staff"; at: string };

export type ClosableThread = {
  status: string;
  messages: ClosableMsg[];
  closingSentAt?: string;
};

/** Quiet for this long after the last message = the conversation is over. */
export const CLOSE_AFTER_QUIET_MIN = 30;
/** A question handed to the office gets longer — someone may still be replying. */
export const CLOSE_AFTER_QUIET_NEEDS_STAFF_MIN = 120;
/** Free text only inside Meta's 24-hour window; stop short of the edge. */
export const WINDOW_MARGIN_MIN = 60;

/** Parents are not messaged before 8 am or after 8 pm IST. */
export function istHour(now: Date): number {
  return new Date(now.getTime() + 5.5 * 3_600_000).getUTCHours();
}

export function lastParentAt(t: ClosableThread): string | null {
  for (let i = t.messages.length - 1; i >= 0; i -= 1) {
    if (t.messages[i]!.role === "parent") return t.messages[i]!.at;
  }
  return null;
}

/** Has this conversation — everything since the parent last wrote — already been closed? */
export function alreadyClosed(t: ClosableThread): boolean {
  const lp = lastParentAt(t);
  return !!t.closingSentAt && !!lp && t.closingSentAt >= lp;
}

export type CloseDecision =
  | { close: true; needsOffice: boolean }
  | { close: false; reason: "no_parent_message" | "already_closed" | "still_active" | "window_closing" | "quiet_hours" };

export function shouldCloseThread(t: ClosableThread, now: Date): CloseDecision {
  const lp = lastParentAt(t);
  if (!lp) return { close: false, reason: "no_parent_message" };
  if (alreadyClosed(t)) return { close: false, reason: "already_closed" };
  const lastAny = t.messages.reduce((m, x) => (x.at > m ? x.at : m), "");
  const needsOffice = t.status === "needs_staff";
  const quietMin = (now.getTime() - Date.parse(lastAny)) / 60_000;
  if (quietMin < (needsOffice ? CLOSE_AFTER_QUIET_NEEDS_STAFF_MIN : CLOSE_AFTER_QUIET_MIN)) {
    return { close: false, reason: "still_active" };
  }
  const sinceParentMin = (now.getTime() - Date.parse(lp)) / 60_000;
  if (sinceParentMin > 24 * 60 - WINDOW_MARGIN_MIN) return { close: false, reason: "window_closing" };
  const h = istHour(now);
  if (h < 8 || h >= 20) return { close: false, reason: "quiet_hours" };
  return { close: true, needsOffice };
}
