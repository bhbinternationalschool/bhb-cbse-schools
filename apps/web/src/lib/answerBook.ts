/**
 * The school's answer book — the rules, pure, so they can be tested.
 *
 * See the migration for why this is a book of the school's own words rather
 * than a fine-tuned model. The rules that matter here are about what may be
 * said to a parent:
 *
 *   A PROPOSED ENTRY ANSWERS NOBODY. It is what somebody typed on WhatsApp
 *   once. Only an approved entry is the school speaking.
 *
 *   AN EXPIRED ENTRY ANSWERS NOBODY EITHER. "The fee is ₹X this year" stops
 *   being true, and a parent who is told it anyway believes it.
 */

export type AnswerEntryStatus = "proposed" | "approved" | "retired";
export type AnswerLanguage = "hi" | "en" | "both";

export type AnswerEntry = {
  id: string;
  question: string;
  variants: string[];
  answer: string;
  language: AnswerLanguage;
  category: string;
  status: AnswerEntryStatus;
  source: "office_reply" | "unanswered" | "written";
  sourceRef: string;
  validUntil: string | null;
  askedCount: number;
  approvedBy: string;
  approvedAt: string | null;
  updatedAt: string;
};

/** Trimmed, collapsed, and cut — the shape anything stored here takes. */
export function tidy(text: string | undefined, max: number): string {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export const QUESTION_MAX = 400;
export const ANSWER_MAX = 1500;

/**
 * May this entry be said to a parent today?
 *
 * Both halves are refusals, and both are the point of the feature: the
 * office's own reply does not become the school's answer until someone with
 * the authority reads it, and a dated answer stops when its date passes.
 */
export function entryIsLive(
  entry: Pick<AnswerEntry, "status" | "answer" | "validUntil">,
  todayIso: string,
): boolean {
  if (entry.status !== "approved") return false;
  if (!tidy(entry.answer, ANSWER_MAX)) return false;
  if (entry.validUntil && entry.validUntil < todayIso) return false;
  return true;
}

/** Why it is not live, for a screen that has to explain itself. */
export function notLiveReason(
  entry: Pick<AnswerEntry, "status" | "answer" | "validUntil">,
  todayIso: string,
): string | null {
  if (entryIsLive(entry, todayIso)) return null;
  if (entry.status === "retired") return "Retired";
  if (!tidy(entry.answer, ANSWER_MAX)) return "Waiting for an answer";
  if (entry.status === "proposed") return "Waiting for approval";
  if (entry.validUntil && entry.validUntil < todayIso) return `Expired on ${entry.validUntil}`;
  return "Not in use";
}

/**
 * Two askings of the same question, for merging rather than piling up.
 *
 * Deliberately crude — case, punctuation and the filler a parent adds
 * ("sir", "please", "kya") removed, then compared whole. Anything cleverer
 * belongs to the embedding search, which is what actually finds the answer;
 * this only stops the book filling with the identical question twice.
 */
const FILLER = /\b(sir|madam|mam|please|plz|kya|hai|he|ka|ki|ke|mera|meri|hamara|my|the|a|an|is|are|for|of|to|in|at|pls|ji)\b/g;

export function questionKey(text: string): string {
  return tidy(text, QUESTION_MAX)
    .toLowerCase()
    .replace(/[?.,!;:'"()।]/g, " ")
    .replace(FILLER, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sameQuestion(a: string, b: string): boolean {
  const ka = questionKey(a);
  const kb = questionKey(b);
  if (!ka || !kb) return false;
  return ka === kb;
}

/**
 * What goes into the knowledge base for an approved entry.
 *
 * The bot already searches school_kb_chunks and quotes what it finds, so an
 * approved answer needs no change to the bot at all — it needs to be in the
 * shelf the bot already reads. The question's variants ride along in the
 * text: a parent's phrasing is what the search has to match.
 */
export function kbChunkFor(entry: AnswerEntry): { title: string; content: string } {
  const asked = [entry.question, ...entry.variants]
    .map((q) => tidy(q, QUESTION_MAX))
    .filter(Boolean);
  // First seen wins: the entry's own question is the canonical wording, and
  // a Map built from the list would otherwise keep whichever variant came
  // last — so the heading would drift to a parent's typing.
  const byKey = new Map<string, string>();
  for (const q of asked) {
    const k = questionKey(q) || q.toLowerCase();
    if (!byKey.has(k)) byKey.set(k, q);
  }
  const unique = [...byKey.values()];
  const heading = unique[0] || entry.question;
  return {
    title: tidy(heading, QUESTION_MAX),
    content: [
      unique.length > 1 ? `Parents ask this as: ${unique.join(" / ")}` : `Parents ask: ${heading}`,
      "",
      `The school's answer: ${tidy(entry.answer, ANSWER_MAX)}`,
      entry.validUntil ? `(This answer holds until ${entry.validUntil}.)` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
