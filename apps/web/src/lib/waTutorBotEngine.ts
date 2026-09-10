/**
 * The tutor on WhatsApp — what the parent types, and what comes back.
 *
 * The app's tutor (lib/tutorPlans.ts) has seven modes: Hints is the
 * school's free offer, capped per day per household, and Teach, Worked
 * examples, Practice, Score, Homework and Exam prep need a pass. This
 * brings the same thing to the number the family already messages the
 * school on, which for most of these families is the only "app" they use.
 *
 * Pure on purpose. Parsing what a parent typed and composing what they read
 * are the two halves most likely to be wrong, and neither needs a database
 * to test. The allowance decision is NOT re-implemented here — `tutorVerdict`
 * in tutorPlans.ts stays the single answer to "may this household ask this
 * right now", so WhatsApp and the app can never disagree about what a
 * family has paid for.
 */

import {
  TUTOR_MODES,
  formatPaise,
  type TutorAllowance,
  type TutorMode,
  type TutorPlan,
} from "@/lib/tutorPlans";

/** How long an idle tutor session keeps hold of the conversation. */
export const TUTOR_SESSION_TTL_MS = 6 * 60 * 60_000;

export type WaTutorState = {
  /** Bare 10 digits — one session per household number. */
  mobile10: string;
  /** The child the tutor is pinned to. */
  studentId: string;
  mode: TutorMode;
  updatedAt: string;
};

export type WaTutorCommand =
  /** TUTOR — the menu and where this family stands. */
  | { kind: "open" }
  /** TUTOR 2 / CHILD 2 — pin to a child by menu number. */
  | { kind: "child"; index: number }
  /** TEACH, PRACTICE… optionally with the question on the same line. */
  | { kind: "mode"; mode: TutorMode; question: string }
  /** PASS / BUY — what a pass costs. */
  | { kind: "plans" }
  /** PASS 2 — buy the second plan. */
  | { kind: "buy"; index: number }
  /** TUTOR OFF — hand the conversation back to the normal bot. */
  | { kind: "close" }
  /** Anything else while a session is open: the question itself. */
  | { kind: "question"; text: string }
  | { kind: "none" };

const MODE_KEYWORDS: { word: string; mode: TutorMode }[] = [
  { word: "HINT", mode: "hint" },
  { word: "HINTS", mode: "hint" },
  { word: "TEACH", mode: "teach" },
  { word: "EXAMPLES", mode: "examples" },
  { word: "EXAMPLE", mode: "examples" },
  { word: "PRACTICE", mode: "practice" },
  { word: "SCORE", mode: "score" },
  { word: "CHECK", mode: "score" },
  { word: "HOMEWORK", mode: "homework" },
  { word: "HW", mode: "homework" },
  { word: "EXAM", mode: "exam" },
];

/**
 * Keywords the school's other flows own.
 *
 * A parent halfway through a tutor session who types PAY wants to pay a
 * fee, not ask the tutor about paying. So an open session never swallows
 * these — the tutor only claims free text that means nothing else.
 */
const RESERVED = new Set([
  "KIDS",
  "DUES",
  "PAY",
  "RECEIPTS",
  "INFO",
  "HUMAN",
  "COMPLAINT",
  "MENU",
  "HI",
  "HELLO",
  "NAMASTE",
  "START",
  "STOP",
]);

export function isReservedBotWord(text: string): boolean {
  const first = (text || "").trim().split(/\s+/)[0] || "";
  return RESERVED.has(first.toUpperCase());
}

/**
 * What did the parent mean?
 *
 * `sessionOpen` decides only one thing: whether unrecognised text is a
 * question for the tutor or nothing to do with it. Without a session open,
 * "what is photosynthesis" is not the tutor's to answer — the parent never
 * asked for the tutor, and answering would take the conversation somewhere
 * they did not choose.
 */
export function parseWaTutorCommand(
  raw: string,
  sessionOpen: boolean,
): WaTutorCommand {
  const text = (raw || "").trim();
  if (!text) return { kind: "none" };
  const upper = text.toUpperCase();
  const [head, ...rest] = text.split(/\s+/);
  const headUpper = (head || "").toUpperCase();
  const tail = rest.join(" ").trim();

  if (/^TUTOR\s+(OFF|STOP|EXIT|CLOSE|BYE)$/i.test(text)) return { kind: "close" };
  if (headUpper === "TUTOR") {
    const n = Number(tail);
    if (tail && Number.isInteger(n) && n > 0) return { kind: "child", index: n };
    return { kind: "open" };
  }
  if ((headUpper === "CHILD" || headUpper === "KID") && tail) {
    const n = Number(tail);
    if (Number.isInteger(n) && n > 0) return { kind: "child", index: n };
  }

  if (headUpper === "PASS" || headUpper === "BUY") {
    const n = Number(tail);
    if (tail && Number.isInteger(n) && n > 0) return { kind: "buy", index: n };
    return { kind: "plans" };
  }

  const hit = MODE_KEYWORDS.find((m) => m.word === headUpper);
  if (hit) return { kind: "mode", mode: hit.mode, question: tail };

  // A leading mode word carries the rest of the line as the question, so
  // "TEACH photosynthesis" and "teach me about fractions please" both land
  // in teach mode with the topic intact. Keyword-first is also how DUES and
  // PAY already behave in this bot, and it beats the alternative: reading
  // that sentence as a question in whatever mode happened to be open would
  // answer it as a hint when the parent plainly asked to be taught.
  if (sessionOpen && !isReservedBotWord(upper)) {
    return { kind: "question", text };
  }
  return { kind: "none" };
}

function modeLine(m: (typeof TUTOR_MODES)[number]): string {
  const key = m.code === "hint" ? "HINT" : m.code.toUpperCase();
  return `• *${key}* — ${m.blurb}${m.paid ? "" : " (free)"}`;
}

/** Days left on a pass, counted generously: part of today is a day. */
export function passDaysLeft(endsAt: string, now = new Date()): number {
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - now.getTime()) / 86_400_000));
}

export function composeTutorStatus(opts: {
  guardianName: string;
  children: { name: string; classLabel: string }[];
  /** Index into `children` of the pinned child, or -1 for none yet. */
  activeChild: number;
  allowance: TutorAllowance | null;
  mode: TutorMode | null;
  now?: Date;
}): string {
  const lines: string[] = [];
  const child = opts.children[opts.activeChild];
  lines.push("*Study help* 📚");

  if (opts.children.length > 1) {
    lines.push("");
    lines.push(
      child
        ? `For *${child.name}* (${child.classLabel}). Another child? Reply:`
        : "Which child? Reply:",
    );
    opts.children.forEach((c, i) => {
      const mark = i === opts.activeChild ? " ← now" : "";
      lines.push(`• *TUTOR ${i + 1}* — ${c.name} (${c.classLabel})${mark}`);
    });
  } else if (child) {
    lines.push(`For *${child.name}* (${child.classLabel}).`);
  }

  const a = opts.allowance;
  if (a) {
    lines.push("");
    if (a.pass) {
      const left = passDaysLeft(a.pass.endsAt, opts.now);
      lines.push(
        `✅ Pass active — *${a.pass.planLabel}*, ${left} day${left === 1 ? "" : "s"} left. Everything below is open.`,
      );
    } else {
      const freeLeft = Math.max(0, a.freeHintsPerDay - a.freeUsedToday);
      lines.push(
        `Free hints left today: *${freeLeft}* of ${a.freeHintsPerDay}. Reply *PASS* for full study help.`,
      );
    }
  }

  lines.push("");
  lines.push(opts.mode ? `Now in *${opts.mode.toUpperCase()}*. Just type your question.` : "Pick what you need:");
  for (const m of TUTOR_MODES) lines.push(modeLine(m));
  lines.push("");
  lines.push("*TUTOR OFF* to finish. Fees and other help still work as usual.");
  return lines.join("\n");
}

export function composePlansText(opts: {
  plans: TutorPlan[];
  childName: string;
  hasPass: boolean;
  passEndsAt?: string;
  now?: Date;
}): string {
  if (!opts.plans.length) {
    return "Study passes are not on sale just now. Please ask the school office.";
  }
  const lines: string[] = ["*Study pass* — full help for one child 📚", ""];
  if (opts.hasPass && opts.passEndsAt) {
    const left = passDaysLeft(opts.passEndsAt, opts.now);
    lines.push(
      `${opts.childName} already has a pass with ${left} day${left === 1 ? "" : "s"} left. Buying again adds time on top.`,
      "",
    );
  }
  lines.push(`For *${opts.childName}*:`);
  opts.plans.forEach((p, i) => {
    lines.push(`• *PASS ${i + 1}* — ${p.label}, ${formatPaise(p.pricePaise)}`);
  });
  lines.push("");
  lines.push("You buy time, not credits — hints stay free either way.");
  return lines.join("\n");
}

export function composeBuyLinkText(opts: {
  planLabel: string;
  amountPaise: number;
  childName: string;
  url: string;
}): string {
  return [
    `*${opts.planLabel} study pass* for ${opts.childName} — ${formatPaise(opts.amountPaise)}`,
    "",
    "Pay here (UPI, card or net banking):",
    opts.url,
    "",
    "The pass starts the moment the payment goes through, and I will tell you here.",
  ].join("\n");
}

/**
 * The reply when the allowance is spent.
 *
 * Never a bare refusal: it says which mode was refused, why, and the one
 * thing that fixes it. A parent who has run out of free hints at 9pm with a
 * child's homework open needs the next step, not a policy statement.
 */
export function composeNeedsPassText(opts: {
  mode: TutorMode;
  reason: string;
  childName: string;
  /**
   * Who can fix this, which is a different sentence in each case:
   *   self   — this conversation can buy. Offer PASS.
   *   parent — a student's own number. Point at the parent, never at the
   *            office, and never at PASS here: it would dead-end.
   *   off    — no payment gateway configured. The office is the only route.
   */
  buy: "self" | "parent" | "off";
}): string {
  const lines = [opts.reason, ""];
  if (opts.buy === "self") {
    lines.push(`Reply *PASS* to see study passes for ${opts.childName}.`);
  } else if (opts.buy === "parent") {
    lines.push(
      "Ask a parent to reply *PASS* on their own WhatsApp — the one the school messages about fees.",
    );
  } else {
    lines.push(
      "Online payment is not switched on yet — please ask the school office about a study pass.",
    );
  }
  return lines.join("\n");
}

/** Has an idle session gone stale? */
export function tutorSessionExpired(
  state: WaTutorState | null,
  now = new Date(),
): boolean {
  if (!state) return true;
  const at = Date.parse(state.updatedAt || "");
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at > TUTOR_SESSION_TTL_MS;
}
