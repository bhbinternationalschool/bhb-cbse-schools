/**
 * ERP command desk — the pure half.
 *
 * A staff member sends one line ("5A me aaj kaun absent hai") over
 * WhatsApp, voice or the in-app assistant, and the ERP answers or acts.
 * Everything here is deterministic and runs without a network: the
 * command catalogue, the local parser, section/date resolution, the
 * confirm-token rules, the rate limiter and the reply formatters. The
 * server half (`erpCommands.server.ts`) adds the LLM fallback, RBAC,
 * data access and audit.
 *
 * Design rule: a command can only ever call a server function the app
 * already exposes. The catalogue is the complete list of what a message
 * can do, so the list of commands and the list of things a message can
 * break stay the same list.
 */

import type { MastersState } from "@/lib/masters";
import type { RbacAction, RbacModule } from "@/lib/rbac";

export type ErpCommandKind = "read" | "write";

export type ErpCommandFieldType = "section" | "date" | "text" | "student";

export type ErpCommandField = {
  name: string;
  type: ErpCommandFieldType;
  required: boolean;
  description: string;
};

export type ErpCommandDef = {
  id: string;
  title: string;
  kind: ErpCommandKind;
  /** RBAC gate — the same module/action the ERP screen checks. */
  module: RbacModule;
  action: RbacAction;
  /** One line for the LLM and for COMMANDS help. */
  description: string;
  /** What staff actually type — Hindi, English and mixed. */
  examples: string[];
  fields: ErpCommandField[];
  /**
   * `own_sections`: a teacher may only address sections they teach or
   * class-teach; office-like roles may address any. `any`: no section
   * scope applies.
   */
  scope: "own_sections" | "any";
};

/** Fields as extracted from the message, before ID resolution. */
export type ErpCommandFields = {
  section?: string;
  date?: string;
  text?: string;
  /** Student as written — a name, optionally with a class-section or roll. */
  student?: string;
};

export type ParsedErpCommand = {
  commandId: string;
  fields: ErpCommandFields;
  source: "local" | "llm";
};

export const ERP_COMMANDS: ErpCommandDef[] = [
  {
    id: "absent_list",
    title: "Absent list for a section",
    kind: "read",
    module: "attendance",
    action: "view",
    description:
      "Who is absent (or on leave / late) in one class-section on a date. Also says whether attendance has been marked at all.",
    examples: [
      "5A me aaj kaun absent hai",
      "absent list 7B",
      "class 3 A attendance today",
      "kal 10A me kaun nahi aaya",
      "8B hazri",
    ],
    fields: [
      {
        name: "section",
        type: "section",
        required: true,
        description: "Class and section, e.g. 5A, VIII B, class 3 section A, LKG A",
      },
      {
        name: "date",
        type: "date",
        required: false,
        description: "YYYY-MM-DD; today when not said. 'kal' / 'yesterday' means yesterday.",
      },
    ],
    scope: "own_sections",
  },
  {
    id: "attendance_summary",
    title: "Today's attendance summary",
    kind: "read",
    module: "attendance",
    action: "view",
    description:
      "School-wide attendance for a date: present percentage by class, sections not yet marked, and staff present / absent / not punched in. Teachers get their own sections only. No section in the message — a section means the absent list instead.",
    examples: [
      "attendance summary",
      "aaj ki attendance",
      "today's attendance",
      "kal ki attendance report",
      "school attendance status",
    ],
    fields: [
      {
        name: "date",
        type: "date",
        required: false,
        description: "YYYY-MM-DD; today when not said. 'kal' / 'yesterday' means yesterday.",
      },
    ],
    scope: "any",
  },
  {
    id: "pending_leaves",
    title: "Pending student leave requests",
    kind: "read",
    module: "student_leave",
    action: "view",
    description:
      "Student leave requests awaiting approval — oldest first, with student, class, dates, type, reason and who approves. Optionally one class-section. Teachers see their own sections; office and leadership the whole school.",
    examples: [
      "pending leaves",
      "leave requests",
      "5A leave requests",
      "kitni chutti pending hai",
      "leave approvals",
    ],
    fields: [
      {
        name: "section",
        type: "section",
        required: false,
        description: "Optional class-section to narrow to, e.g. 5A",
      },
    ],
    scope: "any",
  },
  {
    id: "free_teachers",
    title: "Free teachers in a period",
    kind: "read",
    module: "timetable",
    action: "view",
    description:
      "Teachers with no class in a given period on a date (or right now / next period): not on the grid, not substituting, not blocked, not absent — with each one's load that day. Also lists that period's uncovered classes when a teacher is absent.",
    examples: [
      "who is free in period 3",
      "period 3 me kaun free hai",
      "abhi kaun free hai",
      "free teachers next period",
      "kal 5th period kaun khali hai",
    ],
    fields: [
      {
        name: "text",
        type: "text",
        required: true,
        description: "The period: a number ('period 3', '3rd period'), 'now', or 'next'",
      },
      {
        name: "date",
        type: "date",
        required: false,
        description: "YYYY-MM-DD; today when not said. 'kal' here means tomorrow only if 'tomorrow' is said; otherwise yesterday.",
      },
    ],
    scope: "any",
  },
  {
    id: "collection_today",
    title: "Today's fee collection",
    kind: "read",
    module: "fees",
    action: "view",
    description:
      "Fees collected on a date: total and receipt count, by payment mode (cash, UPI, card, cheque, online links), cheques awaiting clearance, by counter / paper book / online, top cashiers, day-close status, month so far. Office and leadership only.",
    examples: [
      "aaj ka collection",
      "today's collection",
      "kal ka collection",
      "collection report",
      "aaj kitna cash aaya",
    ],
    fields: [
      {
        name: "date",
        type: "date",
        required: false,
        description: "YYYY-MM-DD; today when not said. 'kal' / 'yesterday' means yesterday.",
      },
    ],
    scope: "any",
  },
  {
    id: "class_defaulters",
    title: "Fee defaulters in a class or section",
    kind: "read",
    module: "fees",
    action: "view",
    description:
      "Students with overdue fees in one class (all sections) or one section: count, total outstanding, each student with amount and days overdue. Not a single student — that is the pending-fees command.",
    examples: [
      "Class 3 defaulters",
      "5A defaulters",
      "class 5 ke bakayedar",
      "fees pending list 7B",
      "class 3 me kisne fees nahi di",
    ],
    fields: [
      {
        name: "section",
        type: "section",
        required: true,
        description: "Class, or class and section, e.g. 'class 3' (all sections) or '5A'",
      },
    ],
    scope: "own_sections",
  },
  {
    id: "student_fees",
    title: "A student's pending fees",
    kind: "read",
    module: "fees",
    action: "view",
    description:
      "What one student owes: total due now, by month, by fee head, pay-ahead months, last receipt and the parent's mobile. Asks back when two students share the name.",
    examples: [
      "Amay ki fees pending",
      "show me all dues of Aarav Sharma",
      "Riya Verma dues",
      "fees Amay Gupta 4B",
      "Aarav ka kitna baki hai",
    ],
    fields: [
      {
        name: "student",
        type: "student",
        required: true,
        description: "Student name as written, plus class-section or roll if given, e.g. 'Amay Gupta 4B'",
      },
    ],
    scope: "own_sections",
  },
  {
    id: "commands_digest",
    title: "Today's command desk report (director)",
    kind: "read",
    module: "settings",
    action: "view",
    description:
      "Director only: what staff asked the ERP today over WhatsApp, the app and the assistant — counts by command, channel and person, plus anything denied.",
    examples: ["commands report", "commands digest", "aaj ke commands"],
    fields: [],
    scope: "any",
  },
  {
    id: "help",
    title: "List available commands",
    kind: "read",
    module: "attendance",
    action: "view",
    description: "Show the commands this staff member can use.",
    examples: ["commands", "command help", "?"],
    fields: [],
    scope: "any",
  },
];

export function findErpCommand(
  id: string,
  commands: ErpCommandDef[] = ERP_COMMANDS,
): ErpCommandDef | null {
  return commands.find((c) => c.id === id) ?? null;
}

// ─── Section resolution ────────────────────────────────────────────────

export type SectionMatch = {
  classId: string;
  sectionId: string;
  className: string;
  sectionName: string;
  label: string;
};

const ROMAN: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12,
};

const PRE_PRIMARY: Record<string, string> = {
  nursery: "nursery",
  nur: "nursery",
  "pre nursery": "prenursery",
  "pre-nursery": "prenursery",
  prenursery: "prenursery",
  pg: "playgroup",
  playgroup: "playgroup",
  "play group": "playgroup",
  lkg: "lkg",
  ukg: "ukg",
  kg: "kg",
  "kg1": "lkg",
  "kg2": "ukg",
  "kg 1": "lkg",
  "kg 2": "ukg",
  prep: "ukg",
};

/**
 * Normalise a class name from Masters ("VIII", "Class 8", "8th", "Grade 8",
 * "LKG", "Nursery") to a comparable key ("8", "lkg", "nursery"). Returns
 * null when the name carries no recognisable class.
 */
export function classKey(name: string): string | null {
  const raw = (name || "").trim().toLowerCase();
  if (!raw) return null;
  const stripped = raw
    .replace(/^(class|grade|std|standard|kaksha|कक्षा)\s*/i, "")
    .replace(/\s*(th|st|nd|rd)$/i, "")
    .trim();
  if (PRE_PRIMARY[stripped]) return PRE_PRIMARY[stripped];
  if (/^\d{1,2}$/.test(stripped)) return String(parseInt(stripped, 10));
  if (ROMAN[stripped]) return String(ROMAN[stripped]);
  // "Class 5 A" style names carry the section too — take the class part.
  const m = /^(\d{1,2}|[ivx]{1,4}|nursery|lkg|ukg|kg|pg)\b/.exec(stripped);
  if (m) return classKey(m[1]!);
  return null;
}

/**
 * Pull "class + section" references out of free text: "5A", "5 A", "5-A",
 * "class 5 section A", "5th A", "VIII B", "viii-b", "LKG A", "nursery b".
 * Returns every distinct reference found, in order. A class without a
 * section letter is returned with sectionName "".
 */
export function extractSectionRefs(
  text: string,
): { classKey: string; sectionName: string }[] {
  const low = ` ${(text || "").toLowerCase()} `;
  const out: { classKey: string; sectionName: string }[] = [];
  const seen = new Set<string>();
  const push = (ck: string | null, sec: string) => {
    if (!ck) return;
    const key = `${ck}|${sec}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ classKey: ck, sectionName: sec });
  };

  // class <n> section <x> / class <n> <x> / class <n>
  // \b is ASCII-only, so the Hindi "कक्षा" needs letter lookarounds.
  const classRe =
    /(?<![\p{L}\p{M}\p{N}])(?:class|grade|std|kaksha|कक्षा)\s*(\d{1,2}|[ivx]{1,4}|nursery|lkg|ukg|kg|pg)(?:st|nd|rd|th)?\s*(?:-|\s)?\s*(?:section|sec|sec\.)?\s*([a-h])?(?![\p{L}\p{M}\p{N}])/gu;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(low))) {
    push(classKey(m[1]!), (m[2] || "").toUpperCase());
  }

  // bare "5A", "5 A", "5-A", "5th A", "viii b", "lkg a", "ukg-b"
  const bareRe =
    /(?<![a-z0-9])(\d{1,2}|[ivx]{1,4}|nursery|lkg|ukg|kg|pg)(?:st|nd|rd|th)?\s*-?\s*([a-h])(?![a-z0-9])/g;
  while ((m = bareRe.exec(low))) {
    const ck = classKey(m[1]!);
    if (!ck) continue;
    // Roman "i a" / "x a" false positives: require the class token to be
    // digits, a known word, or a roman numeral of 2+ letters, unless the
    // text has no other candidate — "v a" alone is too ambiguous.
    if (/^[ivx]$/.test(m[1]!) && out.length) continue;
    push(ck, m[2]!.toUpperCase());
  }

  return out;
}

/**
 * Resolve a section reference against Masters. Class names in Masters are
 * whatever the school typed ("VIII", "Class 8", "8"); the match goes
 * through classKey() on both sides. A class with exactly one active
 * section resolves even when no letter was given.
 */
export function resolveSectionRef(
  ref: { classKey: string; sectionName: string },
  masters: Pick<MastersState, "classes" | "sections">,
): { ok: true; match: SectionMatch } | { ok: false; reason: "no_class" | "no_section" | "ambiguous"; options: SectionMatch[] } {
  const classes = (masters.classes ?? []).filter(
    (c) => c.isActive !== false && classKey(c.name) === ref.classKey,
  );
  if (!classes.length) return { ok: false, reason: "no_class", options: [] };
  const options: SectionMatch[] = [];
  for (const c of classes) {
    for (const s of (masters.sections ?? []).filter(
      (x) => x.classId === c.id && x.isActive !== false,
    )) {
      options.push({
        classId: c.id,
        sectionId: s.id,
        className: c.name,
        sectionName: s.name,
        label: `${c.name} ${s.name}`.trim(),
      });
    }
  }
  if (!options.length) return { ok: false, reason: "no_section", options: [] };
  if (ref.sectionName) {
    const want = ref.sectionName.toLowerCase();
    const hit = options.filter((o) => {
      const n = o.sectionName.toLowerCase().replace(/^(section|sec\.?)\s*/, "");
      return n === want;
    });
    if (hit.length === 1) return { ok: true, match: hit[0]! };
    if (hit.length > 1) return { ok: false, reason: "ambiguous", options: hit };
    return { ok: false, reason: "no_section", options };
  }
  if (options.length === 1) return { ok: true, match: options[0]! };
  return { ok: false, reason: "ambiguous", options };
}

// ─── Date resolution ───────────────────────────────────────────────────

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Date the message refers to. Relative words first (today / kal /
 * yesterday / parso), then dd/mm or dd-mm (current year, or last year when
 * that would land in the future), then an explicit YYYY-MM-DD. Defaults
 * to today. "kal" is ambiguous in Hindi (yesterday or tomorrow); for
 * attendance it can only mean yesterday, and the reply says the date.
 */
export function resolveCommandDate(text: string, todayIso: string): string {
  const low = (text || "").toLowerCase();
  const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(low);
  if (iso) return iso[1]!;
  if (/\b(day before|parso|परसों)\b/.test(low)) return shiftIso(todayIso, -2);
  if (/\b(yesterday|kal|कल|beete kal)\b/.test(low)) return shiftIso(todayIso, -1);
  const dm = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b/.exec(low);
  if (dm) {
    const d = parseInt(dm[1]!, 10);
    const mo = parseInt(dm[2]!, 10);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      let y = dm[3] ? parseInt(dm[3]!, 10) : parseInt(todayIso.slice(0, 4), 10);
      let candidate = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (!dm[3] && candidate > todayIso) {
        y -= 1;
        candidate = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      }
      return candidate;
    }
  }
  return todayIso;
}

// ─── Local parser ──────────────────────────────────────────────────────

// \b is ASCII-only in JS, so Hindi words need explicit letter lookarounds.
const ABSENT_WORDS =
  /(?<![\p{L}\p{M}\p{N}])(absent|absentee|absentees|gair\s*hazir|gairhazir|गैर\s*हाज़िर|गैरहाजिर|अनुपस्थित|nahi\s+aaya|nahi\s+aaye|नहीं\s+आया|नहीं\s+आए|hazri|haziri|हाज़िरी|हाजिरी|attendance|upasthiti|उपस्थिति|(?:on|pe|par)\s+leave|leave\s+(?:pe|par)|chutti\s+(?:pe|par)|छुट्टी\s+पर)(?![\p{L}\p{M}\p{N}])/iu;

const HELP_WORDS = /^\s*(commands?|command\s+help|cmd|कमांड|\?)\s*$/i;

/**
 * The day's takings: "aaj ka collection", "today's collection", "collection
 * report", "aaj kitna cash aaya", "कलेक्शन". Not with a class (a class plus
 * fee words is the defaulters list) and not a student's name.
 */
const COLLECTION_WORDS =
  /(?<![\p{L}\p{M}\p{N}])(collections?|कलेक्शन|वसूली|vasooli|vasuli|(?:kitna|kitni|how\s+much)\s+(?:cash|paisa|paise|fees?|money)\s+(?:aaya|aayi|aya|mila|mili|collected|came)|day\s*close|cash\s+(?:in\s+hand|today|aaj))(?![\p{L}\p{M}\p{N}])/iu;

/** A class or section plus one of these is the defaulters list. */
const DEFAULTER_WORDS =
  /(?<![\p{L}\p{M}\p{N}])(defaulters?|bakayedar|bakaayedar|बकायेदार|(?:fees?|dues?)\s+(?:pending|due|baki|bakaya)(?:\s+list)?|(?:fee|fees|dues?)\s+(?:list|report)|(?:kisne|kis\s*kis\s*ne|kaun\s*kaun)\s+fees?\s+nahi|fees?\s+nahi\s+(?:di|diya|diye|bhari)|overdue)(?![\p{L}\p{M}\p{N}])/iu;

/**
 * Attendance without a section is the school (or the teacher's sections):
 * "attendance summary", "aaj ki attendance", "today's attendance", "kitne
 * present". Requires an attendance word; "absent" alone is not enough,
 * because "absent" with no section is a half-typed absent-list ask.
 */
const ATTENDANCE_SUMMARY_WORDS =
  /(?<![\p{L}\p{M}\p{N}])(attendance|hazri|haziri|हाज़िरी|हाजिरी|upasthiti|उपस्थिति|kitne\s+present|present\s+percent(age)?)(?![\p{L}\p{M}\p{N}])/iu;

const DIGEST_WORDS =
  /^\s*(commands?\s+(report|digest|summary|log)|(aaj|today)\s*(ke|ka|'s)?\s*commands?|ai\s+(report|digest))\s*$/i;

/**
 * Regex fast path — no model call for the commands staff send all day.
 * Returns null when nothing matched with confidence; the server then
 * decides whether the message is worth an LLM parse.
 */
export function parseErpCommandLocal(text: string): ParsedErpCommand | null {
  const t = (text || "").trim();
  if (!t) return null;
  if (HELP_WORDS.test(t)) {
    return { commandId: "help", fields: {}, source: "local" };
  }
  if (DIGEST_WORDS.test(t)) {
    return { commandId: "commands_digest", fields: {}, source: "local" };
  }
  const freeQ = parseFreeTeachersQuery(t);
  if (freeQ) {
    return { commandId: "free_teachers", fields: { text: freeQ, date: "" }, source: "local" };
  }
  if (COLLECTION_WORDS.test(t) && !extractSectionRefs(t).length) {
    return { commandId: "collection_today", fields: { date: "" }, source: "local" };
  }
  // Leave queue before any fee reading: "pending" and "baki" are fee words
  // too, but "chutti pending" is about leave.
  if (LEAVE_WORDS.test(t) && !ABSENT_WORDS.test(t) && !/(?<![\p{L}\p{M}])(fees?|dues?|फीस|बकाया)(?![\p{L}\p{M}])/iu.test(t)) {
    const lr = extractSectionRefs(t)[0];
    return {
      commandId: "pending_leaves",
      fields: { section: lr ? `${lr.classKey}${lr.sectionName}` : "" },
      source: "local",
    };
  }
  const refs = extractSectionRefs(t);
  const feesQ = parseStudentFeesQuery(t);
  // A class plus a defaulter word is the class list — unless a name is also
  // there ("Amay Gupta 4B fees pending" is one student).
  if (refs.length && DEFAULTER_WORDS.test(t) && !feesQ?.name) {
    const r = refs[0]!;
    return {
      commandId: "class_defaulters",
      fields: { section: r.sectionName ? `${r.classKey}${r.sectionName}` : r.classKey },
      source: "local",
    };
  }
  if (feesQ) {
    return {
      commandId: "student_fees",
      fields: {
        student: [feesQ.name, feesQ.section ? `${feesQ.section.classKey}${feesQ.section.sectionName}` : "", feesQ.rollNo ? `roll ${feesQ.rollNo}` : ""]
          .filter(Boolean)
          .join(" "),
      },
      source: "local",
    };
  }
  if (!refs.length && ATTENDANCE_SUMMARY_WORDS.test(t) && !FEE_WORDS.test(t)) {
    return { commandId: "attendance_summary", fields: { date: "" }, source: "local" };
  }
  if (refs.length && ABSENT_WORDS.test(t)) {
    const r = refs[0]!;
    return {
      commandId: "absent_list",
      fields: {
        section: r.sectionName ? `${r.classKey}${r.sectionName}` : r.classKey,
        date: "",
      },
      source: "local",
    };
  }
  return null;
}

/**
 * Whether an unmatched message deserves a model parse. Kept narrow on
 * purpose: for teachers every free-text message is otherwise a class
 * channel post, and for owners it is a general question — a model call on
 * each of those would be cost with no upside. A command looks like a
 * question or an instruction about school data.
 */
export function looksLikeCommand(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 4 || t.length > 300) return false;
  if (/\?$/.test(t)) return true;
  return /\b(kaun|kon|kitna|kitne|kya|batao|bata|dikhao|dikha|list|show|status|kitni|how many|who|which|pending|due|dues|defaulter|fees?|absent|present|attendance|roster|manifest|leave|homework|कौन|कितना|कितने|बताओ|दिखाओ|फीस|बकाया)\b/i.test(
    t,
  );
}

// ─── LLM parse contract ────────────────────────────────────────────────

export type ErpCommandLlmParse = {
  command: string; // command id or "none"
  section?: string;
  date?: string;
  text?: string;
  student?: string;
  confidence: number; // 0..1
};

/** Strict validation of the model's JSON — anything odd becomes null. */
export function parseErpCommandLlmJson(
  raw: string,
  commands: ErpCommandDef[] = ERP_COMMANDS,
): ErpCommandLlmParse | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const command = typeof o.command === "string" ? o.command.trim() : "";
  if (!command) return null;
  if (command !== "none" && !commands.some((c) => c.id === command)) return null;
  const confidence =
    typeof o.confidence === "number" && Number.isFinite(o.confidence)
      ? Math.max(0, Math.min(1, o.confidence))
      : 0;
  const str = (k: string) =>
    typeof o[k] === "string" ? (o[k] as string).trim().slice(0, 120) : undefined;
  return {
    command,
    section: str("section"),
    date: str("date"),
    text: str("text"),
    student: str("student"),
    confidence,
  };
}

export const ERP_COMMAND_LLM_MIN_CONFIDENCE = 0.7;

export function buildErpCommandSystemPrompt(opts: {
  commands: ErpCommandDef[];
  todayIso: string;
}): string {
  const lines = opts.commands.map((c) => {
    const fields = c.fields
      .map((f) => `${f.name}${f.required ? "" : "?"}: ${f.description}`)
      .join("; ");
    return `- ${c.id}: ${c.description}${fields ? ` Fields — ${fields}.` : ""} Examples: ${c.examples.map((e) => `"${e}"`).join(", ")}`;
  });
  return [
    "You map one WhatsApp message from a school staff member (Hindi, English or mixed Hinglish) to exactly one ERP command, or to none.",
    `Today is ${opts.todayIso} (India).`,
    "Commands:",
    ...lines,
    "",
    'Respond with JSON only: {"command": "<id or none>", "section": "<as written, e.g. 5A>", "date": "<YYYY-MM-DD or empty>", "student": "<student name as written, with class/roll if said>", "text": "<free text if a command needs it>", "confidence": <0..1>}.',
    "A student's name is a name, not a section: 'Amay ki fees' has student=Amay and no section.",
    'If the message is a greeting, a chat, a question about something not in the list, or you are unsure, answer {"command":"none","confidence":0}.',
    "Never invent a section or date that the message does not say. Leave date empty for today.",
  ].join("\n");
}

// ─── Confirm tokens (write commands) ───────────────────────────────────

export const ERP_CONFIRM_TTL_MS = 5 * 60 * 1000;

export type PendingErpConfirm = {
  token: string;
  commandId: string;
  fields: ErpCommandFields;
  /** Resolved IDs the confirm card was shown for — re-resolution is not allowed. */
  resolved: Record<string, string>;
  summary: string;
  createdAt: string;
  originalText: string;
};

export function confirmButtonIds(token: string): { yes: string; no: string } {
  return { yes: `cmd_yes_${token}`, no: `cmd_no_${token}` };
}

/** "yes" / "haan" / button id → decision, or null when the text is unrelated. */
export function parseConfirmReply(
  text: string,
  pending: PendingErpConfirm | null | undefined,
  opts?: { allowPlainWords?: boolean },
): { decision: "yes" | "no"; token: string } | null {
  const t = (text || "").trim();
  const btn = /^cmd_(yes|no)_([A-Za-z0-9_-]{6,})$/.exec(t);
  if (btn) return { decision: btn[1] as "yes" | "no", token: btn[2]! };
  if (!pending || opts?.allowPlainWords === false) return null;
  if (/^(yes|y|haan|ha|han|ok|okay|confirm|हाँ|हां|ठीक)$/i.test(t)) {
    return { decision: "yes", token: pending.token };
  }
  if (/^(no|n|nahi|nahin|cancel|रद्द|नहीं)$/i.test(t)) {
    return { decision: "no", token: pending.token };
  }
  return null;
}

export function confirmIsFresh(
  pending: PendingErpConfirm,
  nowMs: number,
  ttlMs = ERP_CONFIRM_TTL_MS,
): boolean {
  const created = Date.parse(pending.createdAt);
  if (!Number.isFinite(created)) return false;
  return nowMs - created <= ttlMs;
}

// ─── Rate limit ────────────────────────────────────────────────────────

export const ERP_COMMANDS_PER_HOUR = 30;

/**
 * Per-staff sliding hour. Pure over a timestamp list so it can live in the
 * persisted bot store (multi-instance safe enough) and be unit-tested.
 */
export function noteCommandUse(
  history: number[] | undefined,
  nowMs: number,
  limit = ERP_COMMANDS_PER_HOUR,
): { allowed: boolean; history: number[] } {
  const hour = 60 * 60 * 1000;
  const recent = (history ?? []).filter((t) => nowMs - t < hour);
  if (recent.length >= limit) return { allowed: false, history: recent };
  recent.push(nowMs);
  return { allowed: true, history: recent };
}

// ─── Reply formatting ──────────────────────────────────────────────────

export type AbsentListInput = {
  sectionLabel: string;
  date: string;
  todayIso: string;
  marked: boolean;
  total: number;
  absent: { rollNo: string; fullName: string }[];
  leave: { rollNo: string; fullName: string }[];
  late: { rollNo: string; fullName: string }[];
  halfDay: { rollNo: string; fullName: string }[];
};

function fmtDate(iso: string, todayIso: string): string {
  if (iso === todayIso) return "today";
  return shortDate(iso);
}

function nameList(rows: { rollNo: string; fullName: string }[]): string {
  return rows
    .slice()
    .sort((a, b) => (parseInt(a.rollNo, 10) || 9999) - (parseInt(b.rollNo, 10) || 9999))
    .map((r) => (r.rollNo ? `${r.rollNo}. ${r.fullName}` : r.fullName))
    .join("\n");
}

export function formatAbsentListReply(input: AbsentListInput): string {
  const when = fmtDate(input.date, input.todayIso);
  const head = `*${input.sectionLabel}* · ${when}`;
  if (input.total === 0) {
    return `${head}\nNo active students found in this section.`;
  }
  if (!input.marked) {
    return `${head}\nAttendance not marked yet (${input.total} students).`;
  }
  const present =
    input.total -
    input.absent.length -
    input.leave.length -
    input.late.length -
    input.halfDay.length;
  const parts: string[] = [
    head,
    `Present ${present} / ${input.total}` +
      (input.absent.length ? ` · Absent ${input.absent.length}` : "") +
      (input.leave.length ? ` · Leave ${input.leave.length}` : "") +
      (input.late.length ? ` · Late ${input.late.length}` : "") +
      (input.halfDay.length ? ` · Half day ${input.halfDay.length}` : ""),
  ];
  if (input.absent.length) parts.push(`\n*Absent*\n${nameList(input.absent)}`);
  else parts.push("\nNo one absent.");
  if (input.leave.length) parts.push(`\n*On leave*\n${nameList(input.leave)}`);
  if (input.late.length) parts.push(`\n*Late*\n${nameList(input.late)}`);
  if (input.halfDay.length) parts.push(`\n*Half day*\n${nameList(input.halfDay)}`);
  return parts.join("\n");
}

export function formatSectionProblem(
  reason: "no_class" | "no_section" | "ambiguous" | "not_allowed",
  options: SectionMatch[],
  asked: string,
): string {
  switch (reason) {
    case "no_class":
      return `I couldn't find a class matching "${asked}". Try the class as it appears in the ERP, e.g. 5A or VIII B.`;
    case "no_section":
      return options.length
        ? `Which section? ${options.map((o) => o.label).join(", ")}`
        : `No active section found for "${asked}".`;
    case "ambiguous":
      return `Which one did you mean? ${options.map((o) => o.label).join(", ")}`;
    case "not_allowed":
      return `You can ask about your own sections only${options.length ? `: ${options.map((o) => o.label).join(", ")}` : ""}. Ask the office or principal for other classes.`;
  }
}

export function formatHelpReply(
  commands: ErpCommandDef[],
  displayName: string,
): string {
  const lines = commands.map((c) => `• ${c.title}\n   e.g. _${c.examples[0]}_`);
  const name = displayName ? `${displayName}, ` : "";
  return `${name}you can send me these commands:\n\n${lines.join("\n")}\n\nJust type it the way you'd say it — Hindi or English.`;
}

/** Owner-only pause switch: "commands off" / "commands on". */
export function parseCommandsSwitch(text: string): "on" | "off" | null {
  const t = (text || "").trim().toLowerCase();
  if (/^commands?\s+(off|pause|stop|band)$/.test(t)) return "off";
  if (/^commands?\s+(on|resume|start|chalu|chalu karo)$/.test(t)) return "on";
  return null;
}

/**
 * The engine writes WhatsApp markers (*bold*, _italic_). The in-ERP
 * assistant renders **bold** only, so bold is doubled and italics are
 * dropped to plain text. Button ids (cmd_yes_…) never pass through here.
 */
export function waMarkersToAssistantText(text: string): string {
  return (text || "")
    .replace(/(^|[^*])\*(\S(?:[^*\n]*\S)?)\*(?!\*)/g, "$1**$2**")
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?])/g, "$1$2");
}

// ─── Daily digest for the director ─────────────────────────────────────

/** One audit row from module `erp_commands`, as the digest reads it. */
export type CommandAuditRow = {
  actorName: string;
  actorEmail: string | null;
  action: string;
  entityId: string;
  summary: string;
  after: Record<string, unknown> | null;
  createdAt: string;
};

export type CommandDigestStats = {
  total: number;
  ok: number;
  denied: number;
  errors: number;
  writes: number;
  voice: number;
  byChannel: { channel: string; count: number }[];
  byCommand: { commandId: string; count: number }[];
  byActor: { name: string; count: number; denied: number }[];
  deniedRows: { name: string; text: string; reason: string; at: string }[];
  writeRows: { name: string; text: string; at: string }[];
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function stripSummaryPrefix(summary: string): string {
  return summary.replace(/^(WhatsApp|App) command \((ok|denied|error)\): /, "");
}

function countBy<T>(rows: T[], key: (r: T) => string): { k: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()]
    .map(([k, count]) => ({ k, count }))
    .sort((a, b) => b.count - a.count || a.k.localeCompare(b.k));
}

export function summarizeCommandAudit(rows: CommandAuditRow[]): CommandDigestStats {
  const outcome = (r: CommandAuditRow) => str(r.after?.outcome) || "ok";
  const denied = rows.filter((r) => outcome(r) === "denied");
  const errors = rows.filter((r) => outcome(r) === "error");
  const writes = rows.filter((r) => r.action === "edit" && outcome(r) === "ok");
  const actorStats = new Map<string, { count: number; denied: number }>();
  for (const r of rows) {
    const name = r.actorName || r.actorEmail || "Unknown";
    const cur = actorStats.get(name) ?? { count: 0, denied: 0 };
    cur.count += 1;
    if (outcome(r) === "denied") cur.denied += 1;
    actorStats.set(name, cur);
  }
  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    });
  };
  return {
    total: rows.length,
    ok: rows.filter((r) => outcome(r) === "ok").length,
    denied: denied.length,
    errors: errors.length,
    writes: writes.length,
    voice: rows.filter((r) => r.after?.voice === true).length,
    byChannel: countBy(rows, (r) => str(r.after?.channel) || "whatsapp").map((x) => ({
      channel: x.k,
      count: x.count,
    })),
    byCommand: countBy(rows, (r) => r.entityId || str(r.after?.command) || "?").map((x) => ({
      commandId: x.k,
      count: x.count,
    })),
    byActor: [...actorStats.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    deniedRows: denied.map((r) => ({
      name: r.actorName || r.actorEmail || "Unknown",
      text: stripSummaryPrefix(r.summary),
      reason: str(r.after?.reason) || "denied",
      at: fmtTime(r.createdAt),
    })),
    writeRows: writes.map((r) => ({
      name: r.actorName || r.actorEmail || "Unknown",
      text: stripSummaryPrefix(r.summary),
      at: fmtTime(r.createdAt),
    })),
  };
}

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  app: "App / assistant",
};

/**
 * The director's end-of-day line on the command desk. Short enough to read
 * on a phone: totals, who used it, what was denied, every write. WhatsApp
 * markers; the assistant path converts them.
 */
export function formatCommandDigest(
  stats: CommandDigestStats,
  opts: { date: string; paused: boolean; pausedBy?: string; commands?: ErpCommandDef[] },
): string {
  const d = new Date(`${opts.date}T00:00:00Z`);
  const dateLabel = Number.isNaN(d.getTime())
    ? opts.date
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  const lines: string[] = [`*ERP commands · ${dateLabel}*`];
  if (opts.paused) {
    lines.push(`⏸ Commands are paused${opts.pausedBy ? ` by ${opts.pausedBy}` : ""}.`);
  }
  if (stats.total === 0) {
    lines.push("No commands today.");
    return lines.join("\n");
  }
  const head = [`${stats.total} command${stats.total === 1 ? "" : "s"}`];
  if (stats.writes) head.push(`${stats.writes} write${stats.writes === 1 ? "" : "s"}`);
  if (stats.denied) head.push(`${stats.denied} denied`);
  if (stats.errors) head.push(`${stats.errors} failed`);
  if (stats.voice) head.push(`${stats.voice} by voice`);
  lines.push(head.join(" · "));
  lines.push(
    stats.byChannel.map((c) => `${CHANNEL_LABEL[c.channel] || c.channel} ${c.count}`).join(" · "),
  );
  const title = (id: string) =>
    (opts.commands ?? ERP_COMMANDS).find((c) => c.id === id)?.title || id;
  lines.push("", "*By command*");
  for (const c of stats.byCommand.slice(0, 6)) lines.push(`${c.count} × ${title(c.commandId)}`);
  lines.push("", "*Who*");
  for (const a of stats.byActor.slice(0, 6)) {
    lines.push(`${a.name} ${a.count}${a.denied ? ` (${a.denied} denied)` : ""}`);
  }
  if (stats.byActor.length > 6) lines.push(`+${stats.byActor.length - 6} more`);
  if (stats.writeRows.length) {
    lines.push("", "*Writes*");
    for (const w of stats.writeRows.slice(0, 10)) lines.push(`${w.at} ${w.name}: ${w.text}`);
    if (stats.writeRows.length > 10) lines.push(`+${stats.writeRows.length - 10} more`);
  }
  if (stats.deniedRows.length) {
    lines.push("", "*Denied*");
    for (const r of stats.deniedRows.slice(0, 5)) {
      lines.push(`${r.at} ${r.name}: ${r.text} (${r.reason === "scope" ? "not their section" : r.reason === "rbac" ? "no permission" : r.reason})`);
    }
    if (stats.deniedRows.length > 5) lines.push(`+${stats.deniedRows.length - 5} more`);
  }
  return lines.join("\n");
}

/** One line, no newlines — for a WhatsApp template parameter or a push body. */
export function formatCommandDigestOneLine(stats: CommandDigestStats, date: string): string {
  if (stats.total === 0) return `ERP commands ${date}: none.`;
  const parts = [`${stats.total} commands`];
  if (stats.writes) parts.push(`${stats.writes} writes`);
  if (stats.denied) parts.push(`${stats.denied} denied`);
  const top = stats.byActor[0];
  if (top) parts.push(`most by ${top.name} (${top.count})`);
  return `ERP commands ${date}: ${parts.join(", ")}.`;
}

// ─── Student fees: query parsing, matching, formatting ─────────────────

export type StudentFeesQuery = {
  /** Name words as typed, lower-cased, without the fee words. */
  name: string;
  section?: { classKey: string; sectionName: string };
  rollNo?: string;
};

const FEE_WORDS =
  /(?<![\p{L}\p{M}\p{N}])(fees?|dues?|pending|baki|bakaya|bakaaya|balance|outstanding|ledger|बकाया|फीस|बाकी)(?![\p{L}\p{M}\p{N}])/iu;

const FEE_STOP_WORDS = new Set([
  "show", "me", "all", "the", "of", "for", "please", "pls", "plz", "student", "students",
  "ki", "ka", "ke", "ko", "kitni", "kitna", "kitne", "hai", "h", "hain", "kya", "batao", "bata",
  "dikhao", "dikha", "do", "dena", "check", "what", "is", "are", "how", "much", "today", "aaj",
  "total", "pending", "fee", "fees", "due", "dues", "baki", "bakaya", "bakaaya", "balance",
  "outstanding", "ledger", "amount", "paisa", "paise", "rupees", "rs",
  "kisne", "kis", "kaun", "nahi", "nahin", "di", "diya", "diye", "bhari", "list", "report",
  "defaulter", "defaulters", "bakayedar", "bakaayedar", "overdue", "mein", "wale", "walo",
  "बकाया", "फीस", "बाकी", "की", "का", "के", "कितनी", "कितना", "है", "दिखाओ", "बताओ",
]);

/**
 * "Amay ki fees pending", "show me all dues of Aarav Sharma", "fees Amay
 * Gupta 4B", "roll 12 4B fees". Null unless a fee word is present and at
 * least one name word survives — a section on its own ("class 3 fees") is a
 * class question, not a student one.
 */
export function parseStudentFeesQuery(text: string): StudentFeesQuery | null {
  const t = (text || "").trim();
  if (!t || !FEE_WORDS.test(t)) return null;
  let rest = t.toLowerCase();
  let rollNo: string | undefined;
  const roll = /\broll\s*(?:no\.?|number)?\s*(\d{1,3})\b/.exec(rest);
  if (roll) {
    rollNo = roll[1]!;
    rest = rest.replace(roll[0], " ");
  }
  const refs = extractSectionRefs(rest);
  const section = refs[0];
  if (section) {
    rest = rest
      .replace(/\b(?:class|grade|std|kaksha|कक्षा)\s*[a-z0-9]+(?:st|nd|rd|th)?\s*(?:-|\s)?\s*(?:section|sec\.?)?\s*[a-h]?\b/g, " ")
      .replace(/(?<![a-z0-9])(\d{1,2}|[ivx]{1,4}|nursery|lkg|ukg|kg|pg)(?:st|nd|rd|th)?\s*-?\s*[a-h](?![a-z0-9])/g, " ");
  }
  const words = rest
    .replace(/[^\p{L}\p{M}\p{N}\s'.-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[.'-]+|[.'-]+$/g, ""))
    .filter((w) => w && !FEE_STOP_WORDS.has(w) && !/^\d+$/.test(w));
  const name = words.join(" ").trim();
  if (!name || !/[\p{L}\p{M}]{2,}/u.test(name)) {
    return rollNo && section ? { name: "", section, rollNo } : null;
  }
  return { name, ...(section ? { section } : {}), ...(rollNo ? { rollNo } : {}) };
}

export type StudentLike = {
  id: string;
  fullName: string;
  admissionNo?: string;
  rollNo: string;
  classId: string;
  sectionId: string;
  status: string;
  academicYearCode: string;
};

export type StudentMatch<T extends StudentLike = StudentLike> = {
  student: T;
  /** 3 exact full name · 2 every word matched · 1 first-name only */
  score: number;
};

function nameTokens(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Rank active students of the year against a typed name. Every typed word
 * must start some word of the student's name (so "Aarav Sh" finds Aarav
 * Sharma, and "Sharma" finds every Sharma). A section or roll in the query
 * narrows first. Admission number matches exactly.
 */
export function matchStudents<T extends StudentLike>(
  query: StudentFeesQuery,
  students: T[],
  opts: {
    academicYearCode: string;
    /** Resolved from the query's section ref, when it resolved. */
    sectionId?: string | null;
    limit?: number;
  },
): StudentMatch<T>[] {
  const q = nameTokens(query.name);
  const pool = students.filter(
    (s) =>
      s.status === "active" &&
      s.academicYearCode === opts.academicYearCode &&
      (!opts.sectionId || s.sectionId === opts.sectionId) &&
      (!query.rollNo || String(parseInt(s.rollNo, 10)) === String(parseInt(query.rollNo, 10))),
  );
  if (!q.length) {
    return (query.rollNo && opts.sectionId ? pool : []).map((student) => ({ student, score: 2 }));
  }
  const out: StudentMatch<T>[] = [];
  for (const s of pool) {
    if (s.admissionNo && q.length === 1 && s.admissionNo.toLowerCase() === q[0]) {
      out.push({ student: s, score: 3 });
      continue;
    }
    const nt = nameTokens(s.fullName);
    const every = q.every((w) => nt.some((n) => n.startsWith(w)));
    if (!every) continue;
    const exact = q.length === nt.length && q.every((w, i) => nt[i] === w);
    out.push({ student: s, score: exact ? 3 : q.length > 1 ? 2 : 1 });
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      a.student.fullName.localeCompare(b.student.fullName),
  );
  // One exact full-name match beats any number of prefix matches.
  if (out.length > 1 && out[0]!.score === 3 && out[1]!.score < 3) return out.slice(0, 1);
  return out.slice(0, opts.limit ?? 6);
}

export type StudentFeesDue = {
  label: string; // installment / month label
  headName: string;
  kind: string;
  dueOn: string;
  balancePaise: number;
  billedPaise: number;
  concessionPaise: number;
  concessionNames: string[];
  future: boolean;
};

export type StudentFeesInput = {
  studentName: string;
  classLabel: string;
  rollNo: string;
  todayIso: string;
  dues: StudentFeesDue[];
  lastReceipt: { receiptNo: string; date: string; amountPaise: number; modes: string[] } | null;
  parentMobile: string;
  siblings: { name: string; classLabel: string; duePaise: number }[];
  /** full: fee desk / leadership — concession names and sibling line. */
  detail: "full" | "basic";
  formatInr: (paise: number) => string;
};

function maskMobile(m: string): string {
  const d = (m || "").replace(/\D/g, "");
  if (d.length < 6) return d;
  return `${d.slice(0, 2)}xxxxxx${d.slice(-2)}`;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-04" → "4 Sep". Fixed table: Node's en-IN says "Sept", browsers say "Sep". */
function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return iso;
  const month = MONTH_SHORT[parseInt(m[2]!, 10) - 1];
  return month ? `${parseInt(m[3]!, 10)} ${month}` : iso;
}

export function formatStudentFeesReply(input: StudentFeesInput): string {
  const inr = input.formatInr;
  const head = `*${input.studentName}* · ${input.classLabel}${input.rollNo ? ` · Roll ${input.rollNo}` : ""}`;
  const now = input.dues.filter((d) => !d.future && d.balancePaise > 0);
  const ahead = input.dues.filter((d) => d.future && d.balancePaise > 0);
  const total = now.reduce((s, d) => s + d.balancePaise, 0);
  const lines: string[] = [head];

  if (!now.length) {
    lines.push("No dues pending today. ✅");
  } else {
    const overdue = now.filter((d) => d.dueOn && d.dueOn < input.todayIso).map((d) => d.dueOn).sort()[0];
    lines.push(
      `Total due today: *${inr(total)}*${overdue ? `   (overdue since ${shortDate(overdue)})` : ""}`,
    );
    // By month / installment, in due-date order.
    const byMonth = new Map<string, { paise: number; dueOn: string }>();
    for (const d of now) {
      const cur = byMonth.get(d.label) ?? { paise: 0, dueOn: d.dueOn };
      cur.paise += d.balancePaise;
      if (d.dueOn < cur.dueOn) cur.dueOn = d.dueOn;
      byMonth.set(d.label, cur);
    }
    const months = [...byMonth.entries()].sort((a, b) => a[1].dueOn.localeCompare(b[1].dueOn));
    if (months.length > 1 || months[0]?.[0]) {
      lines.push("", "*By month*");
      for (const [label, v] of months) lines.push(`${label}   ${inr(v.paise)}`);
    }
    // By head, largest first, with the concession applied where allowed.
    const byHead = new Map<string, { paise: number; concession: number; names: Set<string>; labels: Set<string> }>();
    for (const d of now) {
      const cur = byHead.get(d.headName) ?? { paise: 0, concession: 0, names: new Set(), labels: new Set() };
      cur.paise += d.balancePaise;
      cur.concession += d.concessionPaise;
      for (const n of d.concessionNames) cur.names.add(n);
      cur.labels.add(d.label);
      byHead.set(d.headName, cur);
    }
    lines.push("", "*By head*");
    for (const [name, v] of [...byHead.entries()].sort((a, b) => b[1].paise - a[1].paise)) {
      let note = "";
      if (v.concession > 0) {
        note =
          input.detail === "full" && v.names.size
            ? `  (${inr(v.concession)} ${[...v.names].join(", ")} concession applied)`
            : `  (${inr(v.concession)} concession applied)`;
      }
      lines.push(`${name}   ${inr(v.paise)}${note}`);
    }
  }

  if (ahead.length) {
    const aheadTotal = ahead.reduce((s, d) => s + d.balancePaise, 0);
    const labels = [...new Set(ahead.map((d) => d.label))];
    const span = labels.length > 2 ? `${labels[0]} to ${labels[labels.length - 1]}` : labels.join(", ");
    lines.push("", `Pay-ahead, not yet due: ${span}, ${inr(aheadTotal)}`);
  }

  if (input.lastReceipt) {
    const r = input.lastReceipt;
    lines.push(
      `Last receipt: ${inr(r.amountPaise)} on ${shortDate(r.date)}${r.modes.length ? `, ${r.modes.join(" + ")}` : ""} (${r.receiptNo})`,
    );
  } else {
    lines.push("No receipt on record this session.");
  }
  if (input.parentMobile) lines.push(`Parent: ${maskMobile(input.parentMobile)}`);

  if (input.detail === "full" && input.siblings.length) {
    for (const sib of input.siblings) {
      lines.push(
        sib.duePaise > 0
          ? `Sibling ${sib.name}, ${sib.classLabel}: ${inr(sib.duePaise)} due`
          : `Sibling ${sib.name}, ${sib.classLabel}: no dues`,
      );
    }
  }
  return lines.join("\n");
}

export function formatStudentMatchesAsk(
  matches: { fullName: string; classLabel: string; rollNo: string }[],
  asked: string,
): string {
  if (!matches.length) {
    return `I couldn't find an active student matching "${asked}". Try the full name, or add the class, e.g. _Amay Gupta 4B_.`;
  }
  const rows = matches.map(
    (m) => `• ${m.fullName} (${m.classLabel}${m.rollNo ? `, roll ${m.rollNo}` : ""})`,
  );
  return `Which one did you mean?\n${rows.join("\n")}\nReply with the full name and class.`;
}

// ─── Attendance summary ────────────────────────────────────────────────

export type AttendanceSummarySection = {
  label: string; // "V A"
  total: number;
  marked: boolean;
  holiday: boolean;
  present: number;
  absent: number;
  leave: number;
  late: number;
  halfDay: number;
};

export type AttendanceSummaryClass = {
  className: string;
  sections: AttendanceSummarySection[];
};

export type AttendanceSummaryStaff = {
  activeStaff: number;
  registerMarked: boolean;
  present: number;
  absent: number;
  leave: number;
  /** Active staff with no mark at all on the register. */
  notPunched: string[];
};

export type AttendanceSummaryInput = {
  date: string;
  todayIso: string;
  scope: "school" | "mine";
  classes: AttendanceSummaryClass[];
  staff: AttendanceSummaryStaff | null;
};

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "—";
}

export function formatAttendanceSummaryReply(input: AttendanceSummaryInput): string {
  const when = input.date === input.todayIso ? "today" : shortDate(input.date);
  const lines: string[] = [
    `*${input.scope === "school" ? "School attendance" : "Your sections"}* · ${when}`,
  ];
  const all = input.classes.flatMap((c) => c.sections);
  if (!all.length) {
    lines.push("No active sections found.");
    return lines.join("\n");
  }
  const marked = all.filter((s) => s.marked);
  const pending = all.filter((s) => !s.marked && !s.holiday);
  const holidays = all.filter((s) => !s.marked && s.holiday);
  const total = marked.reduce((n, s) => n + s.total, 0);
  const present = marked.reduce((n, s) => n + s.present, 0);
  const absent = marked.reduce((n, s) => n + s.absent, 0);
  const leave = marked.reduce((n, s) => n + s.leave, 0);
  const late = marked.reduce((n, s) => n + s.late, 0);
  if (!marked.length) {
    lines.push(
      holidays.length === all.length
        ? "Holiday for every section."
        : `No section marked yet (${pending.length} pending).`,
    );
  } else {
    const head = [`Present *${pct(present, total)}* (${present} / ${total})`];
    if (absent) head.push(`Absent ${absent}`);
    if (leave) head.push(`Leave ${leave}`);
    if (late) head.push(`Late ${late}`);
    lines.push(head.join(" · "));
    lines.push(`${marked.length} of ${all.length - holidays.length} sections marked`);
  }
  if (pending.length) {
    lines.push(`*Not marked:* ${pending.map((s) => s.label).join(", ")}`);
  }
  if (marked.length) {
    lines.push("", "*By class*");
    for (const c of input.classes) {
      const secs = c.sections.filter((s) => s.marked);
      if (!secs.length) continue;
      const t = secs.reduce((n, s) => n + s.total, 0);
      const p = secs.reduce((n, s) => n + s.present, 0);
      const parts = secs.map((s) => {
        const name = s.label.replace(new RegExp(`^${c.className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`), "");
        return `${name || s.label} ${s.present}/${s.total}`;
      });
      lines.push(`${c.className}  ${pct(p, t)}  (${parts.join(", ")})`);
    }
  }
  if (input.staff) {
    const st = input.staff;
    lines.push("");
    if (!st.registerMarked) {
      lines.push(`*Staff:* no punches yet (${st.activeStaff} active).`);
    } else {
      const parts = [`Present ${st.present}`];
      if (st.absent) parts.push(`Absent ${st.absent}`);
      if (st.leave) parts.push(`Leave ${st.leave}`);
      lines.push(`*Staff:* ${parts.join(" · ")} of ${st.activeStaff}`);
      if (st.notPunched.length) {
        const shown = st.notPunched.slice(0, 8).join(", ");
        const more = st.notPunched.length > 8 ? ` +${st.notPunched.length - 8} more` : "";
        lines.push(`Not punched in: ${shown}${more}`);
      }
    }
  }
  return lines.join("\n");
}

// ─── Class / section resolution for class-wide asks ────────────────────

/**
 * Like resolveSectionRef, but a class with no letter means the whole class:
 * every active section is returned. Used by class-wide lists.
 */
export function resolveClassOrSectionRef(
  ref: { classKey: string; sectionName: string },
  masters: Pick<MastersState, "classes" | "sections">,
):
  | { ok: true; className: string; classId: string; sections: SectionMatch[]; wholeClass: boolean }
  | { ok: false; reason: "no_class" | "no_section"; options: SectionMatch[] } {
  if (ref.sectionName) {
    const r = resolveSectionRef(ref, masters);
    if (r.ok) {
      return { ok: true, className: r.match.className, classId: r.match.classId, sections: [r.match], wholeClass: false };
    }
    if (r.reason === "ambiguous") {
      return { ok: true, className: r.options[0]!.className, classId: r.options[0]!.classId, sections: r.options, wholeClass: false };
    }
    return { ok: false, reason: r.reason, options: r.options };
  }
  const classes = (masters.classes ?? []).filter(
    (c) => c.isActive !== false && classKey(c.name) === ref.classKey,
  );
  if (!classes.length) return { ok: false, reason: "no_class", options: [] };
  const sections: SectionMatch[] = [];
  for (const c of classes) {
    for (const sct of (masters.sections ?? []).filter((x) => x.classId === c.id && x.isActive !== false)) {
      sections.push({
        classId: c.id,
        sectionId: sct.id,
        className: c.name,
        sectionName: sct.name,
        label: `${c.name} ${sct.name}`.trim(),
      });
    }
  }
  if (!sections.length) return { ok: false, reason: "no_section", options: [] };
  return { ok: true, className: classes[0]!.name, classId: classes[0]!.id, sections, wholeClass: true };
}

// ─── Class defaulters ──────────────────────────────────────────────────

export type DefaulterRow = {
  sectionLabel: string;
  rollNo: string;
  fullName: string;
  overdueAmountPaise: number;
  overdueDays: number;
  earliestDueOn: string;
  onPlan: boolean;
};

export type ClassDefaultersInput = {
  title: string; // "Class V" or "V A"
  todayIso: string;
  wholeClass: boolean;
  rows: DefaulterRow[];
  /** Sections the reply covers — named when a teacher asked for a whole class but only teaches some of it. */
  limitedTo?: string[];
  formatInr: (paise: number) => string;
};

export function formatClassDefaultersReply(input: ClassDefaultersInput): string {
  const inr = input.formatInr;
  const lines: string[] = [`*${input.title}* · defaulters · ${input.todayIso === input.todayIso ? "today" : input.todayIso}`];
  if (input.limitedTo?.length) lines.push(`(your sections only: ${input.limitedTo.join(", ")})`);
  if (!input.rows.length) {
    lines.push("No overdue fees. ✅");
    return lines.join("\n");
  }
  const total = input.rows.reduce((s, r) => s + r.overdueAmountPaise, 0);
  lines.push(`${input.rows.length} student${input.rows.length === 1 ? "" : "s"} · *${inr(total)}* overdue`);
  const sorted = [...input.rows].sort(
    (a, b) => b.overdueAmountPaise - a.overdueAmountPaise || b.overdueDays - a.overdueDays,
  );
  const cap = 30;
  const row = (r: DefaulterRow) => {
    const since = r.earliestDueOn ? shortDate(r.earliestDueOn) : "";
    return `${r.rollNo ? `${r.rollNo}. ` : ""}${r.fullName}  ${inr(r.overdueAmountPaise)} · ${r.overdueDays}d${since ? ` (${since})` : ""}${r.onPlan ? " · plan" : ""}`;
  };
  if (input.wholeClass) {
    const bySection = new Map<string, DefaulterRow[]>();
    for (const r of sorted) bySection.set(r.sectionLabel, [...(bySection.get(r.sectionLabel) ?? []), r]);
    let shown = 0;
    for (const [label, rows] of [...bySection.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const sub = rows.reduce((s, r) => s + r.overdueAmountPaise, 0);
      lines.push("", `*${label}* · ${rows.length} · ${inr(sub)}`);
      for (const r of rows) {
        if (shown >= cap) break;
        lines.push(row(r));
        shown++;
      }
    }
    if (sorted.length > cap) lines.push(`+${sorted.length - cap} more — open Fees → Defaulters for the full list.`);
  } else {
    lines.push("");
    for (const r of sorted.slice(0, cap)) lines.push(row(r));
    if (sorted.length > cap) lines.push(`+${sorted.length - cap} more — open Fees → Defaulters for the full list.`);
  }
  lines.push("", "Reply with a name for the full ledger.");
  return lines.join("\n");
}

// ─── Today's collection ────────────────────────────────────────────────

export type CollectionModeTotal = { label: string; paise: number; count: number };

export type CollectionInput = {
  date: string;
  todayIso: string;
  receiptCount: number;
  totalPaise: number;
  /** Largest first, as the formatter expects. */
  byMode: CollectionModeTotal[];
  chequesPending: { count: number; paise: number };
  bySource: { counter: number; manualBook: number; paymentLink: number };
  cashiers: { name: string; paise: number; count: number }[];
  dayClose: { status: string; cashierName: string; physicalCashPaise: number | null; systemCashPaise: number | null } | null;
  monthToDatePaise: number;
  monthLabel: string;
  formatInr: (paise: number) => string;
};

export function formatCollectionReply(input: CollectionInput): string {
  const inr = input.formatInr;
  const when = input.date === input.todayIso ? "today" : shortDate(input.date);
  const lines: string[] = [`*Fee collection* · ${when}`];
  if (input.receiptCount === 0) {
    lines.push("No receipts yet.");
  } else {
    lines.push(`*${inr(input.totalPaise)}* · ${input.receiptCount} receipt${input.receiptCount === 1 ? "" : "s"}`);
    lines.push("", "*By mode*");
    for (const m of input.byMode) lines.push(`${m.label}   ${inr(m.paise)}  (${m.count})`);
    if (input.chequesPending.count) {
      lines.push(`Cheques awaiting clearance: ${input.chequesPending.count} · ${inr(input.chequesPending.paise)}`);
    }
    const src: string[] = [];
    if (input.bySource.counter) src.push(`counter ${input.bySource.counter}`);
    if (input.bySource.manualBook) src.push(`paper book ${input.bySource.manualBook}`);
    if (input.bySource.paymentLink) src.push(`online link ${input.bySource.paymentLink}`);
    if (src.length > 1) lines.push(`Receipts: ${src.join(" · ")}`);
    if (input.cashiers.length > 1) {
      lines.push("", "*By cashier*");
      for (const c of input.cashiers.slice(0, 4)) lines.push(`${c.name}   ${inr(c.paise)}  (${c.count})`);
    }
  }
  lines.push("");
  if (!input.dayClose) {
    lines.push(input.receiptCount ? "Day close: not started." : "Day close: —");
  } else {
    const dc = input.dayClose;
    const status =
      dc.status === "approved"
        ? "approved ✅"
        : dc.status === "submitted"
          ? "submitted, awaiting approval"
          : dc.status === "rejected"
            ? "rejected ⚠️"
            : "draft";
    let diff = "";
    if (dc.physicalCashPaise != null && dc.systemCashPaise != null && dc.physicalCashPaise !== dc.systemCashPaise) {
      const d = dc.physicalCashPaise - dc.systemCashPaise;
      diff = ` · cash ${d > 0 ? "over" : "short"} by ${inr(Math.abs(d))}`;
    }
    lines.push(`Day close: ${status}${dc.cashierName ? ` (${dc.cashierName})` : ""}${diff}`);
  }
  lines.push(`${input.monthLabel} so far: ${inr(input.monthToDatePaise)}`);
  return lines.join("\n");
}

export const TENDER_MODE_LABEL: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  cheque: "Cheque / DD",
  rtgs: "RTGS",
  neft: "NEFT",
  imps: "IMPS",
  bank: "Bank transfer",
};

// ─── Free teachers in a period ─────────────────────────────────────────

/**
 * Student leave queue: "pending leaves", "leave requests", "5A leave
 * requests", "kitni chutti pending hai", "leave approvals". A leave word
 * plus a queue word; "leave" alone could be a teacher's own leave, which
 * the staff bot handles.
 */
const LEAVE_WORDS =
  /(?=.*(?<![\p{L}\p{M}\p{N}])(leaves?|chutti|chhutti|छुट्टी|छुट्टियां|avkash|avakash|अवकाश)(?![\p{L}\p{M}\p{N}]))(?=.*(?<![\p{L}\p{M}\p{N}])(pending|requests?|approvals?|approve|queue|list|applications?|kitni|kitne|कितनी|बाकी|baki)(?![\p{L}\p{M}\p{N}]))/iu;

const FREE_WORDS =
  /(?<![\p{L}\p{M}\p{N}])(free|khali|khaali|खाली|available|vacant|substitute|substitution|kaun\s+aa\s+sakta)(?![\p{L}\p{M}\p{N}])/iu;

/**
 * "who is free in period 3", "period 3 me kaun free hai", "abhi kaun free
 * hai", "free teachers next period", "3rd period khali kaun". Returns the
 * period as "3", "now" or "next", or null when the message is not this ask.
 */
export function parseFreeTeachersQuery(text: string): string | null {
  const t = (text || "").trim();
  if (!t || !FREE_WORDS.test(t)) return null;
  // "fees" / "seat" mentions are other things; a teacher-ish or period-ish
  // word must be present.
  if (FEE_WORDS.test(t) && !/period|pd\b|lecture/i.test(t)) return null;
  const low = t.toLowerCase();
  const num =
    /(?:period|pd|lecture|kalansh|कालांश|p)\s*-?\s*(\d{1,2})(?![\d])/i.exec(low) ||
    /(\d{1,2})\s*(?:st|nd|rd|th|va|wa|वां|वीं)?\s*(?:period|pd|lecture|kalansh|कालांश)/i.exec(low);
  if (num) return String(parseInt(num[1]!, 10));
  if (/(?<![\p{L}])(next|agla|agle|अगला|अगले)(?![\p{L}])/iu.test(low)) return "next";
  if (/(?<![\p{L}])(now|abhi|is\s+waqt|is\s+time|current|अभी|इस\s+समय)(?![\p{L}])/iu.test(low)) return "now";
  // "kaun free hai" with a teacher word and nothing else → now.
  if (/teacher|staff|kaun|kon|who|कौन/i.test(low)) return "now";
  return null;
}

export type FreeTeacherRow = {
  name: string;
  /** Regular periods on this weekday. */
  dayLoad: number;
  /** Substitutions already given this date. */
  subLoad: number;
  designation: string;
};

export type FreeTeachersInput = {
  date: string;
  todayIso: string;
  periodNo: number;
  periodLabel: string;
  timeLabel: string; // "10:40–11:20"
  weekdayLabel: string;
  free: FreeTeacherRow[];
  absentCount: number;
  uncovered: { classLabel: string; subject: string; absentTeacher: string }[];
  covered: { classLabel: string; subject: string; substitute: string }[];
};

export function formatFreeTeachersReply(input: FreeTeachersInput): string {
  const when = input.date === input.todayIso ? "today" : `${input.weekdayLabel} ${shortDate(input.date)}`;
  const lines: string[] = [
    `*Free in ${input.periodLabel}* · ${when}${input.timeLabel ? ` · ${input.timeLabel}` : ""}`,
  ];
  if (!input.free.length) {
    lines.push("No teacher is free this period.");
  } else {
    lines.push(`${input.free.length} free`);
    const sorted = [...input.free].sort(
      (a, b) => a.dayLoad + a.subLoad * 2 - (b.dayLoad + b.subLoad * 2) || a.name.localeCompare(b.name),
    );
    for (const f of sorted.slice(0, 15)) {
      const load = [`${f.dayLoad} pd today`];
      if (f.subLoad) load.push(`${f.subLoad} sub${f.subLoad === 1 ? "" : "s"}`);
      lines.push(`${f.name}${f.designation ? ` (${f.designation})` : ""}  · ${load.join(", ")}`);
    }
    if (sorted.length > 15) lines.push(`+${sorted.length - 15} more`);
  }
  if (input.uncovered.length) {
    lines.push("", `*Uncovered this period* (${input.absentCount} absent today)`);
    for (const u of input.uncovered) lines.push(`${u.classLabel} ${u.subject} — ${u.absentTeacher} absent`);
  } else if (input.absentCount) {
    lines.push("", `${input.absentCount} teacher${input.absentCount === 1 ? "" : "s"} absent today; this period is covered.`);
  }
  if (input.covered.length) {
    lines.push("", "*Substitutions this period*");
    for (const c of input.covered) lines.push(`${c.classLabel} ${c.subject} → ${c.substitute}`);
  }
  return lines.join("\n");
}

/** Which teaching period contains `hhmm` ("10:45"), or the next one after it. */
export function periodAtTime(
  periods: { no: number; startTime: string; endTime: string }[],
  hhmm: string,
  mode: "now" | "next",
): { no: number } | { before: true } | { after: true } | null {
  const toMin = (v: string) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(v);
    return m ? parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10) : NaN;
  };
  const t = toMin(hhmm);
  if (!Number.isFinite(t) || !periods.length) return null;
  const sorted = [...periods].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  if (mode === "now") {
    const cur = sorted.find((p) => t >= toMin(p.startTime) && t < toMin(p.endTime));
    if (cur) return { no: cur.no };
    // Between periods (a break) counts as the period about to start.
    const next = sorted.find((p) => toMin(p.startTime) > t);
    if (!next) return { after: true };
    if (t < toMin(sorted[0]!.startTime)) return { before: true };
    return { no: next.no };
  }
  const next = sorted.find((p) => toMin(p.startTime) > t);
  if (!next) return { after: true };
  return { no: next.no };
}

// ─── Pending student leaves ────────────────────────────────────────────

export type PendingLeaveRow = {
  studentName: string;
  classLabel: string;
  rollNo: string;
  fromDate: string;
  toDate: string;
  days: number;
  typeLabel: string;
  reason: string;
  requestedAt: string; // ISO
  approver: string;
};

export type PendingLeavesInput = {
  todayIso: string;
  scope: "school" | "mine" | "section";
  scopeLabel?: string;
  rows: PendingLeaveRow[];
  approvedToday: number;
};

function agoLabel(iso: string, todayIso: string): string {
  const d = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  const days = Math.round((Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export function formatPendingLeavesReply(input: PendingLeavesInput): string {
  const where =
    input.scope === "school" ? "school" : input.scope === "section" ? input.scopeLabel || "section" : "your sections";
  const lines: string[] = [`*Pending leave requests* · ${where}`];
  if (!input.rows.length) {
    lines.push("Nothing waiting for approval. ✅");
  } else {
    lines.push(`${input.rows.length} waiting · oldest first`);
    const sorted = [...input.rows].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
    for (const r of sorted.slice(0, 15)) {
      const span =
        r.fromDate === r.toDate
          ? shortDate(r.fromDate)
          : `${shortDate(r.fromDate)}–${shortDate(r.toDate)} (${r.days}d)`;
      const reason = r.reason.trim();
      lines.push(
        "",
        `*${r.studentName}* · ${r.classLabel}${r.rollNo ? ` · roll ${r.rollNo}` : ""}`,
        `${span} · ${r.typeLabel}${reason ? ` · ${reason.length > 60 ? `${reason.slice(0, 57).trimEnd()}…` : reason}` : ""}`,
        `asked ${agoLabel(r.requestedAt, input.todayIso)} · approver: ${r.approver}`,
      );
    }
    if (sorted.length > 15) lines.push("", `+${sorted.length - 15} more`);
  }
  if (input.approvedToday) {
    lines.push("", `${input.approvedToday} student${input.approvedToday === 1 ? "" : "s"} on approved leave today.`);
  }
  lines.push("", "Approve or reject in the ERP: Attendance → Leave.");
  return lines.join("\n");
}
