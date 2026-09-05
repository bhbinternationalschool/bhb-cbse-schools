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

export type ErpCommandFieldType = "section" | "date" | "text";

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
  const classRe =
    /\b(?:class|grade|std|kaksha|कक्षा)\s*(\d{1,2}|[ivx]{1,4}|nursery|lkg|ukg|kg|pg)(?:st|nd|rd|th)?\s*(?:-|\s)?\s*(?:section|sec|sec\.)?\s*([a-h])?\b/g;
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

const ABSENT_WORDS =
  /\b(absent|absentee|absentees|gair\s*hazir|gairhazir|गैर\s*हाज़िर|गैरहाजिर|अनुपस्थित|nahi\s+aaya|nahi\s+aaye|नहीं\s+आया|नहीं\s+आए|hazri|haziri|हाज़िरी|हाजिरी|attendance|upasthiti|उपस्थिति)\b/i;

const HELP_WORDS = /^\s*(commands?|command\s+help|cmd|कमांड|\?)\s*$/i;

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
  const refs = extractSectionRefs(t);
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
    'Respond with JSON only: {"command": "<id or none>", "section": "<as written, e.g. 5A>", "date": "<YYYY-MM-DD or empty>", "text": "<free text if a command needs it>", "confidence": <0..1>}.',
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
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
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
