/**
 * When to nudge someone to read Nucleus, and what the nudge says.
 *
 * Kept apart from the sending (nucleusReminder.server.ts) so the decision can
 * be self-tested without a database or a WhatsApp token.
 */

export const NUCLEUS_URL = "https://nucleus.leadgroup.co.in";

/** A reading older than this, and the reminder goes out. */
export const REMIND_AFTER_DAYS = 7;

export type ReminderDecision =
  | { due: true; reason: "never-read" }
  | { due: true; reason: "stale"; capturedOn: string; ageDays: number }
  | { due: false; capturedOn: string; ageDays: number };

/** Whole days between two ISO dates; negative when the reading is in the future. */
export function ageInDays(capturedOn: string, today: string): number | null {
  const a = Date.parse(`${capturedOn}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Whether to nudge. An unreadable or missing date counts as never read: the
 * one thing this must not do is stay silent because it could not parse a date.
 */
export function reminderDecision(
  capturedOn: string | null,
  today: string,
  afterDays = REMIND_AFTER_DAYS,
): ReminderDecision {
  if (!capturedOn) return { due: true, reason: "never-read" };
  const age = ageInDays(capturedOn, today);
  if (age === null) return { due: true, reason: "never-read" };
  if (age > afterDays) return { due: true, reason: "stale", capturedOn, ageDays: age };
  return { due: false, capturedOn, ageDays: age };
}

/** What lands on the phone. Plain, with the one action it wants. */
export function reminderMessage(decision: ReminderDecision): string {
  const how =
    "Nucleus → Performance Reports → Teacher Timeliness → select the table → copy. " +
    "Then in the ERP: Teaching → Nucleus progress → Paste a fresh reading.";
  if (decision.due && decision.reason === "never-read") {
    return `Syllabus progress: the ERP has no reading from Nucleus yet.\n\n${how}`;
  }
  if (decision.due) {
    return (
      `Syllabus progress: the last reading from Nucleus is ${decision.ageDays} days old ` +
      `(${decision.capturedOn}).\n\n${how}`
    );
  }
  return "";
}
