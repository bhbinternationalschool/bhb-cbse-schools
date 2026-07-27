/**
 * Parse teacher WhatsApp class-channel messages into ERP intents.
 * Pure text — no I/O.
 */

export type ClassChannelIntentKind =
  | "help"
  | "confirm"
  | "cancel"
  | "members"
  | "homework"
  | "classwork"
  | "notice"
  | "holiday"
  | "exam"
  | "timing"
  | "unknown";

export type ClassChannelParsed = {
  kind: ClassChannelIntentKind;
  classHint: string;
  sectionHint: string;
  subjectHint: string;
  title: string;
  body: string;
  dueAt: string;
  eventDate: string;
  raw: string;
};

const ROMAN: Record<string, string> = {
  i: "1",
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
  xi: "11",
  xii: "12",
};

function norm(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function stripPrefix(text: string, re: RegExp): string {
  return text.replace(re, "").trim();
}

/** Extract class/section hints like 8A, 8-A, VIII-A, Class 8 A */
export function parseClassSectionHint(text: string): {
  classHint: string;
  sectionHint: string;
  rest: string;
} {
  const t = norm(text);
  const patterns: RegExp[] = [
    /\b(?:class|cls|std|standard)?\s*([ivx]{1,4}|\d{1,2})\s*[-–]?\s*([a-h])\b/i,
    /\b([ivx]{1,4}|\d{1,2})\s*([a-h])\b/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (!m) continue;
    let classHint = (m[1] || "").toLowerCase();
    if (ROMAN[classHint]) classHint = ROMAN[classHint];
    const sectionHint = (m[2] || "").toUpperCase();
    const rest = norm(t.replace(m[0], " "));
    return { classHint, sectionHint, rest };
  }
  return { classHint: "", sectionHint: "", rest: t };
}

function parseDue(text: string): { dueAt: string; rest: string } {
  const m = text.match(
    /\b(?:due|submit(?:\s*by)?|last\s*date)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\w+)/i,
  );
  if (!m) return { dueAt: "", rest: text };
  return {
    dueAt: normalizeLooseDate(m[1] || ""),
    rest: norm(text.replace(m[0], " ")),
  };
}

function parseEventDate(text: string): { eventDate: string; rest: string } {
  const m = text.match(
    /\b(?:on|date)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\b/i,
  );
  if (!m) return { eventDate: "", rest: text };
  return {
    eventDate: normalizeLooseDate(m[1] || ""),
    rest: norm(text.replace(m[0], " ")),
  };
}

function normalizeLooseDate(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    const d = m[1]!.padStart(2, "0");
    const mo = m[2]!.padStart(2, "0");
    let y = m[3]!;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${mo}-${d}`;
  }
  return "";
}

function guessSubject(text: string, known: string[]): string {
  const lower = text.toLowerCase();
  for (const name of known) {
    if (!name) continue;
    if (lower.includes(name.toLowerCase())) return name;
  }
  const common = [
    "maths",
    "mathematics",
    "english",
    "hindi",
    "science",
    "physics",
    "chemistry",
    "biology",
    "sst",
    "social",
    "computer",
    "evs",
    "sanskrit",
    "gk",
  ];
  for (const c of common) {
    if (new RegExp(`\\b${c}\\b`, "i").test(text)) return c;
  }
  return "";
}

export function detectClassChannelIntent(
  rawText: string,
  opts?: { subjectNames?: string[] },
): ClassChannelParsed {
  const raw = norm(rawText);
  const upper = raw.toUpperCase();

  if (!raw || /^(help|\?|menu|hi|hello|namaste)\b/i.test(raw)) {
    return emptyParsed("help", raw);
  }
  if (
    /^(yes|y|ok|okay|confirm|approve|send|broadcast|publish)\b/i.test(raw) ||
    upper === "YES" ||
    upper === "CONFIRM"
  ) {
    return emptyParsed("confirm", raw);
  }
  if (/^(no|n|cancel|reject|discard|stop)\b/i.test(raw)) {
    return emptyParsed("cancel", raw);
  }
  if (/^(members|roster|who|list)\b/i.test(raw)) {
    return emptyParsed("members", raw);
  }

  let kind: ClassChannelIntentKind = "unknown";
  let work = raw;

  if (/^(hw|homework|h\.?w\.?|classwork|cw|diary)\b/i.test(work)) {
    kind = /classwork|^cw\b/i.test(work) ? "classwork" : "homework";
    work = stripPrefix(
      work,
      /^(hw|homework|h\.?w\.?|classwork|cw|diary)\s*[:\-.]?\s*/i,
    );
  } else if (/^(notice|circular|announce(?:ment)?)\b/i.test(work)) {
    kind = "notice";
    work = stripPrefix(
      work,
      /^(notice|circular|announce(?:ment)?)\s*[:\-.]?\s*/i,
    );
  } else if (/^(holiday|leave\s*day|off)\b/i.test(work)) {
    kind = "holiday";
    work = stripPrefix(work, /^(holiday|leave\s*day|off)\s*[:\-.]?\s*/i);
  } else if (/^(exam|test|unit\s*test|assessment)\b/i.test(work)) {
    kind = "exam";
    work = stripPrefix(
      work,
      /^(exam|test|unit\s*test|assessment)\s*[:\-.]?\s*/i,
    );
  } else if (/^(timing|timings|schedule|bell)\b/i.test(work)) {
    kind = "timing";
    work = stripPrefix(work, /^(timing|timings|schedule|bell)\s*[:\-.]?\s*/i);
  } else if (/\b(homework|hw|classwork)\b/i.test(work)) {
    kind = /classwork/i.test(work) ? "classwork" : "homework";
  } else if (/\b(notice|circular)\b/i.test(work)) {
    kind = "notice";
  } else if (/\bholiday\b/i.test(work)) {
    kind = "holiday";
  } else if (/\b(exam|unit\s*test)\b/i.test(work)) {
    kind = "exam";
  }

  const cs = parseClassSectionHint(work);
  work = cs.rest;
  const due = parseDue(work);
  work = due.rest;
  const ev = parseEventDate(work);
  work = ev.rest;

  const subjectHint = guessSubject(work, opts?.subjectNames || []);
  if (subjectHint) {
    work = norm(
      work.replace(new RegExp(subjectHint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " "),
    );
  }

  // First line as title if multi-line
  work = work.replace(/^[:\-.\s]+/, "").trim();
  const lines = work.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  let title = "";
  let body = work;
  if (lines.length > 1) {
    title = lines[0]!;
    body = lines.slice(1).join("\n");
  } else if (work.length > 80) {
    title = work.slice(0, 72).trim() + "…";
    body = work;
  } else {
    title = work || kindLabel(kind);
    body = work;
  }

  if (kind === "unknown" && (cs.classHint || subjectHint || body.length > 8)) {
    // Default teacher posts without keyword → homework if subject-ish, else notice
    kind = subjectHint ? "homework" : "notice";
  }

  return {
    kind,
    classHint: cs.classHint,
    sectionHint: cs.sectionHint,
    subjectHint,
    title: title || kindLabel(kind),
    body: body || title,
    dueAt: due.dueAt,
    eventDate: ev.eventDate,
    raw,
  };
}

function kindLabel(kind: ClassChannelIntentKind): string {
  switch (kind) {
    case "homework":
      return "Homework";
    case "classwork":
      return "Classwork";
    case "notice":
      return "Notice";
    case "holiday":
      return "Holiday";
    case "exam":
      return "Exam";
    case "timing":
      return "School timing";
    default:
      return "Update";
  }
}

function emptyParsed(
  kind: ClassChannelIntentKind,
  raw: string,
): ClassChannelParsed {
  return {
    kind,
    classHint: "",
    sectionHint: "",
    subjectHint: "",
    title: "",
    body: "",
    dueAt: "",
    eventDate: "",
    raw,
  };
}

export function classChannelHelpText(schoolName: string): string {
  return [
    `${schoolName} — Class WhatsApp channel`,
    "",
    "Post (then reply YES to publish + notify parents):",
    "• HW 8A Maths: Ex 4.1 Q1-10 Due: 2026-07-21",
    "• NOTICE 8A: Bring art kit tomorrow",
    "• HOLIDAY: 15 Aug Independence Day",
    "• EXAM 8A Maths on 2026-07-25",
    "• TIMING: Assembly 7:45 AM tomorrow",
    "",
    "Commands: MEMBERS · YES · NO · HELP",
    "",
    "Teachers are auto-linked from Staff duties. Parents come from the class roster.",
  ].join("\n");
}
