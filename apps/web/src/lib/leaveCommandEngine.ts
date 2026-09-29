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

/**
 * The fields of a Staff HR desk leave request this module reads. The desk
 * (staffHr.LeaveRequest) is where leave lives; the staff_leave_requests
 * table is empty on the live tenant, so a queue read from it was always
 * "nothing waiting".
 */
export type DeskLeave = {
  id: string;
  staffId: string;
  typeCode: string;
  fromDate: string;
  toDate: string;
  days: number;
  halfDay: boolean;
  status: string;
  appliedAt: string;
  decidedBy: string;
};

/**
 * Undecided. pending_l2 cleared level one and still needs the final word;
 * leaving it out would hide exactly what a principal is being asked to settle.
 */
export function isUndecidedLeave(status: string): boolean {
  return status === "pending" || status === "pending_l2";
}

/** The undecided queue, oldest start date first — the order LEAVE shows. */
export function buildLeaveQueue(
  requests: DeskLeave[],
  nameOf: (staffId: string) => string,
  typeLabelOf: (typeCode: string) => string,
): { line: LeavePendingLine; requestId: string }[] {
  return requests
    .filter((r) => isUndecidedLeave(r.status))
    .sort(
      (a, b) =>
        a.fromDate.localeCompare(b.fromDate) ||
        a.appliedAt.localeCompare(b.appliedAt) ||
        a.id.localeCompare(b.id),
    )
    .map((r, i) => ({
      requestId: r.id,
      line: {
        index: i + 1,
        name: nameOf(r.staffId) || r.staffId,
        typeLabel: typeLabelOf(r.typeCode) || r.typeCode,
        fromDate: r.fromDate,
        toDate: r.toDate,
        days: Number(r.days) || 0,
      },
    }));
}

/**
 * The list a sender was last shown, remembered so "LEAVE OK 1" means the
 * request that was number 1 ON THAT LIST. Resolving the number against the
 * queue as it is now would approve somebody else's leave the moment another
 * approver decided number 1 first — the queue shifts up under them.
 */
export type ShownLeaveList = { ids: string[]; at: string };

/** A list older than this is not what the sender is looking at any more. */
export const SHOWN_LEAVE_LIST_TTL_MS = 24 * 60 * 60_000;

export function resolveShownLeave(
  shown: ShownLeaveList | null | undefined,
  index: number,
  nowMs = Date.now(),
):
  | { kind: "no_list" }
  | { kind: "out_of_range"; count: number }
  | { kind: "ok"; requestId: string } {
  const at = Date.parse(shown?.at || "");
  if (!shown || !Number.isFinite(at) || nowMs - at > SHOWN_LEAVE_LIST_TTL_MS) {
    return { kind: "no_list" };
  }
  const requestId = shown.ids[index - 1];
  if (!requestId) return { kind: "out_of_range", count: shown.ids.length };
  return { kind: "ok", requestId };
}

/** The claim a decision takes — the same key the "LEAVE OK 4821" path uses. */
export function leaveDecisionClaimKey(requestId: string, status: string): string {
  return `leave-decision:${requestId}:${status}`;
}

export type LeaveDecisionResult =
  | { kind: "decided"; status: string; marked: number }
  | { kind: "already_decided"; by: string }
  | { kind: "failed"; error: string };

/**
 * Decide one desk request: claim it, decide it, save it, then mark the
 * registers. What handleLeaveCodeDecision does, with the side effects
 * passed in so the order and the claim release can be tested.
 *
 * The claim comes first: two approvers answering within seconds both read
 * the request as pending, and only one may decide it. A failed decision or
 * save gives the claim back, so trying again is possible.
 */
export async function runLeaveDecision<S extends { leaveRequests: DeskLeave[] }>(
  req: DeskLeave,
  decision: "approved" | "rejected",
  by: string,
  deps: {
    claim: (
      key: string,
      by: string,
      note: string,
    ) => Promise<
      | { ok: true }
      | { ok: false; reason: "held"; claimedBy: string }
      | { ok: false; reason: "unavailable" }
    >;
    release: (key: string) => Promise<void>;
    decide: (input: {
      requestId: string;
      decision: "approved" | "rejected";
      decidedBy: string;
      decisionNote: string;
    }) => { ok: true; state: S } | { ok: false; error: string };
    /** Throws when the desk could not be saved. */
    save: (state: S) => Promise<void>;
    markRegisters: (req: DeskLeave, by: string) => Promise<number>;
  },
): Promise<LeaveDecisionResult> {
  const key = leaveDecisionClaimKey(req.id, req.status);
  const claim = await deps.claim(key, by, `leave list · ${req.id}`);
  if (!claim.ok) {
    return claim.reason === "held"
      ? { kind: "already_decided", by: claim.claimedBy }
      : { kind: "failed", error: "the decision could not be recorded just now — try again in a minute" };
  }

  const result = deps.decide({
    requestId: req.id,
    decision,
    decidedBy: by,
    decisionNote: `Decided on WhatsApp by ${by}`,
  });
  if (!result.ok) {
    await deps.release(key);
    return { kind: "failed", error: result.error };
  }
  try {
    await deps.save(result.state);
  } catch {
    await deps.release(key);
    return { kind: "failed", error: "the decision could not be saved just now — try again in a minute" };
  }

  const after = result.state.leaveRequests.find((r) => r.id === req.id);
  const status = after?.status || decision;
  const marked =
    status === "approved" ? await deps.markRegisters(req, `Leave approved by ${by}`) : 0;
  return { kind: "decided", status, marked };
}

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
  /** Two-level approval: the first yes moved it to pending_l2, not approved. */
  firstLevelOnly?: boolean;
}): string {
  if (!opts.ok) {
    return `Could not record that — ${opts.error || "please try from the ERP"}.`;
  }
  const dates =
    opts.fromDate === opts.toDate
      ? opts.fromDate
      : `${opts.fromDate} to ${opts.toDate}`;
  if (opts.firstLevelOnly) {
    return `Recorded at the first level — ${opts.name}, ${opts.typeLabel}, ${dates}. It now needs the final approval in the ERP (Staff → Leave).`;
  }
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

/** Somebody else decided it — between the list and the reply, or at the same moment. */
export function composeLeaveAlreadyDecided(opts: {
  name: string;
  typeLabel: string;
  status: string;
  by: string;
}): string {
  const what =
    opts.status === "approved" || opts.status === "rejected"
      ? opts.status
      : "decided";
  return `${opts.name}'s ${opts.typeLabel} was already ${what}${opts.by ? ` by ${opts.by}` : ""}. Nothing more to do — reply *LEAVE* for the list as it is now.`;
}

/** The number did not come from a list this sender can still see. */
export function composeLeaveListFirst(list: string): string {
  return `Please pick from this list — the numbers change as leave is decided.\n\n${list}`;
}

/** The desk could not be read: "nothing waiting" would be a guess. */
export function composeLeaveUnreadable(): string {
  return "Could not read the leave desk just now. Please try again in a minute, or open Staff → Leave in the ERP.";
}

export function composeLeaveOwn(): string {
  return "You cannot decide your own leave.";
}

export function composeLeaveDayPassed(): string {
  return "The first day of that leave has passed. Please decide it in the ERP (Staff → Leave).";
}

/** The sender is not allowed to decide leave. */
export function composeLeaveNotAllowed(): string {
  return "Only staff with HR rights can approve or reject leave. Ask the principal or the office, or open Staff → Leave in the ERP.";
}
