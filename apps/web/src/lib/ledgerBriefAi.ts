/**
 * The morning note on the books — facts, prompt and parser.
 *
 * Follows the house pattern for AI features: deterministic rules decide *what*
 * is wrong and *how much*, and the model only writes the prose that connects
 * them. Nothing here is saved by the route; the brief is a reading aid.
 *
 * One rule is stricter here than elsewhere in the ERP, and it is the whole
 * reason this is safe to put in front of a director:
 *
 *     the model may not emit a digit.
 *
 * Every amount, count and date the reader needs is already rendered from the
 * ledger beside the note. A model that writes "roughly two lakh is overdue"
 * has produced a figure nobody computed, and in a set of accounts a plausible
 * wrong number is far more damaging than an obviously missing one — it gets
 * repeated in a meeting. So the parser rejects any note containing a digit,
 * and the prompt tells the model to name magnitudes in words or not at all.
 *
 * The findings it may refer to are allow-listed to the codes the caller
 * supplied, the same way at-risk notes are allow-listed to student ids.
 */

export type LedgerBriefLanguage = "en" | "hi";

export type LedgerBriefFinding = {
  /** Stable rule code — the allow-list key. */
  code: string;
  severity: "critical" | "warning" | "info";
  title: string;
  /** Already-rendered prose from the deterministic rule, amounts included. */
  detail: string;
};

export type LedgerBriefFacts = {
  schoolName: string;
  asOf: string;
  /** Rendered strings, not numbers — the model never does arithmetic. */
  position: {
    cash: string;
    bank: string;
    payables: string;
    receivables: string;
    surplusThisYear: string;
  };
  findings: LedgerBriefFinding[];
  /** Present only when a reconciliation has been run. */
  reconciliation?: { reconciles: boolean; unexplainedItems: number };
};

export type LedgerBriefDraft = {
  /** One sentence. The thing to know before reading anything else. */
  headline: string;
  /** Finding codes, most urgent first. Allow-listed to what was supplied. */
  priority: string[];
  /** Two or three sentences of context. No figures. */
  note: string;
};

export const LEDGER_BRIEF_PROMPT_VERSION = "v1";

export function buildLedgerBriefSystemPrompt(opts: {
  language: LedgerBriefLanguage;
  schoolName: string;
}): string {
  const lang =
    opts.language === "hi"
      ? "Write in simple Hindi (Devanagari)."
      : "Write in plain English.";
  return [
    `You are helping the director of ${opts.schoolName} read the school's accounts each morning.`,
    lang,
    "",
    "You are given a position summary and a list of findings that have ALREADY been",
    "calculated from the ledger. Your job is only to connect them into something a",
    "busy person can act on: which one matters most, and whether several of them are",
    "the same underlying problem.",
    "",
    "ABSOLUTE RULES:",
    "1. NEVER write a digit. Not an amount, not a count, not a date, not a percentage.",
    "   Every number is already shown to the reader next to your words. If you must",
    "   indicate size, use words such as 'a large payment' or 'several suppliers'.",
    "2. Only refer to findings by the codes supplied. Do not invent a finding, and do",
    "   not mention a problem that is not in the list.",
    "3. If the list of findings is empty, say plainly that nothing needs attention",
    "   today. Do not manufacture concern to seem useful.",
    "4. Do not give tax, legal or investment advice. Do not speculate about causes you",
    "   have not been told.",
    "",
    'Reply with JSON only: {"headline": "...", "priority": ["code", ...], "note": "..."}',
    "headline: one sentence. note: at most three sentences.",
  ].join("\n");
}

export function buildLedgerBriefUserPrompt(f: LedgerBriefFacts): string {
  const lines: string[] = [
    `As at: ${f.asOf}`,
    "",
    "Position (already computed, shown to the reader separately):",
    `- cash in hand: ${f.position.cash}`,
    `- bank: ${f.position.bank}`,
    `- owed to suppliers: ${f.position.payables}`,
    `- owed to the school: ${f.position.receivables}`,
    `- surplus so far this year: ${f.position.surplusThisYear}`,
    "",
  ];

  if (f.reconciliation) {
    lines.push(
      f.reconciliation.reconciles
        ? "The bank reconciliation is agreed."
        : "The bank reconciliation does not currently agree.",
      "",
    );
  } else {
    // Absent must stay absent: no statement has been imported, so the model is
    // told that rather than left to assume the books are reconciled.
    lines.push("No bank statement has been imported, so reconciliation status is not available. Do not comment on it.", "");
  }

  if (f.findings.length === 0) {
    lines.push("Findings: none. Nothing was flagged today.");
  } else {
    lines.push("Findings (refer to these by code only):");
    for (const x of f.findings) {
      lines.push(`- ${x.code} [${x.severity}] ${x.title}: ${x.detail}`);
    }
  }
  return lines.join("\n");
}

/** Any digit at all — see the header for why this is the invariant. */
const CONTAINS_DIGIT = /\d/;

export function parseLedgerBriefJson(
  text: string,
  allowedCodes: string[],
): LedgerBriefDraft | null {
  let raw: unknown;
  try {
    const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
    raw = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const headline = typeof o.headline === "string" ? o.headline.trim() : "";
  const note = typeof o.note === "string" ? o.note.trim() : "";
  if (!headline) return null;

  // The no-digits invariant. A draft that breaks it is discarded rather than
  // scrubbed: a sentence with its numbers stripped out reads as though a fact
  // were removed, and the caller is better served by falling back to the
  // deterministic findings alone.
  if (CONTAINS_DIGIT.test(headline) || CONTAINS_DIGIT.test(note)) return null;

  const allowed = new Set(allowedCodes);
  const priority = Array.isArray(o.priority)
    ? o.priority
        .map((c) => (typeof c === "string" ? c.trim() : ""))
        .filter((c) => c && allowed.has(c))
    : [];

  return { headline, priority: [...new Set(priority)], note };
}
