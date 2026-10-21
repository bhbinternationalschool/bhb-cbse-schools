/**
 * Office approval replies on WhatsApp — "APPROVE 9", "reject #12", "haan 3".
 *
 * The n8n virtual staff room (automation/n8n) sends the director a drafted
 * email reply and asks for APPROVE <n> or REJECT <n>. Its poller reads the
 * answer from wa_messages every five minutes and owns the approval_state
 * transition. The ERP bot has no part in that — but on 22 Oct 2026 it read
 * "APPROVE 9" as a student lookup and answered "I couldn't find an active
 * student matching 'approve class 9'", which is noise on top of a decision
 * the director had just made.
 *
 * This module is the pure half: recognise the reply, decide what to say.
 * The webhook runs it ahead of every lookup for a staff number. It never
 * changes approval_state.
 *
 * Note on `\b`: JavaScript's word boundary is ASCII-only, so after हाँ or
 * रद्द it would never match (the same bug bit the n8n poller). A negative
 * lookahead on the next character does the job for both scripts.
 */

const APPROVE_WORDS = ["approve", "approved", "ok", "yes", "send", "haan", "हाँ", "ठीक", "भेज"];
const REJECT_WORDS = ["reject", "rejected", "no", "cancel", "nahi", "नहीं", "रद्द"];

const OFFICE_APPROVAL_RE = new RegExp(
  `^\\s*(${[...APPROVE_WORDS, ...REJECT_WORDS].join("|")})(?![a-z0-9])[^0-9]*#?\\s*(\\d+)\\s*$`,
  "i",
);

export type OfficeApprovalReply = { approve: boolean; id: number };

/** "APPROVE 9", "Reject #12", "ठीक 3" → the decision and the task id; anything else → null. */
export function parseOfficeApprovalReply(text: string): OfficeApprovalReply | null {
  const m = OFFICE_APPROVAL_RE.exec(text || "");
  if (!m) return null;
  const id = Number(m[2]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const word = m[1]!.toLowerCase();
  return { approve: APPROVE_WORDS.includes(word), id };
}

/** Cheap gate for the webhook: is this text shaped like an office approval reply? */
export function looksLikeOfficeApprovalReply(text: string): boolean {
  return parseOfficeApprovalReply(text) !== null;
}

/**
 * What the office_tasks row says, as far as the bot needs to know.
 * "unknown" is a lookup that could not run (no DB, a query error): the reply
 * is logged in wa_messages regardless, so the poller will still see it.
 */
export type OfficeTaskState = "pending" | "approved" | "rejected" | "none" | "missing" | "unknown";

export function composeOfficeApprovalAck(opts: {
  decision: OfficeApprovalReply;
  state: OfficeTaskState;
  hindi: boolean;
}): string {
  const { decision, state, hindi } = opts;
  const n = decision.id;
  const verb = decision.approve ? "approve" : "reject";
  const verbHi = decision.approve ? "मंज़ूरी" : "अस्वीकृति";
  switch (state) {
    case "pending":
      return hindi
        ? `नोट कर लिया — ड्राफ़्ट #${n} के लिए ${verbHi}; ऑफ़िस 5 मिनट के भीतर कार्रवाई करेगा।`
        : `Noted — ${verb} for draft #${n}; the office will act within 5 minutes.`;
    case "approved":
    case "rejected":
      return hindi
        ? `ड्राफ़्ट #${n} पहले ही ${state === "approved" ? "मंज़ूर" : "अस्वीकृत"} हो चुका है।`
        : `Draft #${n} was already ${state}.`;
    case "unknown":
      return hindi
        ? `ड्राफ़्ट #${n} पर आपका जवाब दर्ज है; ऑफ़िस 5 मिनट के भीतर कार्रवाई करेगा।`
        : `Your reply on draft #${n} is logged; the office will act within 5 minutes.`;
    default:
      return hindi ? `ड्राफ़्ट #${n} कोई प्रतीक्षा में नहीं है।` : `No draft #${n} is waiting.`;
  }
}

/**
 * The whole decision in one pure step: null means "not an office approval
 * reply from someone who may give one — carry on to the next handler"; a
 * string is what to send back, and nothing else must run for this message.
 */
export function officeApprovalReply(opts: {
  text: string;
  isStaff: boolean;
  state: OfficeTaskState;
  hindi: boolean;
}): { decision: OfficeApprovalReply; reply: string } | null {
  if (!opts.isStaff) return null;
  const decision = parseOfficeApprovalReply(opts.text);
  if (!decision) return null;
  return { decision, reply: composeOfficeApprovalAck({ decision, state: opts.state, hindi: opts.hindi }) };
}
