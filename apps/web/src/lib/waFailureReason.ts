/**
 * What a WhatsApp failure actually means, in words the office can act on.
 *
 * Two of Meta's failures look identical in a log and mean completely
 * different things:
 *
 *   "Message undeliverable"   (131026) → this number is NOT on WhatsApp.
 *                                        The number is wrong, or the parent
 *                                        does not use WhatsApp. Fix the
 *                                        number; sending again is pointless.
 *   "Re-engagement message"   (131047) → the number is FINE. We sent free
 *                                        text more than 24 hours after the
 *                                        parent last wrote. Send an approved
 *                                        template instead.
 *
 * Ten of this school's parent numbers were sitting on the first one and
 * nobody had been told, because the only place either appeared was Meta's
 * own phrasing in a per-message log. A clerk cannot be expected to know
 * that one of those means "go and correct the number in Students → Family"
 * and the other means "nothing is wrong with the number at all".
 *
 * Pure and string-based on purpose: the same text arrives from two sources
 * — Meta's `errors[0].title` on the status webhook, and our own send-path
 * messages from waSend.ts — and both have to classify the same way.
 */

export type WaFailureKind =
  | "not_on_whatsapp"
  | "needs_template"
  | "opted_out"
  | "template_problem"
  | "invalid_mobile"
  | "provider_problem"
  | "unknown";

export type WaFailureVerdict = {
  kind: WaFailureKind;
  /** One short line for a table cell. */
  label: string;
  /** What to do about it, addressed to the office. */
  advice: string;
  /**
   * Is the NUMBER the problem? Only these belong on a "numbers to fix"
   * list — a 24-hour-window failure says nothing about the number, and
   * putting it there would send the office correcting numbers that are
   * perfectly good.
   */
  numberAtFault: boolean;
  /** Would sending the same thing again plausibly work? */
  retryable: boolean;
};

const VERDICTS: Record<WaFailureKind, Omit<WaFailureVerdict, "kind">> = {
  not_on_whatsapp: {
    label: "Not on WhatsApp",
    advice:
      "This number is not a WhatsApp user — usually a wrong or mistyped number. Correct it in Students → Family, or reach the parent another way.",
    numberAtFault: true,
    retryable: false,
  },
  needs_template: {
    label: "Needs an approved template",
    advice:
      "Nothing is wrong with this number. Free text only reaches a parent within 24 hours of their last message; send an approved template instead.",
    numberAtFault: false,
    retryable: true,
  },
  opted_out: {
    label: "Opted out (STOP)",
    advice:
      "This family replied STOP. Do not message them until they opt back in.",
    numberAtFault: false,
    retryable: false,
  },
  template_problem: {
    label: "Template problem",
    advice:
      "The template was rejected, paused, or sent with the wrong number of variables. Check Masters → WhatsApp templates.",
    numberAtFault: false,
    retryable: true,
  },
  invalid_mobile: {
    label: "Not a valid mobile",
    advice:
      "Fewer than 10 digits, or not a mobile number at all. Correct it in Students → Family.",
    numberAtFault: true,
    retryable: false,
  },
  provider_problem: {
    label: "School's WhatsApp account",
    advice:
      "The problem is on the school's side — the account, the sending number, or the daily limit — not the parent's. Check Masters → WhatsApp numbers.",
    numberAtFault: false,
    retryable: true,
  },
  unknown: {
    label: "Failed",
    advice:
      "WhatsApp did not say why. If it repeats for one family, check their number; if it repeats for many, check the school's WhatsApp account.",
    numberAtFault: false,
    retryable: true,
  },
};

/**
 * Meta sends a title, a message, and sometimes a code. We store whichever
 * came first, so match on all of them.
 *
 * Ordered most specific first: "Re-engagement message" must be tested
 * before any generic "message" match, or a perfectly good number ends up
 * on the fix-the-number list.
 */
const PATTERNS: { kind: WaFailureKind; test: RegExp }[] = [
  { kind: "needs_template", test: /re-?engagement|131047/i },
  {
    kind: "needs_template",
    test: /outside meta'?s? 24h|24[- ]?hour (session )?window|open conversation/i,
  },
  { kind: "opted_out", test: /opted out|\bstop\b|131050/i },
  {
    kind: "not_on_whatsapp",
    test: /undeliverable|131026|not a whatsapp user|no whatsapp account/i,
  },
  { kind: "invalid_mobile", test: /invalid mobile|invalid (wa )?number|131006/i },
  {
    kind: "template_problem",
    test: /template|132000|132001|132005|132007|132012|132015|paused/i,
  },
  {
    kind: "provider_problem",
    test: /131031|account.*(locked|restricted)|rate limit|throughput|13300\d|access token|permission/i,
  },
];

export function classifyWaFailure(raw: string | null | undefined): WaFailureVerdict {
  const text = (raw || "").trim();
  if (!text) return { kind: "unknown", ...VERDICTS.unknown };
  for (const p of PATTERNS) {
    if (p.test.test(text)) return { kind: p.kind, ...VERDICTS[p.kind] };
  }
  return { kind: "unknown", ...VERDICTS.unknown };
}

export function waFailureLabel(raw: string | null | undefined): string {
  return classifyWaFailure(raw).label;
}

/** Does this failure mean the NUMBER needs correcting? */
export function waFailureBlamesNumber(raw: string | null | undefined): boolean {
  return classifyWaFailure(raw).numberAtFault;
}
