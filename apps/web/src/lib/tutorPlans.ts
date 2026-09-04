/**
 * The parent tutor's modes, passes and allowance policy — pure, so the
 * decision "may this household ask this right now?" is one testable
 * function shared by the app route, the web route and the status endpoint.
 *
 * Hints are the school's free offer: a Socratic nudge, a fixed number a
 * day per household. Everything that amounts to actual tutoring — teaching
 * a topic, worked examples, practice questions, scoring the child's
 * answers, doing the homework together, exam preparation — needs a pass:
 * a day, a week or a month of the full tutor. Parents buy time, never
 * credits; the only number they see is the date the pass runs out.
 *
 * A pass carries a fair-use ceiling of messages per day so one household
 * cannot run up the school's model bill; it is generous enough that a
 * family using the tutor normally never meets it.
 */

export type TutorMode =
  | "hint"
  | "teach"
  | "examples"
  | "practice"
  | "score"
  | "homework"
  | "exam";

export type TutorModeInfo = {
  code: TutorMode;
  label: string;
  /** One line a parent reads before choosing. */
  blurb: string;
  paid: boolean;
  /** Placeholder for the composer. */
  prompt: string;
};

export const TUTOR_MODES: readonly TutorModeInfo[] = [
  {
    code: "hint",
    label: "Hints",
    blurb: "A nudge in the right direction — your child still does the work.",
    paid: false,
    prompt: "e.g. How do I explain fractions?",
  },
  {
    code: "teach",
    label: "Teach a topic",
    blurb: "A short lesson at your child's class level, step by step.",
    paid: true,
    prompt: "e.g. Teach photosynthesis for Class V",
  },
  {
    code: "examples",
    label: "Worked examples",
    blurb: "Solved examples with every step shown.",
    paid: true,
    prompt: "e.g. Three solved examples of long division",
  },
  {
    code: "practice",
    label: "Practice questions",
    blurb: "A set of questions to try, answers held back until asked.",
    paid: true,
    prompt: "e.g. 5 questions on tenses for Class IV",
  },
  {
    code: "score",
    label: "Check answers",
    blurb: "Paste your child's answers; get marks and what to fix.",
    paid: true,
    prompt: "Paste the questions and your child's answers",
  },
  {
    code: "homework",
    label: "Homework help",
    blurb: "Work through the assignment together, fully explained.",
    paid: true,
    prompt: "e.g. Help with today's maths homework",
  },
  {
    code: "exam",
    label: "Exam preparation",
    blurb: "Revision plan, key points and likely questions.",
    paid: true,
    prompt: "e.g. Prepare for the Class III EVS unit test",
  },
];

/**
 * The language replies are written in. "auto" follows the parent's
 * message; "both" answers in Hindi and then repeats the same in English,
 * for a parent who reads Hindi but wants the English the child meets
 * at school alongside.
 */
export type TutorLanguage = "auto" | "hi" | "en" | "both";

export function parseTutorLanguage(v: unknown): TutorLanguage {
  return v === "hi" || v === "en" || v === "both" ? v : "auto";
}

/** Whether videos and UI copy for this setting should be Hindi. */
export function prefersHindi(language: TutorLanguage): boolean {
  return language === "hi" || language === "both";
}

/**
 * A YouTube search for this topic at this class level, in the family's
 * language. Deterministic on purpose: the same lesson finds the same
 * videos, so results cache well and the model is not asked to invent
 * titles or links it cannot see.
 */
export function videoSearchQuery(topic: string, classLabel: string, language: TutorLanguage): string {
  const t = topic.replace(/\s+/g, " ").trim().slice(0, 80);
  const cls = classLabel.replace(/\s+[A-Z]$/, "").trim(); // "II A" → "II"
  const level = cls ? ` class ${cls}` : "";
  // "CBSE NCERT" steers the search to the board's syllabus and away from
  // state-board channels that cover the same topic a class earlier or later.
  return prefersHindi(language)
    ? `${t}${level} CBSE NCERT हिंदी में समझाइए`
    : `${t}${level} CBSE NCERT explained for kids`;
}

export function tutorMode(code: string | undefined | null): TutorModeInfo {
  return TUTOR_MODES.find((m) => m.code === code) ?? TUTOR_MODES[0]!;
}

export type TutorPlan = {
  code: string;
  label: string;
  days: number;
  pricePaise: number;
};

/**
 * Default passes. The school overrides with AI_TUTOR_PLANS_JSON, an array
 * of { code, label, days, pricePaise }; a malformed value keeps the
 * defaults rather than silently selling nothing.
 */
export const DEFAULT_TUTOR_PLANS: readonly TutorPlan[] = [
  { code: "tutor_day", label: "1 day", days: 1, pricePaise: 4900 },
  { code: "tutor_week", label: "1 week", days: 7, pricePaise: 19900 },
  { code: "tutor_month", label: "1 month", days: 30, pricePaise: 49900 },
];

export function parseTutorPlans(raw: string | undefined | null): TutorPlan[] {
  if (!raw || !raw.trim()) return [...DEFAULT_TUTOR_PLANS];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr) || arr.length === 0) return [...DEFAULT_TUTOR_PLANS];
    const plans: TutorPlan[] = [];
    for (const p of arr as Record<string, unknown>[]) {
      const code = String(p.code ?? "").trim();
      const days = Number(p.days);
      const pricePaise = Number(p.pricePaise);
      if (!/^[a-z0-9_]{2,32}$/.test(code)) return [...DEFAULT_TUTOR_PLANS];
      if (!Number.isInteger(days) || days <= 0 || days > 366) return [...DEFAULT_TUTOR_PLANS];
      if (!Number.isInteger(pricePaise) || pricePaise <= 0) return [...DEFAULT_TUTOR_PLANS];
      plans.push({
        code,
        label: String(p.label ?? "").trim() || `${days} days`,
        days,
        pricePaise,
      });
    }
    return plans;
  } catch {
    return [...DEFAULT_TUTOR_PLANS];
  }
}

export const DEFAULT_FREE_HINTS_PER_DAY = 20;
export const DEFAULT_PASS_MESSAGES_PER_DAY = 60;

export function parseCount(raw: string | undefined | null, dflt: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : dflt;
}

export type TutorPass = {
  planCode: string;
  planLabel: string;
  startsAt: string;
  endsAt: string;
};

export type TutorAllowance = {
  /** The child this allowance is for — a pass is per child. */
  studentId: string;
  studentName: string;
  classLabel: string;
  freeHintsPerDay: number;
  /** Hints used inside today's free allowance. */
  freeUsedToday: number;
  /** The pass in force right now, if any. */
  pass: TutorPass | null;
  /** Fair-use ceiling on a pass, and how much of it today has used. */
  passMessagesPerDay: number;
  passUsedToday: number;
};

export type TutorVerdict =
  | { allowed: true; charge: "free" | "pass" }
  | { allowed: false; reason: string; needsPass: boolean };

/**
 * Whether one more message in `mode` may go ahead. A hint is free while
 * the daily allowance lasts; with a pass in force, every mode is open up
 * to the fair-use ceiling, and a hint past the free cap simply rides the
 * pass — a family that paid is never told to stop at the 21st question.
 */
export function tutorVerdict(mode: TutorMode, a: TutorAllowance, now = new Date()): TutorVerdict {
  const info = tutorMode(mode);
  if (!info.paid && a.freeUsedToday < a.freeHintsPerDay) {
    return { allowed: true, charge: "free" };
  }
  const passLive = !!a.pass && new Date(a.pass.endsAt).getTime() > now.getTime();
  if (passLive) {
    if (a.passUsedToday < a.passMessagesPerDay) return { allowed: true, charge: "pass" };
    return {
      allowed: false,
      needsPass: false,
      reason: `Today's tutor limit (${a.passMessagesPerDay} messages) is reached. It resets at midnight.`,
    };
  }
  if (!info.paid) {
    return {
      allowed: false,
      needsPass: true,
      reason: `Today's ${a.freeHintsPerDay} free hints are used up. Get a tutor pass to keep going, or come back tomorrow.`,
    };
  }
  return {
    allowed: false,
    needsPass: true,
    reason: `${info.label} is part of the full tutor. Get a tutor pass — a day, a week or a month — to unlock it.`,
  };
}

/**
 * When a newly paid pass runs: from now, or from the end of the pass
 * already in force so that no paid day is lost. A pass of N days covers
 * the rest of the day it starts on plus N full days, ending 23:59:59 IST
 * — so "1 day" bought at 9 pm is good all of tomorrow, and "valid till
 * 6 Sep" means what a parent thinks it means.
 */
export function passWindow(
  days: number,
  currentEndsAt: string | null,
  now = new Date(),
): { startsAt: string; endsAt: string } {
  const cur = currentEndsAt ? new Date(currentEndsAt).getTime() : 0;
  const start = cur > now.getTime() ? new Date(cur) : now;
  const ist = new Date(start.getTime() + 330 * 60_000);
  const dayAfterLastUtcMidnight = Date.UTC(
    ist.getUTCFullYear(),
    ist.getUTCMonth(),
    ist.getUTCDate() + days + 1,
  );
  // 23:59:59.999 IST on the last day, expressed in UTC.
  const end = dayAfterLastUtcMidnight - 330 * 60_000 - 1;
  return { startsAt: start.toISOString(), endsAt: new Date(end).toISOString() };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Valid till 12 Sep" — the only number a parent sees about a pass. */
export function passValidLabel(endsAt: string): string {
  const ist = new Date(new Date(endsAt).getTime() + 330 * 60_000);
  return `Valid till ${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]}`;
}

export function formatPaise(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  return p ? `₹${rupees.toLocaleString("en-IN")}.${String(p).padStart(2, "0")}` : `₹${rupees.toLocaleString("en-IN")}`;
}

/**
 * Context for a tutor call. childName / className come from the school's
 * own record of the child (the server fills them in); the client only adds
 * the assignment it was opened from.
 */
export type TutorContext = {
  childName?: string;
  className?: string;
  subjectLabel?: string;
  homeworkTitle?: string;
  homeworkBody?: string;
};

/**
 * What a child at this class level studies, in the school's Nursery–VIII
 * range on the CBSE pattern. Given to the model so "is this question for
 * this class?" has something concrete to judge against; a parent whose
 * pass is for the LKG child cannot use it for the Class II sibling's work.
 */
export function classLevelGuide(className: string): string {
  const n = (className || "").trim().toLowerCase();
  const pre = /nur|play|pre|lkg|ukg|\bkg\b|kinder/.test(n);
  const roman: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };
  const m = n.match(/\b(?:class|std|grade)?\s*(\d{1,2}|i{1,3}|iv|v|vi{1,3}|viii)\b/);
  const num = pre ? 0 : m ? (Number(m[1]) || roman[m[1]] || 0) : 0;
  if (pre || (!m && !num)) {
    return "Pre-primary (Nursery/LKG/UKG): letters and their sounds, tracing and writing, numbers up to 20–100, counting, shapes and colours, rhymes and simple words, Hindi varnamala, everyday awareness of family, animals, seasons. No formal arithmetic beyond simple counting and one-digit addition with objects.";
  }
  if (num <= 2) {
    return "Classes I–II: reading short sentences, simple spellings and grammar (naming words, action words), numbers to 100–1000, place value of two- and three-digit numbers, addition and subtraction, introductory multiplication tables, shapes and patterns, EVS about home, plants, animals and weather, Hindi matras and short words.";
  }
  if (num <= 5) {
    return "Classes III–V: multiplication and division, fractions and decimals, place value up to lakhs, time, money and measurement, simple geometry (angles, perimeter, area), paragraph writing and grammar (tenses, parts of speech), EVS/Science topics such as plants, animals, water, food, the human body, and Social topics such as maps, community and India's states, Hindi reading and writing.";
  }
  return "Classes VI–VIII: integers, fractions and decimals in depth, ratio and percentage, basic algebra and linear equations, geometry and mensuration, data handling; Science as physics, chemistry and biology topics (motion, light, matter, cells, nutrition); Social Science as history, geography and civics; English and Hindi grammar, comprehension and essay writing.";
}

function cleanCtx(ctx: TutorContext): string[] {
  return [
    ctx.childName ? `Child: ${ctx.childName}.` : "",
    ctx.className ? `Class: ${ctx.className}.` : "",
    ctx.subjectLabel ? `Subject: ${ctx.subjectLabel}.` : "",
    ctx.homeworkTitle ? `Assignment title: ${ctx.homeworkTitle}.` : "",
    ctx.homeworkBody ? `Assignment text:\n${ctx.homeworkBody.slice(0, 2000)}` : "",
  ].filter(Boolean);
}

/**
 * The system prompt per mode. Hints keep the original Socratic contract
 * (never the final answer). Paid modes may teach and solve in full, but
 * every mode keeps the same guard rails: the child's level, the parent's
 * language, schoolwork only, and never inventing facts about the school.
 */
export function buildTutorSystemPrompt(
  mode: TutorMode,
  ctx: TutorContext,
  schoolName: string,
  language: TutorLanguage = "auto",
): string {
  const child = ctx.childName || "the child";
  const cls = ctx.className || "their class";
  const languageRule =
    language === "hi"
      ? "Reply in simple Hindi written in Devanagari, the way a patient teacher speaks to a parent who does not read English. Keep English subject words (like 'fraction') only where the school's textbook uses them, and explain them in Hindi."
      : language === "en"
        ? "Reply in simple English, short sentences, no jargon."
        : language === "both"
          ? "Reply in TWO parts. First the full answer in simple Hindi (Devanagari) under the heading 'हिंदी'. Then the SAME answer in simple English under the heading 'English' — a faithful translation, not a shorter summary, so the parent can match the two line by line. If the parent wrote in Hindi, the English part also serves as the translation of what they asked."
          : "Match the parent's language (Hindi, English or Hinglish).";
  const common = [
    `You are a tutor for families of ${schoolName}, an Indian school following the CBSE pattern.`,
    `${languageRule} Pitch everything at the child's class level.`,
    "Curriculum: follow the CBSE syllabus and NCERT textbooks for the class. Do not use state-board (UP Board or any other state) syllabus, textbooks, chapter names or methods; if a topic sits in a different class under a state board, go by where CBSE/NCERT places it.",
    `You are set up for ${child}, who is in ${cls}. Help ONLY with what a ${cls} child studies. Level guide: ${classLevelGuide(ctx.className || "")}`,
    `If a question is clearly above or below that level, or is another child's work, do not answer it — say in one or two lines that this tutor is set for ${child}'s class (${cls}), and that the parent can open the tutor for the other child, who needs their own pass. Never stretch an answer up to a higher class.`,
    "Schoolwork only: if the question is not about the child's learning, politely redirect.",
    "Never invent facts about the school, its timetable, fees or teachers — you do not have them.",
    "Use plain text with short paragraphs or numbered steps; no tables.",
  ];
  const byMode: Record<TutorMode, string[]> = {
    hint: [
      "You give HINTS, not answers. Lead the child to think with a question, a first step or a reminder of the rule.",
      "Never output the full final answer to the set exercise; a worked example must use a different practice problem.",
      "Keep replies under 120 words unless asked for more.",
    ],
    teach: [
      "Teach the topic as a short lesson: what it is, why it matters, the rule, one worked example, one check question at the end.",
      "Stay within 250 words; offer to go deeper on any part.",
    ],
    examples: [
      "Give two or three fully worked examples, every step shown and named, then one similar problem for the child to try.",
    ],
    practice: [
      "Write a set of practice questions (default five) of rising difficulty for the class level. Do NOT include answers unless the parent asks; end by inviting them to send the child's answers for checking.",
    ],
    score: [
      "The parent pastes questions with the child's answers. Mark each one: correct or not, the mark out of the total, the correct answer where wrong, and one sentence on what to practise. End with a total and one encouraging line.",
    ],
    homework: [
      "Work through the assignment with the parent step by step, fully explained, so they can sit with the child and do it together. Show the method for the first item completely; for the rest, show the working and let the child finish where sensible.",
    ],
    exam: [
      "Build exam preparation: the key points to revise, a short day-wise plan if a date is given, likely question types with one example each, and common mistakes to avoid.",
    ],
  };
  return [...common, ...byMode[mode], ...cleanCtx(ctx)].join("\n");
}

/** Token budget per mode — teaching needs room; a hint does not. */
export function tutorMaxTokens(mode: TutorMode): number {
  return mode === "hint" ? 900 : 1400;
}
