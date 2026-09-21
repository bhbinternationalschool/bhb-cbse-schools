/**
 * What is waiting on a PERSON at the school — for the director's digest.
 *
 * WHY (director, 21 Sep 2026): a sweep of every WhatsApp store found the
 * machinery working and the people behind it missing.
 *
 *   - 23 parents sat at `needs_staff`, the oldest for ten days, and not one
 *     had ever had a reply. Every one of them had been told "your question
 *     has been sent to the school office — they will reply soon".
 *   - The office relay had forwarded 11 hand-offs to office phones and
 *     received 0 answers; 10 more had reached nobody at all.
 *   - 47 photos, voice notes and documents from parents, 46 never opened.
 *   - The last fee reminder had gone out eight days before, and nothing
 *     schedules them — they go when somebody sends the command.
 *
 * None of that is a fault code can fix: someone has to answer. What code
 * can do is make sure it cannot sit unnoticed. Each part is a count and,
 * where it helps, a name — "23 waiting" is a number, "oldest 10 days, Mr.
 * Rohit Dixit" is a phone call.
 *
 * UNKNOWN IS NOT ZERO ([[erp-unknown-must-not-become-fact]]). Each part is
 * `null` when its source could not be read, and the digest says so rather
 * than reporting a clean queue it never looked at.
 */

export type OfficeBacklog = {
  /** Parent chats at needs_staff, oldest first. null = the chats could not be read. */
  waitingParents: { name: string; days: number }[] | null;
  /** Relay hand-offs in the window with no reply from the office. */
  relayUnanswered: number | null;
  /** Hand-offs that reached no office phone at all — no route for their category. */
  relayNoRoute: number | null;
  /** Files parents sent in the window that nobody has opened. */
  mediaUnreviewed: { images: number; audio: number; other: number } | null;
  /** Whole days since a fee reminder was last sent. null = none on record, or unreadable. */
  daysSinceFeeReminder: number | null;
};

/** Below this, a quiet spell in fee reminders is normal and not worth a line. */
export const FEE_REMINDER_QUIET_DAYS = 7;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Nothing waiting on anybody — every part read and every part clear. */
export function backlogIsEmpty(b: OfficeBacklog): boolean {
  const media = b.mediaUnreviewed;
  return (
    Array.isArray(b.waitingParents) && b.waitingParents.length === 0 &&
    b.relayUnanswered === 0 &&
    b.relayNoRoute === 0 &&
    !!media && media.images + media.audio + media.other === 0 &&
    (b.daysSinceFeeReminder === null || b.daysSinceFeeReminder < FEE_REMINDER_QUIET_DAYS)
  );
}

/**
 * The section for the digest, or "" when there is nothing to say.
 *
 * An unreadable part is always said, even alone: a digest that goes quiet
 * because a query failed is the same silence this exists to end.
 */
export function formatOfficeBacklog(b: OfficeBacklog): string {
  const lines: string[] = [];

  if (b.waitingParents === null) {
    lines.push("⚠ Could not read the parent chats — check the WhatsApp desk yourself.");
  } else if (b.waitingParents.length) {
    const oldest = b.waitingParents[0]!;
    lines.push(
      `💬 ${plural(b.waitingParents.length, "parent is", "parents are")} waiting for a reply — oldest ${plural(oldest.days, "day", "days")} (${oldest.name}).`,
    );
    const others = b.waitingParents.slice(1, 5).map((p) => `${p.name} ${p.days}d`);
    if (others.length) {
      lines.push(`   ${others.join(" · ")}${b.waitingParents.length > 5 ? ` +${b.waitingParents.length - 5} more` : ""}`);
    }
  }

  if (b.relayUnanswered === null || b.relayNoRoute === null) {
    lines.push("⚠ Could not read the office relay.");
  } else {
    if (b.relayUnanswered) {
      lines.push(`📨 ${plural(b.relayUnanswered, "message", "messages")} forwarded to office phones, not answered.`);
    }
    if (b.relayNoRoute) {
      lines.push(`🚫 ${plural(b.relayNoRoute, "message", "messages")} reached nobody — no office phone is set for that kind of question.`);
    }
  }

  if (b.mediaUnreviewed === null) {
    lines.push("⚠ Could not read the files parents sent.");
  } else {
    const m = b.mediaUnreviewed;
    const bits = [
      m.images ? plural(m.images, "photo", "photos") : "",
      m.audio ? plural(m.audio, "voice note", "voice notes") : "",
      m.other ? plural(m.other, "other file", "other files") : "",
    ].filter(Boolean);
    if (bits.length) lines.push(`📎 From parents, not yet opened: ${bits.join(", ")}.`);
  }

  if (b.daysSinceFeeReminder !== null && b.daysSinceFeeReminder >= FEE_REMINDER_QUIET_DAYS) {
    lines.push(`💰 No fee reminder sent for ${plural(b.daysSinceFeeReminder, "day", "days")}. They go only when someone sends the command.`);
  }

  if (!lines.length) return "";
  return ["*Waiting for the office*", ...lines].join("\n");
}

/** For the push notification and the out-of-window template: one line. */
export function formatOfficeBacklogOneLine(b: OfficeBacklog): string {
  const parts: string[] = [];
  if (b.waitingParents === null) parts.push("parent chats unreadable");
  else if (b.waitingParents.length) {
    parts.push(`${b.waitingParents.length} parents waiting (oldest ${b.waitingParents[0]!.days}d)`);
  }
  const relay = (b.relayUnanswered ?? 0) + (b.relayNoRoute ?? 0);
  if (relay) parts.push(`${relay} relay unanswered`);
  const m = b.mediaUnreviewed;
  const files = m ? m.images + m.audio + m.other : 0;
  if (files) parts.push(`${files} files unopened`);
  return parts.length ? `Office: ${parts.join(", ")}.` : "";
}

/** Whole days between two instants, never negative. */
export function wholeDaysBetween(fromIso: string, toIso: string): number | null {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}
