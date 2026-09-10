/**
 * Deciding a leave request by replying to the 6 PM brief.
 *
 * The brief tells the principal that two requests are waiting. Making them
 * open the ERP to act on that is what turns a useful message into another
 * thing to get round to — so LEAVE, LEAVE OK 1, LEAVE NO 2 decide it from
 * the phone.
 *
 * The parsing is here, pure, because the failure modes are all about
 * misreading a message: "LEAVE" from a teacher applying for leave must not
 * be read as a principal's command, and "LEAVE OK" with no number must not
 * approve the first thing in the queue.
 */

export type LeaveCommand =
  | { kind: "list" }
  | { kind: "decide"; decision: "approved" | "rejected"; index: number }
  | { kind: "needs_index"; decision: "approved" | "rejected" }
  | { kind: "not_a_command" };

/**
 * Words that mean "yes" and "no" here.
 *
 * Kept small and explicit. A principal typing "LEAVE APPROVE 2" or
 * "LEAVE HAAN 2" means the same thing, and being generous with the verb
 * costs nothing — but the DECISION words are never inferred from anything
 * looser, because guessing wrong either grants leave nobody granted or
 * refuses leave somebody granted.
 */
const YES = new Set(["ok", "y", "yes", "approve", "approved", "grant", "haan", "ha", "han"]);
const NO = new Set(["no", "n", "reject", "rejected", "refuse", "deny", "nahi", "nahin"]);

export function parseLeaveCommand(raw: string): LeaveCommand {
  const text = (raw || "").trim().replace(/\s+/g, " ");
  if (!text) return { kind: "not_a_command" };

  const words = text.toLowerCase().split(" ");
  if (words[0] !== "leave") return { kind: "not_a_command" };

  // "LEAVE" alone — show what is waiting.
  if (words.length === 1) return { kind: "list" };

  const verb = words[1] ?? "";
  const isYes = YES.has(verb);
  const isNo = NO.has(verb);
  if (!isYes && !isNo) {
    // "LEAVE 2" is ambiguous — it could mean approve or reject, and there
    // is no safe default, so it is treated as a request for the list.
    // Anything else after LEAVE ("leave application", "leave rules") is a
    // sentence, not a command, and falls through to the ordinary bot.
    if (/^\d+$/.test(verb)) return { kind: "list" };
    return { kind: "not_a_command" };
  }

  const decision = isYes ? ("approved" as const) : ("rejected" as const);
  const numberWord = words[2] ?? "";
  if (!/^\d+$/.test(numberWord)) return { kind: "needs_index", decision };

  const index = Number(numberWord);
  // The list is numbered from 1. A zero or a wild number is a typo, and
  // acting on "the first one" instead would decide the wrong person's
  // leave.
  if (!Number.isInteger(index) || index < 1 || index > 99) {
    return { kind: "needs_index", decision };
  }
  return { kind: "decide", decision, index };
}

/** Is this a leave decision the sender needs authority for? */
export function leaveCommandNeedsAuthority(cmd: LeaveCommand): boolean {
  return cmd.kind === "decide";
}

export type LeavePendingLine = {
  index: number;
  name: string;
  typeLabel: string;
  fromDate: string;
  toDate: string;
  days: number;
};

export function composeLeaveList(lines: LeavePendingLine[]): string {
  if (lines.length === 0) {
    return "No leave request is waiting for a decision. 🙏";
  }
  const rows = lines.map(
    (l) =>
      `*${l.index}.* ${l.name} — ${l.typeLabel}, ${
        l.fromDate === l.toDate ? l.fromDate : `${l.fromDate} to ${l.toDate}`
      }${l.days ? ` (${l.days} day${l.days === 1 ? "" : "s"})` : ""}`,
  );
  return [
    `📝 *${lines.length} leave request${lines.length === 1 ? "" : "s"} waiting*`,
    "",
    ...rows,
    "",
    "Reply *LEAVE OK 1* to approve, *LEAVE NO 1* to reject.",
  ].join("\n");
}

export function composeLeaveDecisionReply(opts: {
  ok: boolean;
  decision: "approved" | "rejected";
  name: string;
  typeLabel: string;
  fromDate: string;
  toDate: string;
  error?: string;
}): string {
  if (!opts.ok) {
    return `Could not record that — ${opts.error || "please try from the ERP"}.`;
  }
  const dates =
    opts.fromDate === opts.toDate
      ? opts.fromDate
      : `${opts.fromDate} to ${opts.toDate}`;
  // Deliberately does NOT say "they have been told". Telling the staff
  // member needs an approved template — their 24-hour window is shut by
  // the evening — and there is no leave-decision template yet. Claiming a
  // notification that never goes is worse than the office knowing it has
  // to mention it.
  return opts.decision === "approved"
    ? `✅ Approved — ${opts.name}, ${opts.typeLabel}, ${dates}. Recorded in the ERP; they are not messaged automatically.`
    : `❌ Rejected — ${opts.name}, ${opts.typeLabel}, ${dates}. Recorded in the ERP; they are not messaged automatically.`;
}

/** What to say when the number is missing or out of range. */
export function composeLeaveNeedsIndex(
  decision: "approved" | "rejected",
  count: number,
): string {
  const word = decision === "approved" ? "OK" : "NO";
  if (count === 0) return "No leave request is waiting for a decision. 🙏";
  return `Which one? Reply *LEAVE ${word} 1* … *LEAVE ${word} ${count}*, or *LEAVE* to see the list again.`;
}

/** The sender is not allowed to decide leave. */
export function composeLeaveNotAllowed(): string {
  return "Only staff with HR rights can approve or reject leave. Ask the principal or the office, or open Staff → Leave in the ERP.";
}
