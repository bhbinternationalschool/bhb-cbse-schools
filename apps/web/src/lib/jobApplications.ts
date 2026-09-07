/**
 * Teaching-job applications: what a CV becomes once the school has read it.
 *
 * Pure shapes, validation and the mapping from an applicant's own words
 * onto the school's real subject and class masters. No I/O, no model call
 * — jobApplications.server.ts persists, the route does the vision call.
 *
 * The mapping lives here, away from the model, on purpose. A model asked
 * to "return the subject id" will cheerfully invent one, and an invented
 * id is worse than no answer: it files a Physics teacher under a subject
 * the school does not teach and nobody notices, because the record looks
 * complete. So the model returns words, and only names the school itself
 * holds can become ids.
 */

import type { MastersState } from "@/lib/masters";
import type { SchoolClass } from "@/lib/masters";
import type { Subject } from "@/lib/foundationMasters";
import { editBudgetFor, withinEdits } from "@/lib/erpCommands";

export type JobApplicationSource = "careers_page" | "whatsapp" | "office";
export type JobApplicationStatus =
  | "new"
  | "shortlisted"
  | "interviewed"
  | "rejected"
  | "hired";
export type JobApplicationOcrStatus = "pending" | "ok" | "unreadable" | "failed";

export type JobApplication = {
  id: string;
  source: JobApplicationSource;
  applicantName: string;
  mobile: string;
  email: string;
  /** Private storage path. Never a public URL — a CV is not public. */
  cvPath: string;
  cvMime: string;
  /** The applicant's own words, kept so the office can see what was read. */
  subjectWords: string[];
  classWords: string[];
  /** Resolved against masters. Empty when nothing matched. */
  subjectIds: string[];
  classIds: string[];
  qualification: string;
  experienceYears: string;
  currentEmployer: string;
  ocrStatus: JobApplicationOcrStatus;
  ocrNotes: string;
  status: JobApplicationStatus;
  createdAt: string;
  reviewedBy: string;
  reviewedAt: string;
};

// ─── What a public form is allowed to send ─────────────────────────────

export type JobApplicationInput = {
  applicantName: string;
  mobile: string;
  email: string;
};

export type JobApplicationInputError =
  | "name_required"
  | "name_too_long"
  | "mobile_invalid"
  | "email_invalid";

/**
 * Validate what a stranger typed, before any of it is stored or shown to
 * staff. Deliberately strict about the mobile: it is the only way the
 * school can answer, and a page open to the internet will otherwise fill
 * the inbox with rows nobody can act on.
 */
export function readJobApplicationInput(
  raw: Partial<Record<keyof JobApplicationInput, unknown>>,
):
  | { ok: true; value: JobApplicationInput }
  | { ok: false; error: JobApplicationInputError } {
  const name = String(raw.applicantName ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2) return { ok: false, error: "name_required" };
  if (name.length > 80) return { ok: false, error: "name_too_long" };

  const digits = String(raw.mobile ?? "").replace(/\D/g, "");
  const local =
    digits.length === 12 && digits.startsWith("91")
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith("0")
        ? digits.slice(1)
        : digits;
  // Indian mobiles start 6–9. A 10-digit string starting 0–5 is a landline
  // or a typo, and WhatsApp will never reach it.
  if (!/^[6-9]\d{9}$/.test(local)) return { ok: false, error: "mobile_invalid" };

  const email = String(raw.email ?? "").trim().slice(0, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "email_invalid" };
  }

  return { ok: true, value: { applicantName: name, mobile: local, email } };
}

export function jobApplicationInputMessage(e: JobApplicationInputError): string {
  switch (e) {
    case "name_required":
      return "Please enter your full name.";
    case "name_too_long":
      return "That name is too long — please shorten it.";
    case "mobile_invalid":
      return "Please enter a 10-digit mobile number the school can reach you on.";
    case "email_invalid":
      return "That email address doesn't look right.";
  }
}

// ─── Their words → the school's subjects ───────────────────────────────

/** Common ways teachers name a subject that a school master spells differently. */
const SUBJECT_ALIASES: Record<string, string[]> = {
  maths: ["math", "mathematics", "ganit", "गणित"],
  english: ["eng", "english literature", "english language"],
  hindi: ["हिंदी", "हिन्दी"],
  science: ["evs", "general science"],
  physics: ["phy"],
  chemistry: ["chem"],
  biology: ["bio", "bio-science", "life science"],
  "computer science": ["computer", "computers", "it", "information technology", "cs"],
  "social science": ["sst", "social studies", "social", "history", "civics", "geography"],
  sanskrit: ["संस्कृत"],
  commerce: ["accountancy", "accounts", "business studies", "economics"],
};

function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/\((.*?)\)/g, " ")
    // PGT / TGT / PRT say the grade band, not the subject.
    .replace(/(?<![\p{L}])(pgt|tgt|prt|ppt|nttt?|ntt)(?![\p{L}])/giu, " ")
    .replace(/(?<![\p{L}])(teacher|faculty|lecturer|sir|madam|mam)(?![\p{L}])/giu, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Map the applicant's subject words onto the school's subject ids.
 *
 * Only ACTIVE, non-group subjects can match — a parent group like
 * "Languages" is a folder, not something a person teaches. Unmatched
 * words are kept as words, never dropped: "Robotics" from someone the
 * school might want to hire must not vanish because there is no master
 * row for it yet.
 */
export function matchSubjectWords(
  words: string[],
  subjects: Subject[],
): { ids: string[]; unmatched: string[] } {
  const pool = subjects.filter((s) => s.isActive && !hasChildren(subjects, s.id));
  const ids: string[] = [];
  const unmatched: string[] = [];

  for (const word of words) {
    const w = norm(word);
    if (!w) continue;
    const hit =
      pool.find((s) => norm(s.nameEn) === w) ??
      pool.find((s) => norm(s.code) === w) ??
      pool.find((s) => aliasesOf(s).includes(w)) ??
      // A CV says "Mathematics"; the master says "Maths". Substring both
      // ways covers it without letting "Art" match "Martial Arts".
      pool.find((s) => {
        const n = norm(s.nameEn);
        return n.length >= 4 && (n.includes(w) || w.includes(n));
      }) ??
      pool.find((s) => {
        const n = norm(s.nameEn);
        return withinEdits(w, n, editBudgetFor(w));
      }) ??
      null;
    if (hit) {
      if (!ids.includes(hit.id)) ids.push(hit.id);
    } else if (!unmatched.some((x) => x.toLowerCase() === word.toLowerCase())) {
      unmatched.push(word);
    }
  }
  return { ids, unmatched };
}

function hasChildren(subjects: Subject[], id: string): boolean {
  return subjects.some((s) => s.parentId === id);
}

/**
 * Every word that names this subject.
 *
 * A group is symmetric: the school's row may be called "Mathematics" and
 * the alias table keyed on "maths", so belonging to a group by EITHER the
 * key or one of its members must earn the whole group. Resolving only one
 * direction is what made a master called "Mathematics" unreachable from
 * "गणित" — the reverse lookup returned the key and stopped there.
 */
function aliasesOf(s: Subject): string[] {
  const key = norm(s.nameEn);
  const out = new Set<string>();
  for (const [groupKey, members] of Object.entries(SUBJECT_ALIASES)) {
    const group = [groupKey, ...members].map(norm);
    if (group.includes(key)) for (const g of group) out.add(g);
  }
  out.delete(key);
  return [...out];
}

// ─── Their words → the school's classes ────────────────────────────────

const ROMAN_TO_N: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8,
  ix: 9, x: 10, xi: 11, xii: 12,
};

/** Bands a teacher names instead of listing grades. */
// Order matters: the FIRST match wins, and the longer band names contain
// the shorter ones. "Senior Secondary" read by a /secondary/ rule first
// would hand a senior teacher the school's IX and X — the lookahead that
// was meant to prevent it looked the wrong way, since "senior" comes
// BEFORE "secondary", not after.
const BAND_WORDS: { re: RegExp; group: string }[] = [
  { re: /senior\s*secondary|sr\.?\s*sec|higher\s*secondary|intermediate|\+2\b/i, group: "SENIOR" },
  { re: /pre[\s-]?primary|nursery|kindergarten|\bkg\b|montessori/i, group: "PRE_PRIMARY" },
  { re: /upper\s*primary|middle/i, group: "MIDDLE" },
  { re: /primary/i, group: "PRIMARY" },
  { re: /secondary|high\s*school/i, group: "SECONDARY" },
];

function classNumberOf(c: SchoolClass): number | null {
  const n = norm(c.name);
  if (ROMAN_TO_N[n] !== undefined) return ROMAN_TO_N[n]!;
  const digits = n.match(/\d+/);
  return digits ? Number(digits[0]) : null;
}

/**
 * Map "VI-VIII", "9 and 10", "Primary" onto the school's class ids.
 *
 * Ranges are expanded, bands resolve through `groupCode`, and anything
 * outside the classes the school actually runs is simply not matched —
 * a CV offering to teach XI–XII at a school that stops at X should leave
 * the class list empty rather than inventing rows.
 */
export function matchClassWords(
  words: string[],
  classes: SchoolClass[],
): { ids: string[]; unmatched: string[] } {
  const pool = classes.filter((c) => c.isActive);
  const byNumber = new Map<number, SchoolClass>();
  for (const c of pool) {
    const n = classNumberOf(c);
    if (n !== null && !byNumber.has(n)) byNumber.set(n, c);
  }
  const ids: string[] = [];
  const unmatched: string[] = [];
  const add = (c: SchoolClass | undefined) => {
    if (c && !ids.includes(c.id)) ids.push(c.id);
  };

  for (const word of words) {
    const before = ids.length;
    const band = BAND_WORDS.find((b) => b.re.test(word));
    if (band) {
      for (const c of pool) if (c.groupCode === band.group) add(c);
    }

    // "VI-VIII", "6 to 8", "IX–X"
    const range = word.match(
      /([ivx]+|\d{1,2})\s*(?:-|–|—|to|se)\s*([ivx]+|\d{1,2})/i,
    );
    if (range) {
      const lo = tokenToNumber(range[1]!);
      const hi = tokenToNumber(range[2]!);
      if (lo !== null && hi !== null && lo <= hi && hi - lo <= 14) {
        for (let n = lo; n <= hi; n += 1) add(byNumber.get(n));
      }
    } else {
      for (const tok of word.split(/[,&/]|\band\b|\bव\b/i)) {
        const n = tokenToNumber(tok.trim());
        if (n !== null) add(byNumber.get(n));
      }
    }

    if (ids.length === before && !unmatched.some((x) => x.toLowerCase() === word.toLowerCase())) {
      unmatched.push(word);
    }
  }
  return { ids, unmatched };
}

function tokenToNumber(tok: string): number | null {
  const t = norm(tok).replace(/(?<![\p{L}])(class|std|standard|grade|kaksha)(?![\p{L}])/giu, "").trim();
  if (!t) return null;
  if (ROMAN_TO_N[t] !== undefined) return ROMAN_TO_N[t]!;
  if (/^\d{1,2}$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= 12 ? n : null;
  }
  return null;
}

// ─── What the principal is told ────────────────────────────────────────

export function classLabelsFor(ids: string[], classes: SchoolClass[]): string[] {
  const byId = new Map(classes.map((c) => [c.id, c]));
  return ids
    .map((id) => byId.get(id))
    .filter((c): c is SchoolClass => !!c)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => c.name);
}

export function subjectLabelsFor(ids: string[], subjects: Subject[]): string[] {
  const byId = new Map(subjects.map((s) => [s.id, s]));
  return ids.map((id) => byId.get(id)?.nameEn).filter((x): x is string => !!x);
}

/**
 * Collapse a run of consecutive classes into "VI–VIII", so the alert
 * reads the way a person would say it rather than listing eight names.
 */
export function shortClassRange(labels: string[]): string {
  if (labels.length <= 2) return labels.join(", ");
  return `${labels[0]}–${labels[labels.length - 1]}`;
}

/** One line for a notification: who applied, and for what. */
export function jobApplicationSummary(
  app: JobApplication,
  masters: Pick<MastersState, "classes" | "subjects">,
): string {
  const subjects = subjectLabelsFor(app.subjectIds, masters.subjects);
  const subjectText =
    subjects.join(", ") ||
    app.subjectWords.join(", ") ||
    "subject not stated";
  const classes = shortClassRange(classLabelsFor(app.classIds, masters.classes));
  const classText = classes || app.classWords.join(", ");
  const exp = app.experienceYears ? ` · ${app.experienceYears} yr` : "";
  return [
    app.applicantName || "Unnamed applicant",
    "—",
    subjectText,
    classText ? `· ${classText}` : "",
    exp,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Applications the office should look at first.
 *
 * Newest first, but anything the OCR could not read is pulled to the top
 * regardless of age: an unreadable CV is the one that will otherwise sit
 * in the list forever, because it looks empty rather than urgent.
 */
export function sortJobApplications(rows: JobApplication[]): JobApplication[] {
  const rank = (r: JobApplication) =>
    r.status !== "new" ? 2 : r.ocrStatus === "ok" ? 1 : 0;
  return [...rows].sort(
    (a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt),
  );
}
